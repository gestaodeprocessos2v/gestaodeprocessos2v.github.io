/* Lógica pura do painel: leitura do CSV do PJe+R, distribuição e ordenação. Sem DOM; testável em Node. */
(function (root) {
  const semAcento = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const chaveCab = s => semAcento(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const normTexto = s => semAcento(s).toLowerCase().replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
  const soDigitos = s => String(s == null ? '' : s).replace(/\D/g, '');

  // Cabeçalho do PJe+R (nome interno ou formatado) -> campo curto. Só o que o painel usa.
  const CABECALHOS = {
    numeroprocesso: 'n', numerodoprocesso: 'n',
    classejudicial: 'c', classe: 'c',
    datachegada: 'ch', datadechegada: 'ch',
    nometarefa: 't', tarefa: 't',
    tagsprocessolist: 'e', etiquetas: 'e',
    cargojudicial: 'cg',
    sigiloso: 'sg',
  };

  // Os seis setores da vara: texto da planilha de tarefas -> id usado no painel.
  const SETORES_VARA = {
    secretaria: 'secretaria', 'triagem inicial': 'triagem', triagem: 'triagem', comunicacao: 'comunicacao',
    pagamentos: 'pagamentos', audiencia: 'audiencia', pericia: 'pericia',
  };

  function detectarSeparador(texto) {
    const primeira = texto.split(/\r?\n/, 1)[0] || '';
    let melhor = ';', max = -1;
    for (const sep of [';', ',', '\t']) {
      let n = 0, aspas = false;
      for (const ch of primeira) { if (ch === '"') aspas = !aspas; else if (ch === sep && !aspas) n++; }
      if (n > max) { max = n; melhor = sep; }
    }
    return melhor;
  }

  function lerLinhasCsv(texto) {
    texto = String(texto).replace(/^﻿/, '');
    const sep = detectarSeparador(texto);
    const linhas = [];
    let campo = '', linha = [], aspas = false;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (aspas) {
        if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
        else campo += ch;
      } else if (ch === '"' && campo === '') aspas = true;
      else if (ch === sep) { linha.push(campo); campo = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && texto[i + 1] === '\n') i++;
        linha.push(campo); campo = '';
        if (linha.length > 1 || linha[0].trim() !== '') linhas.push(linha);
        linha = [];
      } else campo += ch;
    }
    if (campo !== '' || linha.length) { linha.push(campo); if (linha.length > 1 || linha[0].trim() !== '') linhas.push(linha); }
    return linhas;
  }

  function lerData(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d{10,13}$/.test(s)) return s.length <= 10 ? Number(s) * 1000 : Number(s);
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      let ano = Number(m[3]); if (ano < 100) ano += 2000;
      return new Date(ano, Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)).getTime();
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)).getTime();
    const t = Date.parse(s);
    return isNaN(t) ? null : t;
  }

  function lerBooleano(v) {
    const s = normTexto(v);
    return s === 'true' || s === 'sim' || s === 's' || s === '1' || s === 'verdadeiro';
  }

  function lerEtiquetas(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s || s === '[]') return '';
    if (s[0] === '[') {
      try {
        const lista = JSON.parse(s);
        if (Array.isArray(lista)) {
          return lista.map(x => typeof x === 'string' ? x : (x && (x.nomeTag || x.nomeTagCompleto || x.nome || x.tag || x.descricao)) || '')
            .filter(Boolean).join(', ');
        }
      } catch (e) { /* segue como texto */ }
    }
    return s;
  }

  function formatarCNJ(numero) {
    const d = soDigitos(numero);
    if (d.length !== 20) return String(numero == null ? '' : numero).trim();
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
  }

  // Jurisdição Delegada (JD): situações na ordem em que o servidor precisa agir (rejeitadas primeiro) e o plural de cada uma.
  const SITUACOES_JD = [
    ['Rejeitada pelo TRF', 'Rejeitadas pelo TRF'], ['Devolvida', 'Devolvidas'], ['Em Conferência', 'Em Conferência'],
    ['Em Elaboração', 'Em Elaboração'], ['Assinada', 'Assinadas'], ['Autuada no TRF', 'Autuadas no TRF'],
    ['Paga', 'Pagas'], ['Cancelada', 'Canceladas'],
  ];
  const JD_EM_ALERTA = new Set(['Rejeitada pelo TRF', 'Devolvida']);

  // Linhas da planilha do JD (Nº do processo | Nº da requisição | Tipo | Valor | Situação) -> um item por processo:
  // { n: requisições, prc: quantas são PRC, s: { situação: quantidade } }, chaveado pelos 20 dígitos do processo.
  function resumirJD(linhas) {
    const itens = {}; let requisicoes = 0, prc = 0; const vistas = new Set();
    for (const c of linhas) {
      const chave = soDigitos(c && c[0]);
      if (chave.length !== 20) continue;                    // cabeçalho e linhas em branco
      const req = String(c[1] == null ? '' : c[1]).trim(), tipo = String(c[2] == null ? '' : c[2]).trim().toUpperCase(), sit = String(c[4] == null ? '' : c[4]).trim();
      if (!req || !sit || vistas.has(req)) continue;
      vistas.add(req);
      const it = itens[chave] || (itens[chave] = { n: 0, prc: 0, s: {} });
      it.n++; it.s[sit] = (it.s[sit] || 0) + 1; requisicoes++;
      if (tipo === 'PRC') { it.prc++; prc++; }
    }
    return { itens, processos: Object.keys(itens).length, requisicoes, prc };
  }

  // Partes do texto do card, na ordem de urgência: [{ n, rotulo, alerta }]. Situação desconhecida vai ao fim, com o nome original.
  function partesJD(it) {
    const s = it && it.s || {}, partes = [], usadas = new Set();
    for (const [sing, plural] of SITUACOES_JD) {
      if (s[sing]) { partes.push({ n: s[sing], rotulo: s[sing] > 1 ? plural : sing, alerta: JD_EM_ALERTA.has(sing) }); usadas.add(sing); }
    }
    for (const [sit, n] of Object.entries(s)) if (!usadas.has(sit) && n) partes.push({ n, rotulo: sit, alerta: false });
    return partes;
  }

  // 7º algarismo da esquerda para a direita, contando só os dígitos do número.
  function digito(numero) {
    const d = soDigitos(numero);
    return d.length >= 7 ? Number(d[6]) : null;
  }

  // As etiquetas (campo "e") ficam só em memória: servem às regras na importação e não são gravadas.
  function lerCsv(texto) {
    const linhas = lerLinhasCsv(texto);
    if (!linhas.length) throw new Error('O arquivo está vazio.');
    const cabecalho = linhas[0].map(h => h.trim());
    const campos = cabecalho.map(h => CABECALHOS[chaveCab(h)] || null);
    if (!campos.includes('n')) {
      throw new Error('Não encontrei a coluna do número do processo ("numeroProcesso" ou "Número do Processo"). Confira se é o CSV do PJe+R.');
    }
    if (!campos.includes('t')) throw new Error('Não encontrei a coluna da tarefa ("nomeTarefa" ou "Tarefa"). Sem ela não dá para saber o setor de cada processo.');
    const itens = [];
    for (const l of linhas.slice(1)) {
      const o = {};
      campos.forEach((k, i) => { if (k && !(k in o) && l[i] != null && l[i].trim() !== '') o[k] = l[i].trim(); });
      if (!o.n || !soDigitos(o.n)) continue;
      const it = { n: formatarCNJ(o.n) };
      for (const k of ['c', 't', 'cg']) if (o[k]) it[k] = o[k];
      const ch = lerData(o.ch); if (ch != null) it.ch = ch;
      const e = lerEtiquetas(o.e); if (e) it.e = e;
      if (o.sg && lerBooleano(o.sg)) it.sg = true;
      itens.push(it);
    }
    return {
      itens,
      reconhecidas: cabecalho.filter((h, i) => campos[i]),
      ignoradas: cabecalho.filter((h, i) => !campos[i] && h),
      semData: itens.filter(i => i.ch == null).length,
    };
  }

  // Setor composto ("Controle de prazo / Secretaria") vira o setor da vara que aparecer nele; '' = fora da vara.
  function setorPainelDe(texto) {
    for (const parte of normTexto(texto).split('/')) {
      const id = SETORES_VARA[parte.trim()];
      if (id) return id;
    }
    return '';
  }

  // Etiquetas vêm separadas por ", " e algumas têm vírgula interna; compara a etiqueta inteira, com delimitadores.
  function temEtiqueta(etiquetas, alvos) {
    if (!etiquetas || !alvos) return false;
    const lista = ', ' + normTexto(etiquetas) + ',';
    return String(alvos).split('|').map(normTexto).filter(Boolean).some(a => lista.includes(', ' + a + ','));
  }

  // Alternativas separadas por "|": sigla (sem espaço) casa por igualdade; nome por extenso casa por "contém".
  function casaPadrao(valor, padrao) {
    const v = normTexto(valor);
    if (!v) return false;
    return String(padrao || '').split('|').map(normTexto).filter(Boolean).some(p => (p.includes(' ') ? v.includes(p) : v === p));
  }

  function mapaTarefas(tabela) {
    if (tabela instanceof Map) return tabela;
    const lista = Array.isArray(tabela) ? tabela : ((tabela && tabela.itens) || []);
    const m = new Map();
    for (const t of lista) if (t && t.tarefa) m.set(normTexto(t.tarefa), t);
    return m;
  }

  function tipoTarefa(tarefa, tabela) {
    const linha = mapaTarefas(tabela).get(normTexto(tarefa));
    if (!linha) return 'normal';
    return linha.urgente ? 'urgente' : linha.zerar ? 'prioritaria' : 'normal';
  }

  // Urgente também quando a tarefa tem "Urgente se etiqueta" e o processo tem essa etiqueta.
  // Na importação usa as etiquetas (it.e); depois da gravação, a marca fica em it.u.
  function tipoItem(it, tabela) {
    if (it.u) return 'urgente';
    const linha = mapaTarefas(tabela).get(normTexto(it.t));
    if (linha && linha.etiquetaUrgente && temEtiqueta(it.e, linha.etiquetaUrgente)) return 'urgente';
    return tipoTarefa(it.t, tabela);
  }

  // Regras de exceção (classe ou etiqueta), na ordem da configuração, antes da divisão do setor.
  function atribuir(item, setor, config) {
    const cfg = config || {};
    for (const r of cfg.regrasClasse || []) {
      if (!r || !r.padrao || !r.responsavel) continue;
      if (r.setores && r.setores.length && !r.setores.includes(setor)) continue;
      const ok = r.campo === 'etiqueta' ? temEtiqueta(item && item.e, r.padrao) : casaPadrao(item && item.c, r.padrao);
      if (ok) return { pessoa: r.responsavel, motivo: (r.campo === 'etiqueta' ? 'etiqueta' : 'classe') + ': ' + r.padrao };
    }
    const s = (cfg.setores || {})[setor];
    if (!s) return { pessoa: null, motivo: 'setor sem regra' };
    if (s.modo === 'fixo') return s.responsavel ? { pessoa: s.responsavel, motivo: 'responsável do setor' } : { pessoa: null, motivo: 'setor sem responsável' };
    const d = digito(item && item.n);
    if (d == null) return { pessoa: null, motivo: 'número inválido' };
    const p = (s.faixas || [])[d];
    return p ? { pessoa: p, motivo: 'dígito ' + d } : { pessoa: null, motivo: 'dígito ' + d + ' sem responsável' };
  }

  // Quem atende o setor: faixas de dígito ou responsável fixo, mais exceções exclusivas do setor.
  function pessoasDoSetor(setor, config) {
    const cfg = config || {};
    const s = (cfg.setores || {})[setor];
    const ids = new Set();
    if (s && s.modo === 'digito') (s.faixas || []).forEach(p => p && ids.add(p));
    else if (s && s.responsavel) ids.add(s.responsavel);
    for (const r of cfg.regrasClasse || []) {
      if (r && r.responsavel && r.setores && r.setores.length && r.setores.includes(setor)) ids.add(r.responsavel);
    }
    const ordem = (cfg.pessoas || []).map(p => p.id);
    return [...ids].sort((a, b) => (ordem.indexOf(a) + 1 || 999) - (ordem.indexOf(b) + 1 || 999));
  }

  // Tarefa -> setor (tabela) -> pessoa (regras). pessoaFixa: lista inteira para um estagiário ou residente;
  // "resp" guarda o servidor que as regras indicariam, para a devolução.
  function prepararLista(itens, tabela, config, pessoaFixa) {
    const mapa = mapaTarefas(tabela);
    const porPessoa = {}, semResponsavel = [], porSetor = {};
    const ignorados = { foraDaVara: 0, semEtiqueta: 0 };
    // Processos que não entram em fila de servidor (tarefas de outros setores da vara): guardados só para as Metas CNJ.
    const outros = new Map();
    const guardarOutro = it => {
      if (!it.n) return;
      const k = soDigitos(it.n), ja = outros.get(k);
      if (!ja) { const o = { n: it.n }; if (it.t) o.t = it.t; if (it.ch != null) o.ch = it.ch; outros.set(k, o); return; }
      if (it.ch != null && (ja.ch == null || it.ch < ja.ch)) { ja.ch = it.ch; if (it.t) ja.t = it.t; }
    };
    for (const it of itens) {
      const linha = mapa.get(normTexto(it.t));
      if (!linha || !linha.painel) { ignorados.foraDaVara++; guardarOutro(it); continue; }
      if (linha.etiqueta && !temEtiqueta(it.e, linha.etiqueta)) { ignorados.semEtiqueta++; guardarOutro(it); continue; }
      const s = linha.painel;
      const r = atribuir(it, s, config);
      const item = { n: it.n, s };
      for (const k of ['c', 't', 'cg', 'ch', 'sg']) if (it[k] != null) item[k] = it[k];
      if (r.pessoa) item.resp = r.pessoa;
      if (linha.etiquetaUrgente && temEtiqueta(it.e, linha.etiquetaUrgente)) item.u = true;
      // Só as etiquetas escolhidas na configuração, e só em tarefas de Pagamentos, são gravadas (filtro "Etiqueta").
      if (s === 'pagamentos' && it.e) {
        const et = ((config && config.etiquetasFiltro) || []).filter(x => x && temEtiqueta(it.e, x));
        if (et.length) item.et = et;
      }
      porSetor[s] = (porSetor[s] || 0) + 1;
      const pessoa = pessoaFixa || r.pessoa;
      if (!pessoa) { semResponsavel.push(Object.assign(item, { motivo: r.motivo })); continue; }
      (porPessoa[pessoa] = porPessoa[pessoa] || []).push(item);
    }
    return { porPessoa, semResponsavel, ignorados, porSetor, outros: [...outros.values()] };
  }

  // Filas do diretor e do gestor: escolhidas só por etiqueta, em qualquer tarefa ou setor (independem da tabela de tarefas).
  // Um item por processo (o de chegada mais antiga). Diretor: guarda só as etiquetas da lista dele ("ed") e "u" se alguma é urgente.
  const ETIQUETA_GESTOR_PADRAO = 'Alberto - Acompanhar';
  const GESTOR_ID = '__gestor';
  function prepararEspeciais(itens, config) {
    const cfg = config || {};
    const dirEt = (cfg.etiquetasDiretor || []).filter(x => x && x.e);
    const temDiretor = (cfg.pessoas || []).some(p => p.tipo === 'diretor');
    const etGestor = cfg.etiquetaGestor == null ? ETIQUETA_GESTOR_PADRAO : cfg.etiquetaGestor;
    const dir = new Map(), ges = new Map();
    const guardar = (m, it, ed, urg) => {
      const k = soDigitos(it.n);
      const ja = m.get(k);
      if (!ja) { const o = { n: it.n }; for (const c of ['c', 't', 'cg', 'ch', 'sg']) if (it[c] != null) o[c] = it[c]; if (ed) o.ed = [...ed]; if (urg) o.u = true; m.set(k, o); return; }
      if (ed) for (const e of ed) if (!ja.ed.includes(e)) ja.ed.push(e);
      if (urg) ja.u = true;
      const antes = it.ch != null && (ja.ch == null || it.ch < ja.ch);
      if (antes) { for (const c of ['c', 't', 'cg', 'ch']) if (it[c] != null) ja[c] = it[c]; if (it.sg) ja.sg = true; }
    };
    for (const it of itens) {
      if (!it.e) continue;
      if (temDiretor && dirEt.length) {
        const achadas = dirEt.filter(x => temEtiqueta(it.e, x.e));
        if (achadas.length) guardar(dir, it, achadas.map(x => x.e), achadas.some(x => x.u));
      }
      if (etGestor && temEtiqueta(it.e, etGestor)) guardar(ges, it, null, false);
    }
    return { diretor: [...dir.values()], gestor: [...ges.values()] };
  }

  const chaveItem = it => soDigitos(it.n) + '|' + (it.ch == null ? '' : it.ch);

  function bytes(obj) {
    const s = JSON.stringify(obj);
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length * 2;
  }

  function fatiar(itens, limite) {
    const max = limite || 200000;
    const lotes = [];
    let atual = [], tam = 64;
    for (const it of itens) {
      const t = bytes(it) + 1;
      if (atual.length && tam + t > max) { lotes.push(atual); atual = []; tam = 64; }
      atual.push(it); tam += t;
    }
    if (atual.length) lotes.push(atual);
    return lotes;
  }

  function podarMarcas(marcas, agora, dias) {
    const limite = agora - (dias || 90) * 86400000;
    const out = {};
    for (const [k, v] of Object.entries(marcas || {})) if (v && v.em >= limite) out[k] = v;
    return out;
  }

  const GRUPOS = { urgente: 0, devolvido: 1, prioritaria: 2, normal: 3 };
  const LONGE = 8.64e15;
  // Antiguidade = data de chegada do processo; só sem ela (urgência/devolução de processo fora da lista) usa a data de criação.
  const referencia = x => x.ch != null ? x.ch : (x.origem === 'lista' || x.criadaEm == null ? LONGE : x.criadaEm);

  // Em cada seção, os processos com anotação (e ainda não concluídos) vêm primeiro, pela data da anotação (mais antiga primeiro).
  const comAnotacao = x => (x.anotEm != null && !x.concluido ? 0 : 1);

  function comparar(a, b) {
    const g = GRUPOS[a.tipo] - GRUPOS[b.tipo];
    if (g) return g;
    const an = comAnotacao(a) - comAnotacao(b);
    if (an) return an;
    if (comAnotacao(a) === 0) { const t = a.anotEm - b.anotEm; if (t) return t; }
    return (referencia(a) - referencia(b)) || String(a.n).localeCompare(String(b.n));
  }

  // Processos com anotação, ainda não concluídos, que não vieram na lista nova da mesma pessoa: continuam na fila dela
  // (com a data e a tarefa que tinham) até serem concluídos ou a anotação ser excluída. Marcados com fora:true ("Saiu da lista").
  // antigos: itens antes da importação; presentes: itens que ficam; notas: {número só com dígitos: {texto}}; marcas: {chave: {desfeito}}.
  function guardarAnotados(antigos, presentes, notas, marcas) {
    const nots = notas || {}, mars = marcas || {};
    const tem = new Set((presentes || []).map(it => soDigitos(it.n)));
    const por = new Map();
    for (const it of antigos || []) {
      const k = soDigitos(it.n);
      if (tem.has(k) || !(nots[k] && nots[k].texto)) continue;
      const m = mars[chaveItem(it)];
      if (m && !m.desfeito) continue;
      const ja = por.get(k);
      if (!ja || (it.ch == null ? -1 : it.ch) > (ja.ch == null ? -1 : ja.ch)) por.set(k, it);
    }
    return [...por.values()].map(it => Object.assign({}, it, { fora: true }));
  }

  // Junta a lista do PJe + urgências manuais + devoluções numa fila única, sem repetir processo.
  // Urgente/prioritária vêm da tabela de tarefas (colunas "Urgente?" e "Zerar?").
  function montarFila(entrada) {
    const e = entrada || {};
    const mapa = mapaTarefas(e.tarefas);
    const marcas = e.marcas || {};
    const ultimaVisita = e.ultimaVisita || 0;
    // Mesmo processo em mais de uma entrada: se alguma tarefa é de fluxo paralelo, mostra a de chegada
    // mais antiga com o selo "Fluxo paralelo"; senão, a mais recente.
    const grupos = new Map();
    for (const it of e.itens || []) {
      const k = soDigitos(it.n);
      const g = grupos.get(k) || new Map();
      const c = chaveItem(it) + '|' + normTexto(it.t);
      const ja = g.get(c);
      if (!ja || (it.vistoEm && !ja.vistoEm)) g.set(c, it);
      grupos.set(k, g);
    }
    const porNumero = new Map();
    const ch = x => (x.ch == null ? LONGE : x.ch);
    for (const [k, g] of grupos) {
      const lista = [...g.values()];
      if (lista.length === 1) { porNumero.set(k, lista[0]); continue; }
      const tarefas = new Set(lista.map(x => normTexto(x.t)));
      const paralelo = tarefas.size > 1 && lista.some(x => (mapa.get(normTexto(x.t)) || {}).paralelo);
      const escolhido = paralelo
        ? lista.reduce((a, b) => (ch(b) < ch(a) ? b : a))
        : lista.reduce((a, b) => ((b.ch == null ? -1 : b.ch) > (a.ch == null ? -1 : a.ch) ? b : a));
      porNumero.set(k, paralelo ? Object.assign({}, escolhido, { fp: true, u: lista.some(x => x.u) || escolhido.u }) : escolhido);
    }
    const linhas = [];
    const especiais = [
      ...(e.urgencias || []).map(u => ({ fonte: u, origem: 'urgencia', tipo: 'urgente', em: u.criadaEm, numero: u.numero })),
      ...(e.devolucoes || []).map(d => ({ fonte: d, origem: 'devolucao', tipo: 'devolvido', em: d.em, numero: (d.item || {}).n })),
    ];
    const usados = new Set();
    for (const x of especiais) {
      const k = soDigitos(x.numero);
      const base = porNumero.get(k);
      if (base) usados.add(k);
      const f = x.fonte;
      linhas.push(Object.assign({}, base || {}, f.item || {}, {
        n: formatarCNJ(x.numero), origem: x.origem, via: f.via, tipo: x.tipo, id: f.id, motivo: f.motivo || '',
        de: f.de, por: f.criadaPor, criadaEm: x.em, chave: (x.origem === 'urgencia' ? 'u:' : 'd:') + f.id,
        concluido: !!f.concluidaEm, novo: (x.em || 0) > ultimaVisita,
      }));
    }
    for (const [k, it] of porNumero) {
      if (usados.has(k)) continue;
      const tipo = tipoItem(it, mapa);
      const chave = chaveItem(it);
      linhas.push(Object.assign({}, it, {
        origem: 'lista', tipo, chave,
        concluido: !!marcas[chave], devolvido: !!(marcas[chave] && marcas[chave].dev),
        novo: tipo !== 'normal' && !!it.vistoEm && it.vistoEm > ultimaVisita,
      }));
    }
    linhas.sort(comparar);
    return linhas;
  }

  function paraCsv(linhas, nomes, comResp) {
    const cols = [
      ['Número do Processo', l => l.n],
      ...(comResp ? [['Responsável', l => (nomes && nomes[l.dono]) || l.dono || '']] : []),
      ['Situação', l => ({ urgente: 'Urgente', devolvido: 'Devolvido', prioritaria: 'Prioritária', normal: '' })[l.tipo] + (l.concluido ? ' (concluído)' : '')],
      ['Classe', l => l.c], ['Tarefa', l => l.t], ['Cargo Judicial', l => l.cg],
      ['Data de Chegada', l => l.ch ? new Date(l.ch).toLocaleDateString('pt-BR') : ''],
      ['Anotação', l => l.anot],
      ['Observação', l => l.motivo ? (l.origem === 'devolucao' ? 'Devolvido por ' + ((nomes && nomes[l.de]) || l.de || '') + ': ' : '') + l.motivo : ''],
    ];
    const q = v => { const s = String(v == null ? '' : v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + [cols.map(c => q(c[0])).join(';'), ...linhas.map(l => cols.map(c => q(c[1](l))).join(';'))].join('\r\n');
  }

  function tarefasParaCsv(itens) {
    const cols = [['Tarefa', t => t.tarefa], ['Setor responsável', t => t.setor], ['Setor no painel', t => t.painel], ['Etiqueta exigida', t => t.etiqueta],
      ['Urgente?', t => (t.urgente ? 'Sim' : 'Não')], ['Urgente se etiqueta', t => t.etiquetaUrgente], ['Zerar?', t => (t.zerar ? 'Sim' : 'Não')], ['Fluxo Paralelo?', t => (t.paralelo ? 'Fluxo Paralelo' : '')]];
    const q = v => { const s = String(v == null ? '' : v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + [cols.map(c => q(c[0])).join(';'), ...itens.map(t => cols.map(c => q(c[1](t))).join(';'))].join('\r\n');
  }

  function slug(s) {
    return semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pessoa';
  }

  root.Regras = {
    lerCsv, lerLinhasCsv, lerData, digito, formatarCNJ, setorPainelDe, temEtiqueta, casaPadrao, mapaTarefas, tipoTarefa, tipoItem,
    atribuir, pessoasDoSetor, prepararLista, prepararEspeciais, guardarAnotados, ETIQUETA_GESTOR_PADRAO, GESTOR_ID, resumirJD, partesJD, fatiar, podarMarcas, montarFila, comparar, chaveItem,
    paraCsv, tarefasParaCsv, slug, normTexto, soDigitos,
  };
})(typeof window !== 'undefined' ? window : globalThis);
