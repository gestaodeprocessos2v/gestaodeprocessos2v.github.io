/* Fila de Trabalho da Vara — área "Inspeção Integrada" (todos os perfis, só leitura) e, no Painel do Gestor, o envio das três
   listas do painel "Inspeção integrada" do BI (processos críticos, sem movimentação e com conclusão antiga).
   A lógica pura (leitura dos CSV, reunião das listas e prioridade sugerida) está em inspecao.js; os dados ficam em
   inspecao_envios (sql/inspecao.sql). A tarefa atual, o setor e a chegada vêm das filas do PJe+R que o painel já tem. */
(function () {
  'use strict';
  const P = window.PAINEL, I = window.Inspecao;
  if (!P || !P.render || !I) return;
  const { st, R, esc, toast, falha, iso, ms, dataBR, dataHoraBR, faixaMagHTML, magPassa, alternarMag, magPadrao, magOffDe, letraMagHTML, numeroHTML, MAGISTRADOS, SETORES, NOME_SETOR } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const nBR = n => Number(n || 0).toLocaleString('pt-BR');
  const CHAVES_SETOR = SETORES.map(s => s[0]);
  const FORA = 'fora', ROT_FORA = 'Fora da lista do PJe+R';
  const NOMES_PAINEL = new Set(SETORES.map(s => R.normTexto(s[1])));
  const LIMITE_MAIS = 300;

  // ---------- dados do envio mais recente (inspecao_envios) ----------
  const D = () => st.inspecao || (st.inspecao = { envio: null, itens: [], itensDe: null, carregando: false, erro: false, checadoEm: 0 });
  // itens: false lê só os dados do envio (usado pelo Painel do Gestor); true lê também os processos (ao abrir a área).
  async function carregarInspecao(o) {
    const d = D(); const opc = o || {};
    if (d.carregando) return;
    d.carregando = true;
    try {
      const { data, error } = await st.sb.from('inspecao_envios').select('id,carga_bi,enviado_em,enviado_por,trimestre,n_criticos,n_semmov,n_conclusao,arquivos')
        .order('carga_bi', { ascending: false }).order('id', { ascending: false }).limit(1);
      if (error) throw error;
      const e = data && data[0];
      if (!e) { d.envio = null; d.itens = []; d.itensDe = null; }
      else {
        d.envio = { id: e.id, carga: ms(e.carga_bi), enviadoEm: ms(e.enviado_em), por: e.enviado_por, trimestre: e.trimestre || '', n: { c: e.n_criticos, s: e.n_semmov, k: e.n_conclusao }, arquivos: e.arquivos || [] };
        if (opc.itens && (opc.forcar || d.itensDe !== e.id)) {
          const r = await st.sb.from('inspecao_envios').select('itens').eq('id', e.id).single();
          if (r.error) throw r.error;
          d.itens = r.data.itens || []; d.itensDe = e.id;
        }
      }
      d.erro = false;
    } catch (err) { console.error(err); d.erro = true; }
    d.carregando = false; d.checadoEm = Date.now();
    if (opc.itens && st.area === 'inspecao') render();   // a leitura sem os processos roda dentro de carregar(), que já é seguido de um desenho
  }
  P.carregarInspecao = carregarInspecao;

  // Tarefas fora das filas (fora_vara.parados): as mesmas que a área Processos Parados lê; só entram aqui para achar a tarefa atual.
  const ext = { itens: [], lidoLista: -1, carregando: false };
  async function carregarExtras(ultimaLista) {
    ext.carregando = true;
    try {
      const { data, error } = await st.sb.from('fora_vara').select('parados').eq('id', 1).maybeSingle();
      if (error) throw error;
      ext.itens = (data && data.parados) || [];
    } catch (e) { console.error(e); }
    ext.lidoLista = ultimaLista; ext.carregando = false;
    if (st.area === 'inspecao') render();
  }
  const dataLista = () => st.filas.reduce((m, r) => Math.max(m, ms(r.importado_em) || 0), 0);

  // ---------- junção com o painel: tarefa atual, setor, chegada e magistrado(a) ----------
  let rotExtras = new Map();
  const rotuloSetor = s => NOME_SETOR[s] || rotExtras.get(s) || '';
  function nomearExtras(base) {
    rotExtras = new Map();
    for (const l of base) if (l.rotSetor && !rotExtras.has(l.s)) rotExtras.set(l.s, NOMES_PAINEL.has(R.normTexto(l.rotSetor)) ? l.rotSetor + ' (fora das filas)' : l.rotSetor);
  }
  function montarLinhas() {
    const d = D(), carga = d.envio ? d.envio.carga : null;
    const base = R.linhasPorSetor({ filas: st.filas, extras: ext.itens, setores: CHAVES_SETOR, tarefas: st.mapaTarefas, marcas: P.marcasVigentesTodas(), urgencias: st.urgencias, prazos: P.prazosRetorno() });
    nomearExtras(base);
    const porNumero = new Map();
    for (const l of base) { const k = R.soDigitos(l.n); (porNumero.get(k) || porNumero.set(k, []).get(k)).push(l); }
    return d.itens.map(it => {
      const ls = porNumero.get(R.soDigitos(it.n)) || [], p = ls[0] || null;
      const tarefas = [...new Set(ls.map(l => l.t).filter(Boolean))];
      const a = I.analisar(it, { tarefas, cheg: p && p.ch != null ? p.ch : null, carga });
      const tarefaBI = I.semCodigo(it.ts || it.tk || '');
      return {
        it, a, n: it.n, listas: it.l.join(''),
        classe: it.cl ? I.semCodigo(it.cl) : (p && p.c) || '',
        tarefa: tarefas.length ? tarefas.join(' | ') : tarefaBI, tarefaBI: !tarefas.length && !!tarefaBI,
        setorKey: p ? p.s : FORA, setor: p ? rotuloSetor(p.s) : ROT_FORA,
        cheg: p && p.ch != null ? p.ch : null, mag: p ? p.mag || null : null, dias: I.diasDe(it),
      };
    });
  }

  // ---------- tela ----------
  const COLUNAS = [
    ['n', 'Número do processo'], ['c', 'Classe'], ['t', 'Tarefa'], ['s', 'Setor'], ['ch', 'Data de chegada'], ['l', 'Listas do BI'], ['prio', 'Prioridade'], ['d', 'Dias parado', 'n'],
  ];
  const valorOrdem = (r, c) => (c === 'n' ? R.soDigitos(r.n) : c === 'c' ? r.classe : c === 't' ? r.tarefa : c === 's' ? r.setor : c === 'ch' ? r.cheg : c === 'l' ? r.listas : c === 'prio' ? r.a.n : r.dias);
  function ordenar(rs, f) {
    const c0 = f.ordem === 'prio' ? 'prio' : f.ordem;
    return [...rs].sort((a, b) => {
      const x = valorOrdem(a, c0), y = valorOrdem(b, c0);
      const vx = x == null || x === '', vy = y == null || y === '';
      if (vx || vy) return vx === vy ? 0 : vx ? 1 : -1;   // sem valor fica sempre no fim
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR');
      return (c * f.dir) || (a.a.n - b.a.n) || (b.dias - a.dias) || String(a.n).localeCompare(String(b.n));
    });
  }
  const CLASSE_PRIO = { 1: 'urgente', 2: 'prioritaria', 3: 'sigilo', 4: 'devolvido', 5: 'feito' };
  const ROT_CURTO = { c: 'Crítico', s: 'Sem mov.', k: 'Conclusão' };
  const BALAO_PRIO = 'Sugestão do painel (não é do BI):\n' + [1, 2, 3, 4, 5].map(n => `${n} ${I.ROTULO_PRIORIDADE[n]}: ${I.DESCRICAO_PRIORIDADE[n]}`).join('\n');
  const BALAO_BI = 'Tarefa do BI: o processo não está na lista do PJe+R';
  const opcaoHTML = (x, rot, n, atual) => `<option value="${esc(x)}"${String(x) === String(atual) ? ' selected' : ''}>${esc(rot)} (${nBR(n)})</option>`;

  function linhaHTML(r) {
    const listas = r.it.l.map(x => `<span class="selo sigilo">${ROT_CURTO[x]}</span>`).join(' ');
    const tarefa = r.tarefa ? (r.tarefaBI ? `<span tabindex="0" role="note" data-balao="${BALAO_BI}" aria-description="${BALAO_BI}">${esc(r.tarefa)} <span class="muted">(BI)</span></span>` : esc(r.tarefa)) : '—';
    const mudou = r.a.mudou ? ' <span class="selo novo" data-balao="O processo mudou de tarefa desde a carga do BI" aria-description="O processo mudou de tarefa desde a carga do BI">mudou</span>' : '';
    return `<tr>
      <td class="nowrap"><button type="button" class="num" data-acao="copiar" data-n="${esc(r.n)}" data-balao="Copiar número" aria-description="Copiar número">${numeroHTML(r.n)}${letraMagHTML(r.mag)}</button>${window.PAINEL.etiquetaRecomendacao ? window.PAINEL.etiquetaRecomendacao({ n: r.n }) : ''}</td>
      <td>${esc(r.classe || '—')}</td><td>${tarefa}${mudou}</td><td>${esc(r.setor)}</td><td class="nowrap">${r.cheg ? dataBR(r.cheg) : '—'}</td>
      <td>${listas}</td>
      <td class="ins-prio"><span class="selo ${CLASSE_PRIO[r.a.n]}">${r.a.n} · ${esc(r.a.rotulo)}</span><div class="small muted">${esc(r.a.motivos.join('; '))}</div></td>
      <td class="n par-dias">${nBR(r.dias)}</td></tr>`;
  }

  // Quadro por setor: processos, quantos em cada lista, quantos de prioridade 1 e 2 e o maior tempo parado.
  function resumoSetores(rs) {
    const m = new Map();
    for (const r of rs) {
      const g = m.get(r.setorKey) || m.set(r.setorKey, { k: r.setorKey, rot: r.setor, n: 0, c: 0, s: 0, kk: 0, alta: 0, maior: 0 }).get(r.setorKey);
      g.n++; if (r.listas.includes('c')) g.c++; if (r.listas.includes('s')) g.s++; if (r.listas.includes('k')) g.kk++;
      if (r.a.n <= 2) g.alta++; g.maior = Math.max(g.maior, r.dias);
    }
    const ordem = k => { const i = CHAVES_SETOR.indexOf(k); return i >= 0 ? i : k === FORA ? 999 : 100; };
    const gs = [...m.values()].sort((a, b) => ordem(a.k) - ordem(b.k) || b.n - a.n || a.rot.localeCompare(b.rot, 'pt-BR'));
    if (!gs.length) return '';
    return `<section class="painel largo"><h3>Por setor</h3><div class="tabela-wrap"><table class="par-tabela"><thead><tr><th>Setor</th><th class="n">Processos</th><th class="n">Críticos</th><th class="n">Sem movimentação</th><th class="n">Conclusão antiga</th><th class="n">Prioridade 1 e 2</th><th class="n">Maior tempo (dias)</th></tr></thead><tbody>
      ${gs.map(g => `<tr><td>${esc(g.rot)}</td><td class="n">${nBR(g.n)}</td><td class="n">${nBR(g.c)}</td><td class="n">${nBR(g.s)}</td><td class="n">${nBR(g.kk)}</td><td class="n">${nBR(g.alta)}</td><td class="n">${nBR(g.maior)}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  }

  // Planilha (.xlsx) no padrão do painel (P.baixarPlanilha): a lista da última tela desenhada, com os mesmos filtros e a mesma ordem.
  let listaAtual = [];
  const COLUNAS_XLSX = [
    { t: 'Número do processo', largura: 27 }, { t: 'Magistrado(a)', largura: 13 }, { t: 'Classe', largura: 30 }, { t: 'Tarefa', largura: 44 }, { t: 'Setor', largura: 22 },
    { t: 'Data de chegada', tipo: 'data', largura: 15 }, { t: 'Listas do BI', largura: 30 }, { t: 'Prioridade (sugestão)', largura: 22 }, { t: 'Dias parado', tipo: 'numero', largura: 12 },
    { t: 'Impacto (BI)', largura: 12 }, { t: 'Metas afetadas', largura: 16 }, { t: 'Última movimentação (BI)', tipo: 'data', largura: 16 }, { t: 'Último movimento (BI)', largura: 28 },
    { t: 'Data da conclusão (BI)', tipo: 'data', largura: 16 }, { t: 'Tipo de conclusão (BI)', largura: 28 }, { t: 'Motivo', largura: 60 },
  ];
  function baixarPlanilha() {
    const f = st.fInspecao, e = D().envio;
    const linhas = listaAtual.map(r => [r.n, ({ T: 'Titular', S: 'Substituta' })[r.mag] || '', r.classe, r.tarefa + (r.tarefaBI ? ' (BI)' : ''), r.setor, r.cheg, r.it.l.map(x => I.ROTULO_LISTA[x]).join(', '),
      `${r.a.n} - ${r.a.rotulo}`, r.dias, r.it.imp || '', r.it.mt || '', r.it.um || null, r.it.umv || '', r.it.dc || null, r.it.tc || '', r.a.motivos.join('; ')]);
    P.baixarPlanilha({
      arquivo: 'inspecao-integrada', titulo: 'Inspeção Integrada', aba: 'Inspeção', colunas: COLUNAS_XLSX, linhas,
      fonte: [`Carga do BI: ${e ? dataHoraBR(e.carga) : '—'}${e && e.trimestre ? ' · ' + e.trimestre : ''}`, 'Prioridade: sugestão do painel, não do BI'],
      filtros: [P.textoMagistrados(f), f.lista && 'Lista: ' + I.ROTULO_LISTA[f.lista], f.prio && 'Prioridade: ' + f.prio + ' - ' + I.ROTULO_PRIORIDADE[f.prio], f.setor && 'Setor: ' + (f.setor === FORA ? ROT_FORA : rotuloSetor(f.setor))],
      total: `${nBR(linhas.length)} ${linhas.length === 1 ? 'processo' : 'processos'}`,
    });
  }

  function tela() {
    const d = D(), e = d.envio, f = st.fInspecao;
    if (!e || d.itensDe !== e.id) {
      return `<div class="vazio"><h2>Inspeção Integrada</h2><p>${d.erro ? 'Não consegui ler agora os dados da Inspeção Integrada. Tente de novo em instantes.' : e || d.carregando || !d.checadoEm ? 'Carregando…'
        : 'Ainda não há dados da Inspeção Integrada no painel.' + (st.perfil === 'gestor' ? ' Envie as listas em Painel do Gestor → Extração de dados.' : ' O gestor ainda não enviou as listas do BI.')}</p></div>`;
    }
    const todas = montarLinhas();
    const nenhumMag = magOffDe(f).length >= MAGISTRADOS.length;
    const passa = (r, ign) => (ign === 'mag' || (!nenhumMag && magPassa(f, r.mag)))
      && (ign === 'lista' || !f.lista || r.listas.includes(f.lista))
      && (ign === 'prio' || !f.prio || String(r.a.n) === String(f.prio))
      && (ign === 'setor' || !f.setor || r.setorKey === f.setor);
    const filtradas = todas.filter(r => passa(r));
    const lista = ordenar(filtradas, f);
    listaAtual = nenhumMag ? [] : lista;
    const cont = (fn, ign) => todas.filter(r => passa(r, ign) && fn(r)).length;
    const nl = I.contagens(filtradas.map(r => r.it));
    // Opções: só as que têm processos, com a quantidade (com os outros filtros aplicados); a já escolhida fica mesmo com zero.
    const opLista = I.LISTAS.map(([x, rot]) => ({ x, rot, n: cont(r => r.listas.includes(x), 'lista') })).filter(o => o.n || o.x === f.lista).map(o => opcaoHTML(o.x, o.rot, o.n, f.lista)).join('');
    const opPrio = [1, 2, 3, 4, 5].map(n => ({ n, n2: cont(r => r.a.n === n, 'prio') })).filter(o => o.n2 || String(o.n) === String(f.prio)).map(o => opcaoHTML(o.n, `${o.n} - ${I.ROTULO_PRIORIDADE[o.n]}`, o.n2, f.prio)).join('');
    const contaSetor = new Map(); for (const r of todas) if (passa(r, 'setor')) { const s = contaSetor.get(r.setorKey) || { n: 0, rot: r.setor }; s.n++; contaSetor.set(r.setorKey, s); }
    const opSetores = SETORES.filter(([x]) => contaSetor.get(x) || x === f.setor).map(([x, rot]) => opcaoHTML(x, rot, (contaSetor.get(x) || {}).n || 0, f.setor)).join('');
    const extrasIds = [...contaSetor.keys()].filter(x => !CHAVES_SETOR.includes(x) && x !== FORA).sort((a, b) => contaSetor.get(a).rot.localeCompare(contaSetor.get(b).rot, 'pt-BR'));
    if (f.setor && !CHAVES_SETOR.includes(f.setor) && f.setor !== FORA && !extrasIds.includes(f.setor)) extrasIds.push(f.setor);
    const opExtras = extrasIds.map(x => opcaoHTML(x, (contaSetor.get(x) || {}).rot || rotuloSetor(x) || x.slice(2), (contaSetor.get(x) || {}).n || 0, f.setor)).join('')
      + (contaSetor.get(FORA) || f.setor === FORA ? opcaoHTML(FORA, ROT_FORA, (contaSetor.get(FORA) || {}).n || 0, f.setor) : '');
    const faixa = faixaMagHTML(f, letra => cont(r => r.mag === letra, 'mag'), 'ins-', 'rot-mag-inspecao');
    const th = ([c, r, cls]) => {
      const bal = c === 'prio' ? ` data-balao="${esc(BALAO_PRIO)}" aria-description="${esc(BALAO_PRIO)}"` : '';
      return `<th${cls ? ` class="${cls}"` : ''} aria-sort="${f.ordem === c ? (f.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="prod-th" data-acao="ins-ordem" data-campo="${c}"${bal}>${r}${f.ordem === c ? (f.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    };
    const mostradas = lista.slice(0, f.limite);
    const corpo = nenhumMag ? '<div class="vazio"><p>Selecione ao menos um(a) magistrado(a).</p></div>'
      : !lista.length ? '<div class="vazio"><p>Nenhum processo com esses filtros.</p></div>'
      : `${resumoSetores(filtradas)}<section class="painel largo"><h3>Processos</h3><div class="tabela-wrap"><table class="par-tabela"><thead><tr>${COLUNAS.map(th).join('')}</tr></thead><tbody>${mostradas.map(linhaHTML).join('')}</tbody></table></div>
        ${lista.length > mostradas.length ? `<div class="linha-botoes"><button type="button" class="btn" data-acao="ins-mais">Mostrar mais ${nBR(Math.min(LIMITE_MAIS, lista.length - mostradas.length))}</button><span class="small muted mono">${nBR(mostradas.length)} de ${nBR(lista.length)}</span></div>` : ''}</section>`;
    const ultimaLista = dataLista();
    return `<div class="contagens par-contagens">
        <div class="tile"><span>Processos</span><b>${nBR(filtradas.length)}</b></div>
        <div class="tile"><span>Críticos</span><b>${nBR(nl.criticos)}</b></div>
        <div class="tile"><span>Sem movimentação</span><b>${nBR(nl.semmov)}</b></div>
        <div class="tile"><span>Conclusão antiga</span><b>${nBR(nl.conclusao)}</b></div>
      </div>
      <p class="atualizacao">Carga do BI: ${dataHoraBR(e.carga)}${e.trimestre ? ' · ' + esc(e.trimestre) : ''} · Lista do PJe: ${ultimaLista ? dataHoraBR(ultimaLista) : 'ainda não enviada'} · Tarefa, setor e chegada vêm do PJe+R; sem ele, vale a tarefa do BI · Prioridade é sugestão do painel, não do BI · Clique no número para copiar.</p>
      ${d.erro ? '<div class="aviso">Não consegui atualizar agora; a tela mostra o último envio lido.</div>' : ''}
      ${faixa}
      <div class="filtros par-filtros">
        <select id="ins-lista" aria-label="Filtrar por lista do BI"><option value="">Todas as listas</option>${opLista}</select>
        <select id="ins-prio" aria-label="Filtrar por prioridade"><option value="">Todas as prioridades</option>${opPrio}</select>
        <select id="ins-setor" class="sel-linhas" aria-label="Filtrar por setor"><option value="">Todos os setores</option>${opSetores}${opExtras ? '<hr>' + opExtras : ''}</select>
        <span class="direita"><span class="small muted mono">${nBR(lista.length)} ${lista.length === 1 ? 'processo' : 'processos'}</span><button type="button" class="btn" data-acao="ins-xlsx"${lista.length && !nenhumMag ? '' : ' disabled'} data-balao="${P.BALAO_PLANILHA('os processos')}" data-balao-dir="dir" aria-description="${P.BALAO_PLANILHA('os processos')}">Baixar planilha</button></span>
      </div>
      ${corpo}`;
  }

  // A atualização automática do painel só redesenha se algo mudou: não tira o foco de quem está usando um filtro.
  let ultimoHtml = '';
  P.renderInspecao = function () {
    const tl = $('#v-inspecao'), d = D();
    if (!P.PERFIS_INSPECAO.includes(st.perfil)) { tl.innerHTML = '<div class="vazio"><h2>Inspeção Integrada</h2><p>Esta área não está liberada para o seu perfil.</p></div>'; ultimoHtml = ''; return; }
    // Lê ao abrir a área, quando o envio mudou e a cada cerca de 1 minuto (sem envio nenhum, não insiste a cada desenho da tela).
    if (!d.carregando && (!d.checadoEm || (d.envio && d.itensDe !== d.envio.id) || Date.now() - d.checadoEm > 55000)) carregarInspecao({ itens: true });
    const ultimaLista = dataLista();
    if (!ext.carregando && ext.lidoLista !== ultimaLista) carregarExtras(ultimaLista);
    const h = tela();
    if (h === ultimoHtml && tl.innerHTML) return;
    ultimoHtml = h; tl.innerHTML = h;
  };

  const v = $('#v-inspecao');
  v.addEventListener('click', async e => {
    const a = e.target.closest('[data-acao]'); if (!a) return;
    const f = st.fInspecao, acao = a.dataset.acao;
    if (acao === 'copiar') {
      const n = a.dataset.n;
      try { await navigator.clipboard.writeText(n); toast('Número copiado: ' + n); }
      catch (err) { const r = document.createRange(); r.selectNodeContents(a); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Número selecionado. Use Ctrl+C para copiar.'); }
    } else if (acao === 'ins-mag') {
      const l = a.dataset.v; alternarMag(f, l); render();
      const b = v.querySelector(`[data-acao="ins-mag"][data-v="${l}"]`); if (b) b.focus();
    } else if (acao === 'ins-mag-padrao') { f.magOff = magPadrao(f); render(); }
    else if (acao === 'ins-xlsx') baixarPlanilha();
    else if (acao === 'ins-mais') { f.limite += LIMITE_MAIS; render(); }
    else if (acao === 'ins-ordem') {
      const c = a.dataset.campo;
      if (f.ordem === c) f.dir = -f.dir; else { f.ordem = c; f.dir = c === 'd' ? -1 : 1; }
      render();
      const b = v.querySelector(`[data-acao="ins-ordem"][data-campo="${c}"]`); if (b) b.focus();
    }
  });
  v.addEventListener('change', e => {
    const f = st.fInspecao, id = e.target.id;
    if (id === 'ins-lista') f.lista = e.target.value;
    else if (id === 'ins-prio') f.prio = e.target.value;
    else if (id === 'ins-setor') f.setor = e.target.value;
    else return;
    f.limite = LIMITE_MAIS;
    render();
    const b = document.getElementById(id); if (b) b.focus();
  });

  // ---------- Painel do Gestor → Extração de dados: envio das três listas ----------
  const imp = () => st.insImp || (st.insImp = { lotes: [], ignoradas: 0, erro: '', carga: '', tri: '', gravando: false });
  const cargaMs = () => { const t = new Date(imp().carga).getTime(); return isNaN(t) ? null : t; };
  async function lerTexto(arquivo) {
    const buf = await arquivo.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('windows-1252').decode(buf); }
  }
  async function lerArquivos(arquivos) {
    const s = imp(); s.lotes = []; s.erro = ''; s.ignoradas = 0;
    const erros = [];
    for (const arq of arquivos || []) {
      try {
        const r = I.lerArquivoBI(await lerTexto(arq));
        s.lotes = s.lotes.filter(x => x.lista !== r.lista).concat([{ lista: r.lista, itens: r.itens, nome: arq.name }]);   // a mesma lista duas vezes: vale a última
        s.ignoradas += r.ignoradas;
      } catch (e) { erros.push(`${arq.name}: ${e.message || 'não consegui ler'}`); }
    }
    if (erros.length) s.erro = erros.join(' ');
    render();
  }
  P.painelInspecaoGestao = function () {
    const s = imp(), e = D().envio, em = cargaMs();
    const itens = s.lotes.length ? I.consolidar(s.lotes) : [];
    const cont = I.contagens(itens);
    const faltam = I.LISTAS.filter(([x]) => !s.lotes.some(l => l.lista === x)).map(([, rot]) => rot);
    const pronto = s.lotes.length === 3 && em != null && !s.gravando;
    const atual = e ? `<p class="small muted">Inspeção Integrada no painel: carga do BI de ${esc(dataHoraBR(e.carga))}, enviada em ${esc(dataHoraBR(e.enviadoEm))} (${nBR(e.n.c)} críticos, ${nBR(e.n.s)} sem movimentação, ${nBR(e.n.k)} com conclusão antiga).</p>` : '<p class="small muted">Ainda não há dados da Inspeção Integrada no painel.</p>';
    const velho = s.lotes.length && em != null && e && em < e.carga ? `<div class="aviso novo">Os dados que estão no painel são de uma carga mais nova do BI (${esc(dataHoraBR(e.carga))}). Gravar estes arquivos os substitui.</div>` : '';
    const previa = s.erro ? `<div class="aviso erro">${esc(s.erro)}</div>` : s.lotes.length ? `<div class="previa">
        ${I.LISTAS.map(([x, rot]) => { const l = s.lotes.find(y => y.lista === x); return `<div>${esc(rot)}: ${l ? `<b>${nBR(l.itens.length)} processos</b> em “${esc(l.nome)}”` : '<span class="muted">arquivo não enviado</span>'}</div>`; }).join('')}
        <div class="small">${nBR(cont.processos)} processos diferentes (um processo pode estar em mais de uma lista).${s.ignoradas ? ` ${nBR(s.ignoradas)} ${s.ignoradas === 1 ? 'linha ignorada' : 'linhas ignoradas'} (sem número de processo com 20 dígitos).` : ''}</div>
      </div>` : '';
    const aviso = s.lotes.length && faltam.length ? `<div class="aviso novo">Faltam: ${esc(faltam.join(', '))}. Só dá para gravar com as três listas, da mesma carga do BI.</div>` : '';
    return `<section class="painel">
      <h2>Enviar a Inspeção Integrada (BI)</h2>
      <p>No painel “Inspeção integrada” do BI (serventia “PB - 2ª Vara Federal”), abra o trimestre, a aba “Processos críticos e sem movimentação” e use o botão <b>Exportar</b> de cada uma das três listas. Escolha aqui os três arquivos .csv de uma vez. O painel reconhece cada lista pelas colunas. Cada envio entra como a carga mais recente; os 20 últimos ficam guardados.</p>
      ${atual}
      <label class="campo"><span>Arquivos .csv do BI (os três)</span><input type="file" id="ins-arquivos" accept=".csv,text/csv,text/plain" multiple></label>
      <label class="campo"><span>Data e hora da carga do BI (“Dados atualizados em”, no cabeçalho do painel)</span><input type="datetime-local" id="ins-carga" value="${esc(s.carga)}"></label>
      <label class="campo"><span>Trimestre (opcional)</span><input type="text" id="ins-tri" maxlength="40" placeholder="ex.: 3º Trimestre" value="${esc(s.tri)}"></label>
      ${previa}${aviso}${velho}
      <div class="linha-botoes">
        <button class="btn primario" type="button" data-acao="ins-gravar" ${pronto ? '' : 'disabled'}>${s.gravando ? 'Gravando…' : 'Gravar Inspeção Integrada'}</button>
        ${s.lotes.length || s.erro ? '<button class="btn" type="button" data-acao="ins-limpar">Limpar</button>' : ''}
      </div>
    </section>`;
  };

  async function gravar() {
    const s = imp(), em = cargaMs();
    if (s.lotes.length !== 3 || em == null || s.gravando) return;
    const itens = I.consolidar(s.lotes), c = I.contagens(itens);
    s.gravando = true; render();
    try {
      const { error } = await st.sb.rpc('gravar_inspecao', {
        p_carga: iso(em), p_trimestre: s.tri || '', p_arquivos: s.lotes.map(l => ({ nome: l.nome, lista: l.lista, n: l.itens.length })), p_itens: itens,
        p_n_criticos: c.criticos, p_n_semmov: c.semmov, p_n_conclusao: c.conclusao, p_email: st.email,
      });
      if (error) throw error;
      st.insImp = null;
      toast('Inspeção Integrada gravada.');
      await carregarInspecao({ itens: true, forcar: true });
    } catch (e) { falha(e); s.gravando = false; }
    render();
  }

  const vg = $('#v-gestao');
  vg.addEventListener('change', e => {
    if (e.target.id === 'ins-arquivos') lerArquivos([...(e.target.files || [])]);
    else if (e.target.id === 'ins-carga') { imp().carga = e.target.value; render(); }
  });
  vg.addEventListener('input', e => {
    if (e.target.id === 'ins-carga') imp().carga = e.target.value;
    else if (e.target.id === 'ins-tri') imp().tri = e.target.value;
  });
  vg.addEventListener('click', async e => {
    const a = e.target.closest('[data-acao]'); if (!a || !a.dataset.acao.startsWith('ins-')) return;
    try {
      if (a.dataset.acao === 'ins-gravar') await gravar();
      else if (a.dataset.acao === 'ins-limpar') { st.insImp = null; render(); }
    } catch (err) { falha(err); }
  });
})();
