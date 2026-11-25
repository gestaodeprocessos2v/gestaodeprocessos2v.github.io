/* Fila de Trabalho da Vara: lógica pura da área "Inspeção Integrada" (sem DOM; testável em Node).
   Lê os CSV exportados do painel "Inspeção integrada" do BI (processos críticos, sem movimentação e com conclusão antiga),
   reúne as três listas num item por processo e sugere a prioridade de tratamento (1 a 5). Depende de regras.js (Regras). */
(function (raiz) {
  'use strict';
  const R = raiz.Regras || (typeof require !== 'undefined' ? require('./regras.js') : null);
  if (!R) throw new Error('inspecao.js precisa de regras.js carregado antes.');
  const { soDigitos, normTexto, lerLinhasCsv, lerData, formatarCNJ } = R;

  // c = processos críticos, s = sem movimentação, k = conclusão antiga (a letra identifica a lista dentro do item).
  const LISTAS = [['c', 'Processos críticos'], ['s', 'Sem movimentação'], ['k', 'Conclusão antiga']];
  const ROTULO_LISTA = Object.fromEntries(LISTAS);
  const ROTULO_PRIORIDADE = { 1: 'Muito alta', 2: 'Alta', 3: 'Média', 4: 'Acompanhar', 5: 'Já andou (conferir)' };
  const DESCRICAO_PRIORIDADE = {
    1: 'Impacto Alto no BI.',
    2: 'Impacto Médio, processo da Meta 6, concluso há 200 dias ou mais, parado há 250 dias ou mais em tarefa da vara, ou certidão de quitação já juntada (baixa possível).',
    3: 'Demais críticos, conclusões de 100 a 199 dias, paralisações de 100 a 249 dias em tarefa da vara e processos fora da lista do PJe+R.',
    4: 'Dependem de fato externo: sobrestamento, remessa à Turma Recursal, RPV/PRC aguardando pagamento, aguardando envio ou expediente físico.',
    5: 'Arquivado, já saiu das tarefas de minutar/assinar, ou mudou de tarefa depois da carga do BI.',
  };

  const inteiro = v => { const n = parseInt(String(v == null ? '' : v).replace(/\./g, '').trim(), 10); return Number.isFinite(n) ? n : null; };
  const texto = v => String(v == null ? '' : v).trim();
  // "29 - Baixa" → "Baixa"; "Último movimento" vem como "50146 - Juntada Cert -  -": tira o código e os traços do fim.
  const semCodigo = t => { const s = texto(t), m = s.match(/^\d+\s*-\s*(.+)$/); return (m ? m[1] : s).trim(); };
  const limparMovimento = t => texto(t).replace(/^\d+\s*-\s*/, '').replace(/(\s*-\s*)+$/, '').trim();

  // Reconhece a lista pelo cabeçalho do CSV. Devolve 'c', 's', 'k' ou null.
  function detectarLista(cabecalho) {
    const h = (cabecalho || []).map(x => normTexto(x));
    if (h.includes('impacto') || h.some(x => x.startsWith('tempo parado'))) return 'c';
    if (h.includes('tipo conclusao') || h.includes('data conclusao')) return 'k';
    if (h.includes('ultima movimentacao') || h.includes('situacao')) return 's';
    return null;
  }

  // Lê um CSV do BI. Devolve { lista, itens, ignoradas } — ignoradas: linhas sem número de processo válido (20 dígitos).
  function lerArquivoBI(conteudo) {
    const linhas = lerLinhasCsv(conteudo);
    if (!linhas.length) throw new Error('O arquivo está vazio.');
    const cab = linhas[0].map(h => texto(h));
    const lista = detectarLista(cab);
    if (!lista) throw new Error('Não reconheci as colunas. Confira se é uma das três listas exportadas do painel “Inspeção integrada” do BI.');
    const col = {}; cab.forEach((h, i) => { col[normTexto(h)] = i; });
    const pega = (l, ...nomes) => { for (const n of nomes) if (col[n] != null) return l[col[n]]; return ''; };
    if (col['numero do processo'] == null) throw new Error('Não encontrei a coluna “Número do Processo”.');
    const itens = []; let ignoradas = 0;
    for (const l of linhas.slice(1)) {
      const dig = soDigitos(pega(l, 'numero do processo'));
      if (dig.length !== 20) { ignoradas++; continue; }
      const it = { n: dig };
      if (lista === 'c') {
        it.cl = texto(pega(l, 'classe judicial atual')); it.tp = inteiro(pega(l, 'tempo parado (dias)')); it.mt = texto(pega(l, 'metas afetadas')); it.imp = texto(pega(l, 'impacto'));
      } else if (lista === 's') {
        it.um = lerData(pega(l, 'ultima movimentacao')); it.ds = inteiro(pega(l, 'dias')); it.umv = limparMovimento(pega(l, 'ultimo movimento'));
        it.sit = texto(pega(l, 'situacao')); it.ts = texto(pega(l, 'tarefa'));
      } else {
        it.dc = lerData(pega(l, 'data conclusao')); it.dk = inteiro(pega(l, 'dias')); it.tc = texto(pega(l, 'tipo conclusao')); it.tk = texto(pega(l, 'tarefa'));
      }
      itens.push(it);
    }
    return { lista, itens, ignoradas };
  }

  // Reúne os arquivos lidos: um item por processo, com a letra de cada lista em "l" (ordem c, s, k) e os campos de cada uma.
  // lotes: [{ lista, itens }]. Se a mesma lista vier duas vezes, vale a última.
  function consolidar(lotes) {
    const porLista = {};
    for (const lt of lotes) porLista[lt.lista] = lt.itens;
    const mapa = new Map();
    for (const [letra] of LISTAS) {
      for (const it of porLista[letra] || []) {
        const m = mapa.get(it.n) || mapa.set(it.n, { n: formatarCNJ(it.n), l: [] }).get(it.n);
        if (m.l.includes(letra)) continue;
        m.l.push(letra);
        for (const [k, v] of Object.entries(it)) if (k !== 'n' && v != null && v !== '') m[k] = v;
      }
    }
    return [...mapa.values()];
  }

  const contagens = itens => ({
    criticos: itens.filter(i => i.l.includes('c')).length,
    semmov: itens.filter(i => i.l.includes('s')).length,
    conclusao: itens.filter(i => i.l.includes('k')).length,
    processos: itens.length,
  });

  // Maior número de dias entre as listas em que o processo está (tempo parado, sem movimentação e concluso).
  const diasDe = it => Math.max(it.tp || 0, it.ds || 0, it.dk || 0);

  const JUDICIAL = ['minutar', 'assinar', 'ato do magistrado'];
  const EXTERNO = ['sobrestamento', 'remetido', 'aguardar pagamento', 'aguardando envio', 'expediente fisico'];

  // Prioridade sugerida (regra da planilha de 19/11/2026, que não é do BI). ctx: { tarefas: [nomes da tarefa atual no painel],
  // cheg: chegada na tarefa atual (ms) ou null, carga: data e hora da carga do BI (ms) }. Sem tarefa no painel (processo fora
  // da lista do PJe+R), vale a tarefa do BI para decidir "depende da vara" ou "depende de fato externo".
  function analisar(it, ctx) {
    const c = ctx || {};
    const tarefas = (c.tarefas || []).filter(Boolean);
    const noPainel = tarefas.length > 0;
    const tarefaBI = semCodigo(it.ts || it.tk || '');
    const tl = normTexto(noPainel ? tarefas.join(' | ') : tarefaBI);
    const temC = it.l.includes('c'), temS = it.l.includes('s'), temK = it.l.includes('k');
    const imp = it.imp || '', metas = it.mt || '', dk = it.dk || 0, ds = it.ds || 0;
    const judicial = JUDICIAL.some(x => tl.includes(x)), externo = EXTERNO.some(x => tl.includes(x));
    const mudou = !!(noPainel && tarefaBI) && !tarefas.map(normTexto).includes(normTexto(tarefaBI));
    const andouDepois = c.cheg != null && c.carga != null && c.cheg > c.carga;
    const quitacao = temS && /quitacao/.test(normTexto(it.umv || '')) && tl.includes('pagamento');

    const motivos = [];
    if (temC) motivos.push(`Crítico ${imp || '—'} (${metas || 'sem meta informada'}; ${it.tp != null ? it.tp : '—'} dias parado)`);
    if (temK) motivos.push(`Concluso há ${dk} dias${it.tc ? ` (${it.tc})` : ''}`);
    if (temS) motivos.push(`Sem movimentação há ${ds} dias`);
    if (!noPainel) motivos.push('Fora da lista do PJe+R (tarefa do BI)');

    let n;
    if (imp === 'Alto') n = 1;
    else if (tl.includes('arquivad') || (!temC && temK && noPainel && !judicial && !temS) || (!temC && andouDepois && mudou)) {
      n = 5;
      motivos.push(andouDepois ? 'Mudou de tarefa depois da carga do BI' : temK && !temC ? 'Já saiu da conclusão' : 'Arquivado');
    } else if (quitacao) { n = 2; motivos.push('Certidão de quitação juntada: baixa possível (Meta 5)'); }
    else if (imp === 'Médio' || metas.includes('Meta 6') || dk >= 200 || (ds >= 250 && !externo && noPainel)) n = 2;
    else if (externo && !temC) n = 4;
    else n = 3;
    return { n, rotulo: ROTULO_PRIORIDADE[n], motivos, mudou, andouDepois, noPainel };
  }

  // ---------- Visão geral (indicadores mensais da aba "Visão Geral" do painel de Inspeção do BI) ----------
  // O arquivo visao-geral_<carga>.json vem do extrator (bi.montar_visao). Cada indicador: chave, título, unidade, séries
  // (uma ou duas) e se "menor é melhor" (para a cor da variação). As de duas séries mostram o acumulado do ano.
  const VISAO_INDICADORES = [
    { k: 'novos_baixados', titulo: 'Casos novos × baixados', series: [['novos', 'Casos novos'], ['baixados', 'Baixados']], un: 'processos', ano: true },
    { k: 'dist_julgados', titulo: 'Distribuídos × julgados', series: [['distribuidos', 'Distribuídos'], ['julgados', 'Julgados']], un: 'processos', ano: true },
    { k: 'tm_concl_julg', titulo: 'Tempo médio da conclusão ao julgamento', series: [['tm_concl_julg', 'Dias']], un: 'dias', menor: true },
    { k: 'tm_dist_julg', titulo: 'Tempo médio da distribuição ao julgamento', series: [['tm_dist_julg', 'Dias']], un: 'dias', menor: true },
    { k: 'tm_dist_arq', titulo: 'Tempo médio da distribuição ao arquivamento', series: [['tm_dist_arq', 'Dias']], un: 'dias', menor: true },
    { k: 'idade_concl', titulo: 'Idade média da conclusão', series: [['idade_concl', 'Dias']], un: 'dias', menor: true },
    { k: 'idade_ult_dist', titulo: 'Idade média da última distribuição', series: [['idade_ult_dist', 'Dias']], un: 'dias', menor: true },
    { k: 'semmov', titulo: 'Processos sem movimentação (100 dias ou mais)', series: [['semmov', 'Processos']], un: 'processos', menor: true },
  ];
  const SERIES_VISAO = VISAO_INDICADORES.flatMap(i => i.series.map(s => s[0]));
  const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  // "2025-12" → "dez/25" (curto, para gráfico e tabela) ou "dez./2025" (como no BI)
  function rotuloMes(am, longo) {
    const m = /^(\d{4})-(\d{2})$/.exec(am || ''); if (!m) return am || '';
    const nome = MESES_CURTOS[Number(m[2]) - 1] || m[2];
    return longo ? `${nome}./${m[1]}` : `${nome}/${m[1].slice(2)}`;
  }
  // Confere e devolve a visão geral lida do .json do extrator (lança erro com mensagem para o Gestor se o formato não for o esperado).
  function lerVisao(conteudo) {
    let v;
    try { v = JSON.parse(String(conteudo).replace(/^﻿/, '')); } catch (e) { throw new Error('O arquivo da visão geral não é um JSON válido.'); }
    const num = x => x === null || (typeof x === 'number' && Number.isFinite(x));
    if (!v || typeof v !== 'object' || !Array.isArray(v.meses) || !v.meses.length || v.meses.length > 24 || !v.meses.every(m => /^\d{4}-\d{2}$/.test(m)))
      throw new Error('A visão geral não tem a lista de meses esperada.');
    const series = {};
    for (const s of SERIES_VISAO) {
      const a = v.series && v.series[s];
      if (!Array.isArray(a) || a.length !== v.meses.length || !a.every(num)) throw new Error(`A visão geral não tem a série “${s}” completa.`);
      series[s] = a;
    }
    const atual = {};
    for (const [s, o] of Object.entries(v.atual || {})) if (SERIES_VISAO.includes(s) && o && num(o.v)) atual[s] = { v: o.v, var: num(o.var) ? o.var : null };
    const ano_acum = {};
    for (const s of ['novos', 'baixados', 'distribuidos', 'julgados']) if (v.ano_acum && num(v.ano_acum[s])) ano_acum[s] = v.ano_acum[s];
    return { ano: Number(v.ano) || Number(v.meses[v.meses.length - 1].slice(0, 4)), meses: v.meses.slice(), series, atual, ano_acum };
  }

  const api = { LISTAS, ROTULO_LISTA, ROTULO_PRIORIDADE, DESCRICAO_PRIORIDADE, detectarLista, lerArquivoBI, consolidar, contagens, diasDe, analisar, semCodigo,
    VISAO_INDICADORES, SERIES_VISAO, rotuloMes, lerVisao };
  raiz.Inspecao = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
