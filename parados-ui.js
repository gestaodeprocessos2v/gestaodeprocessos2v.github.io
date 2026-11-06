/* Fila de Trabalho da Vara — área "Processos Parados" (só gestor, diretor e magistrado(a)): processos em tarefas de Secretaria
   há mais dias que o limite. Os dados são os das filas gravadas no envio do PJe+R; a regra está em R.linhasSecretaria (regras.js). */
(function () {
  'use strict';
  const P = window.PAINEL;
  if (!P || !P.render) return;
  const { st, R, esc, toast, dataBR, dataHoraBR, ms, nomeDe, faixaMagHTML, magPassa, magOffDe, alternarMag, magPadrao, letraMagHTML, numeroHTML, MAGISTRADOS } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const nBR = n => Number(n || 0).toLocaleString('pt-BR');
  const LIMITE_PADRAO = 120;
  const podeVer = () => P.PERFIS_PARADOS.includes(st.perfil);
  const processos = ls => new Set(ls.map(l => R.soDigitos(l.n))).size;
  const acima = (l, limite) => l.dias != null && l.dias > limite;

  // Mesma ordem e mesmos nomes da Fila de Trabalho; Dias na tarefa e Servidor responsável em seguida.
  const COLUNAS = [
    ['n', 'Número do processo'], ['c', 'Classe'], ['t', 'Tarefa'], ['ch', 'Data de chegada'], ['dias', 'Dias na tarefa', 'n'], ['resp', 'Servidor responsável'],
  ];
  const valorOrdem = (l, c) => (c === 'resp' ? nomeDe(l.resp) : l[c]);
  function ordenar(ls, f) {
    const dir = f.dir;
    return [...ls].sort((a, b) => {
      const x = valorOrdem(a, f.ordem), y = valorOrdem(b, f.ordem);
      const vazioX = x == null || x === '', vazioY = y == null || y === '';
      if (vazioX || vazioY) return vazioX === vazioY ? 0 : vazioX ? 1 : -1; // sem valor fica sempre no fim
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR');
      return (c * dir) || (b.dias || 0) - (a.dias || 0) || String(a.n).localeCompare(String(b.n));
    });
  }

  const BALAO_CONCLUIDO = 'O servidor marcou como concluído no painel, mas o processo continua nesta tarefa do PJe';
  function selos(l) {
    const s = [];
    if (l.tipo === 'urgente') s.push('<span class="selo urgente">Urgente</span>');
    if (l.tipo === 'prioritaria') s.push('<span class="selo prioritaria">Prioritária</span>');
    if (l.sg) s.push('<span class="selo sigilo">Sigiloso</span>');
    if (l.concluido) s.push(`<span class="selo feito" tabindex="0" role="note" data-balao="${BALAO_CONCLUIDO}" aria-description="${BALAO_CONCLUIDO}">Concluído pelo servidor</span>`);
    return s.length ? `<div class="selos">${s.join('')}</div>` : '';
  }

  function linhaHTML(l, limite) {
    return `<tr${acima(l, limite) ? '' : ' class="par-abaixo"'}>
      <td class="nowrap"><button type="button" class="num" data-acao="copiar" data-n="${esc(l.n)}" data-balao="Copiar número" aria-description="Copiar número">${numeroHTML(l.n)}${letraMagHTML(l.mag)}</button>${selos(l)}</td>
      <td>${esc(l.c || '—')}</td><td>${esc(l.t || '—')}</td><td class="nowrap">${l.ch ? dataBR(l.ch) : '—'}</td>
      <td class="n par-dias">${l.dias == null ? '—' : nBR(l.dias)}</td><td>${esc(nomeDe(l.resp))}</td></tr>`;
  }

  function resumoTarefas(todos, limite) {
    const m = new Map();
    for (const l of todos) {
      const g = m.get(l.t) || m.set(l.t, { t: l.t, total: 0, parados: 0, maior: 0 }).get(l.t);
      g.total++;
      if (acima(l, limite)) { g.parados++; g.maior = Math.max(g.maior, l.dias); }
    }
    const gs = [...m.values()].filter(g => g.parados).sort((a, b) => b.parados - a.parados || b.maior - a.maior || String(a.t).localeCompare(String(b.t), 'pt-BR'));
    if (!gs.length) return '';
    const pct = g => Math.round((g.parados / g.total) * 100) + '%';
    return `<section class="painel largo"><h3>Onde se concentram</h3><div class="tabela-wrap"><table class="par-tabela"><thead><tr><th>Tarefa</th><th class="n">Total na tarefa</th><th class="n">Parados</th><th class="n">% parado</th><th class="n">Mais antigo (dias)</th></tr></thead><tbody>
      ${gs.map(g => `<tr><td>${esc(g.t || '—')}</td><td class="n">${nBR(g.total)}</td><td class="n">${nBR(g.parados)}</td><td class="n">${pct(g)}</td><td class="n">${nBR(g.maior)}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  }

  function tela() {
    const f = st.fParados;
    const base = R.linhasSecretaria({ filas: st.filas, tarefas: st.mapaTarefas, marcas: st.marcas, urgencias: st.urgencias, prazos: P.prazosRetorno() });
    const nenhumMag = magOffDe(f).length >= MAGISTRADOS.length;
    const todos = nenhumMag ? [] : base.filter(l => magPassa(f, l.mag));
    const parados = todos.filter(l => acima(l, f.limite));
    const lista = ordenar(f.todos ? todos : parados, f);
    const nProc = processos(todos), nPar = processos(parados);
    const maior = todos.reduce((m, l) => Math.max(m, l.dias || 0), 0);
    const ultimaLista = st.filas.reduce((m, r) => Math.max(m, ms(r.importado_em) || 0), 0);
    const faixa = faixaMagHTML(f, letra => processos(base.filter(l => l.mag === letra)), 'par-', 'rot-mag-parados');
    const th = ([c, r, cls]) => `<th${cls ? ` class="${cls}"` : ''} aria-sort="${f.ordem === c ? (f.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="prod-th" data-acao="par-ordem" data-campo="${c}">${r}${f.ordem === c ? (f.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    const corpo = nenhumMag ? '<div class="vazio"><p>Selecione ao menos um(a) magistrado(a).</p></div>'
      : !lista.length ? `<div class="vazio"><p>${f.todos ? 'Nenhum processo em tarefas de Secretaria.' : `Nenhum processo há mais de ${nBR(f.limite)} dias nas tarefas de Secretaria.`}</p></div>`
      : `${resumoTarefas(todos, f.limite)}<section class="painel largo"><h3>${f.todos ? 'Todos os processos em tarefas de Secretaria' : `Parados há mais de ${nBR(f.limite)} dias`}</h3><div class="tabela-wrap"><table class="par-tabela"><thead><tr>${COLUNAS.map(th).join('')}</tr></thead><tbody>${lista.map(l => linhaHTML(l, f.limite)).join('')}</tbody></table></div></section>`;
    return `<div class="contagens par-contagens">
        <div class="tile"><span>Processos em Secretaria</span><b>${nBR(nProc)}</b></div>
        <div class="tile"><span>Parados há mais de ${nBR(f.limite)} dias</span><b>${nBR(nPar)}</b></div>
        <div class="tile"><span>% parado</span><b>${nProc ? (nPar / nProc * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0,0'}%</b></div>
        <div class="tile"><span>Maior tempo (dias)</span><b>${nBR(maior)}</b></div>
      </div>
      <p class="atualizacao">Lista do PJe: ${ultimaLista ? dataHoraBR(ultimaLista) : 'ainda não enviada'} · Dias contados desde a chegada na tarefa · Clique no número para copiar.</p>
      ${faixa}
      <div class="filtros par-filtros">
        <label class="campo"><span>Parado há mais de</span><input type="number" id="par-limite" min="0" step="1" value="${f.limite}"><span>dias</span></label>
        <button type="button" class="btn" data-acao="par-todos" aria-pressed="${f.todos}">${f.todos ? 'Mostrar só os parados' : 'Mostrar todos'}</button>
        ${f.limite !== LIMITE_PADRAO ? `<button type="button" class="btn discreto" data-acao="par-limite-padrao">Voltar a ${LIMITE_PADRAO} dias</button>` : ''}
        <span class="direita"><span class="small muted mono">${nBR(lista.length)} ${lista.length === 1 ? 'linha' : 'linhas'}</span></span>
      </div>
      ${corpo}`;
  }

  // A atualização automática do painel só redesenha se algo mudou: não tira o foco de quem está digitando o limite.
  let ultimoHtml = '';
  P.renderParados = function () {
    const tl = $('#v-parados');
    if (!podeVer()) { tl.innerHTML = '<div class="vazio"><h2>Processos Parados</h2><p>Esta área é restrita ao gestor, ao diretor e ao(à) magistrado(a).</p></div>'; ultimoHtml = ''; return; }
    const h = tela();
    if (h === ultimoHtml && tl.innerHTML) return;
    ultimoHtml = h; tl.innerHTML = h;
  };

  const v = $('#v-parados');
  v.addEventListener('click', async e => {
    const a = e.target.closest('[data-acao]'); if (!a) return;
    const f = st.fParados, acao = a.dataset.acao;
    if (acao === 'copiar') {
      const n = a.dataset.n;
      try { await navigator.clipboard.writeText(n); toast('Número copiado: ' + n); }
      catch (err) { const r = document.createRange(); r.selectNodeContents(a); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Número selecionado. Use Ctrl+C para copiar.'); }
    } else if (acao === 'par-mag') {
      const l = a.dataset.v; alternarMag(f, l); render();
      const b = v.querySelector(`[data-acao="par-mag"][data-v="${l}"]`); if (b) b.focus();
    } else if (acao === 'par-mag-padrao') { f.magOff = magPadrao(f); render(); }
    else if (acao === 'par-todos') { f.todos = !f.todos; render(); const b = v.querySelector('[data-acao="par-todos"]'); if (b) b.focus(); }
    else if (acao === 'par-limite-padrao') { f.limite = LIMITE_PADRAO; render(); }
    else if (acao === 'par-ordem') {
      const c = a.dataset.campo;
      if (f.ordem === c) f.dir = -f.dir; else { f.ordem = c; f.dir = c === 'dias' ? -1 : 1; }
      render();
      const b = v.querySelector(`[data-acao="par-ordem"][data-campo="${c}"]`); if (b) b.focus();
    }
  });
  v.addEventListener('change', e => {
    if (e.target.id !== 'par-limite') return;
    const n = Math.floor(Number(e.target.value));
    st.fParados.limite = e.target.value !== '' && Number.isFinite(n) && n >= 0 ? n : LIMITE_PADRAO;
    render();
    const b = $('#par-limite'); if (b) b.focus();
  });
})();
