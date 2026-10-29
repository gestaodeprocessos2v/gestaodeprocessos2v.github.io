/* Fila de Trabalho da Vara — minutas para o Residente.
   O Gestor envia um .txt por processo (Gestão → "Minutas para o Residente"); o residente abre o texto na fila.
   O texto é guardado e mostrado como veio (quebras de linha, linhas em branco e recuos). O banco apaga a minuta
   90 dias depois da conclusão no painel (sql/minutas_residente.sql). Quem lê: Gestor e Residente (RLS). */
(function () {
  'use strict';
  const P = window.PAINEL;
  if (!P || !P.render) return;
  const { st, esc, toast, falha, dataBR, dataHoraBR, todas, iso, ms, pessoas, filaDe } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const PERFIS_MINUTAS = ['gestor', 'residente'];
  const LIMITE = 20000;   // caracteres, o mesmo do banco
  const DIA = 86400000;
  const fmtCNJ = n => (n && n.length === 20 ? `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16)}` : n);
  const digitos = s => String(s == null ? '' : s).replace(/\D/g, '');

  // lista: { número com 20 dígitos: { arquivo, enviadoEm, concluidaEm } } (sem o texto, buscado ao abrir).
  const M = () => st.minutas || (st.minutas = { lista: {}, textos: {}, imp: null, modal: null, gravando: false });

  P.carregarMinutas = async function () {
    const m = M();
    if (!PERFIS_MINUTAS.includes(st.perfil)) { m.lista = {}; return; }
    try {
      const linhas = await todas((a, b) => st.sb.from('minutas_residente').select('numero,arquivo,enviado_em,concluida_em').order('numero').range(a, b));
      m.lista = Object.fromEntries(linhas.map(r => [r.numero, { arquivo: r.arquivo, enviadoEm: ms(r.enviado_em), concluidaEm: ms(r.concluida_em) }]));
    } catch (e) { console.error(e); }
  };

  // Botão na linha da fila (só para quem pode ler e só se o processo tem minuta).
  P.botaoMinuta = function (l) {
    if (!PERFIS_MINUTAS.includes(st.perfil) || !M().lista[digitos(l.n)]) return '';
    return `<button class="btn" type="button" data-macao="abrir" data-n="${esc(digitos(l.n))}" data-balao="Ver a minuta feita por IA" aria-description="Ver a minuta feita por IA">Minuta</button>`;
  };

  // ---------- janela ----------
  function renderModal() {
    const el = $('#modal-minuta'); if (!el) return;
    const m = M(), s = m.modal;
    if (!s) { el.innerHTML = ''; return; }
    const t = m.textos[s.n];
    const corpo = t == null ? (s.erro ? '<p class="aviso erro">Não foi possível abrir a minuta agora.</p>' : '<p>Carregando…</p>') : `<pre class="em-texto">${esc(t)}</pre>`;
    el.innerHTML = `<div class="modal-fundo" data-macao="fechar-fundo"><div class="modal em-modal" role="dialog" aria-modal="true" aria-labelledby="min-modal-tit">
      <h2 id="min-modal-tit">Minuta · <span class="mono">${esc(fmtCNJ(s.n))}</span></h2>
      <div class="corpo">
        ${corpo}
        <div class="linha-botoes">
          <button class="btn primario" type="button" data-macao="copiar"${t == null ? ' disabled' : ''}>Copiar</button>
          <button class="btn" type="button" data-macao="baixar"${t == null ? ' disabled' : ''}>Baixar .txt</button>
          <button class="btn" type="button" data-macao="fechar">Fechar</button>
        </div>
      </div></div></div>`;
    const foco = el.querySelector('[data-macao="copiar"]:not([disabled])') || el.querySelector('[data-macao="fechar"]');
    if (foco && !el.contains(document.activeElement)) foco.focus();
  }

  async function abrir(n) {
    const m = M();
    m.modal = { n, erro: false }; renderModal();
    if (m.textos[n] == null) {
      const { data, error } = await st.sb.from('minutas_residente').select('texto').eq('numero', n).maybeSingle();
      if (error || !data) { console.error(error); if (m.modal && m.modal.n === n) m.modal.erro = true; renderModal(); return; }
      m.textos[n] = data.texto;
    }
    renderModal();
  }

  function baixarTxt(n) {
    const m = M(), info = m.lista[n] || {};
    const url = URL.createObjectURL(new Blob([m.textos[n]], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = info.arquivo || fmtCNJ(n) + '-minuta.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  document.addEventListener('click', async e => {
    const a = e.target.closest('[data-macao]'); if (!a) return;
    const acao = a.dataset.macao, m = M();
    try {
      if (acao === 'abrir') await abrir(a.dataset.n);
      else if (acao === 'fechar' || (acao === 'fechar-fundo' && e.target === a)) { m.modal = null; renderModal(); }
      else if (acao === 'copiar' && m.modal) { await navigator.clipboard.writeText(m.textos[m.modal.n]); toast('Minuta copiada.'); }
      else if (acao === 'baixar' && m.modal) baixarTxt(m.modal.n);
      else if (acao === 'escolher') { const i = $('#min-arquivos'); if (i) i.click(); }
      else if (acao === 'gravar') await gravar();
      else if (acao === 'cancelar') { m.imp = null; render(); }
      else if (acao === 'apagar') await apagar([a.dataset.n]);
      else if (acao === 'apagar-fora') await apagar(foraDaFila());
    } catch (err) { falha(err); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.minutas && st.minutas.modal) { st.minutas.modal = null; renderModal(); } });

  // ---------- Gestão ----------
  // Números na fila atual dos residentes (processos da lista, inclusive os que saíram mas continuam por anotação).
  function numerosDaFila() {
    const s = new Set();
    for (const p of pessoas().filter(x => x.tipo === 'residente')) for (const l of filaDe(p.id)) s.add(digitos(l.n));
    return s;
  }
  const foraDaFila = () => { const f = numerosDaFila(); return Object.keys(M().lista).filter(n => !f.has(n)); };

  async function lerArquivos(arquivos) {
    const m = M(), naFila = numerosDaFila();
    const itens = [];
    for (const f of arquivos) {
      const n = (digitos(f.name).match(/^\d{20}/) || [''])[0];
      let texto = '', erro = '';
      try { texto = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer()); }
      catch (e) { erro = 'não está em UTF-8'; }
      if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
      if (!erro && !n) erro = 'nome sem o número do processo';
      if (!erro && texto.length > LIMITE) erro = 'texto com mais de 20.000 caracteres';
      if (!erro && !texto.trim()) erro = 'arquivo vazio';
      itens.push({ arquivo: f.name, n, texto, erro, naFila: !!n && naFila.has(n), substitui: !!n && !!m.lista[n] });
    }
    m.imp = { itens };
    render();
  }

  async function gravar() {
    const m = M(), imp = m.imp; if (!imp || m.gravando) return;
    // Um arquivo por processo: se vier repetido, vale o último da lista.
    const porNum = new Map();
    for (const it of imp.itens) if (!it.erro) porNum.set(it.n, it);
    if (!porNum.size) return;
    m.gravando = true; render();
    try {
      const agora = iso(Date.now());
      const regs = [...porNum.values()].map(it => ({ numero: it.n, texto: it.texto, arquivo: it.arquivo, enviado_em: agora, enviado_por: st.email }));
      for (let i = 0; i < regs.length; i += 50) {
        const { error } = await st.sb.from('minutas_residente').upsert(regs.slice(i, i + 50), { onConflict: 'numero' });
        if (error) throw error;
      }
      for (const r of regs) delete m.textos[r.numero];
      m.imp = null;
      await P.carregarMinutas();
      toast(`${regs.length} ${regs.length === 1 ? 'minuta gravada' : 'minutas gravadas'}.`);
    } finally { m.gravando = false; render(); }
  }

  async function apagar(nums) {
    if (!nums.length) return;
    const { error } = await st.sb.from('minutas_residente').delete().in('numero', nums);
    if (error) throw error;
    for (const n of nums) delete M().textos[n];
    await P.carregarMinutas();
    toast(`${nums.length} ${nums.length === 1 ? 'minuta apagada' : 'minutas apagadas'}.`);
    render();
  }

  function previa(imp) {
    const ok = imp.itens.filter(i => !i.erro), naFila = ok.filter(i => i.naFila).length, foraFila = ok.length - naFila;
    const subst = ok.filter(i => i.substitui).length, erros = imp.itens.filter(i => i.erro);
    const linhas = imp.itens.map(i => `<tr><td>${esc(i.arquivo)}</td><td class="mono">${i.n ? esc(fmtCNJ(i.n)) : '—'}</td><td>${i.erro ? `<b>Não será gravado:</b> ${esc(i.erro)}` : i.naFila ? 'Na fila do residente' : '<b>Não está na fila do residente</b>'}${!i.erro && i.substitui ? ' · substitui a anterior' : ''}</td></tr>`).join('');
    return `<div class="previa">
      <div><b>${imp.itens.length} ${imp.itens.length === 1 ? 'arquivo lido' : 'arquivos lidos'}</b>: ${naFila} na fila do residente${foraFila ? `, ${foraFila} de processos fora da fila` : ''}${subst ? `, ${subst} ${subst === 1 ? 'substitui' : 'substituem'} minuta já gravada` : ''}.</div>
      ${erros.length ? `<div class="aviso erro"><b>${erros.length} ${erros.length === 1 ? 'arquivo não será gravado' : 'arquivos não serão gravados'}</b> (motivo na tabela).</div>` : ''}
      ${foraFila ? '<div class="small muted">Processos fora da fila também são gravados: a minuta aparece quando o processo entrar na fila do residente (ao enviar a lista do PJe com a etiqueta).</div>' : ''}
      <div class="tabela-wrap"><table><thead><tr><th>Arquivo</th><th>Processo</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table></div>
      <div class="linha-botoes">
        <button class="btn primario" data-macao="gravar" ${M().gravando || !ok.length ? 'disabled' : ''}>${M().gravando ? 'Gravando…' : 'Gravar'}</button>
        <button class="btn" data-macao="cancelar">Cancelar</button>
      </div>
    </div>`;
  }

  // Linha de uma minuta gravada (busca e últimos envios).
  function linhaGravada(n, i, fora) {
    return `<tr><td class="mono">${esc(fmtCNJ(n))}</td><td>${fora.has(n) ? '<span class="muted">Fora da fila</span>' : 'Na fila'}</td><td class="mono">${dataHoraBR(i.enviadoEm)}</td><td class="mono">${i.concluidaEm ? dataBR(i.concluidaEm) : '—'}</td><td class="mono">${i.concluidaEm ? dataBR(i.concluidaEm + 90 * DIA) : '—'}</td><td><button class="btn discreto" type="button" data-macao="apagar" data-n="${esc(n)}">Apagar</button></td></tr>`;
  }
  const tabelaGravadas = linhas => `<div class="tabela-wrap"><table><thead><tr><th>Processo</th><th>Situação</th><th>Enviada em</th><th>Concluída em</th><th>Apagada em</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>`;
  const ULTIMAS = 5;

  // Resultado da busca por número (a partir de 4 dígitos, em qualquer parte do número).
  function resultadoBusca(fora) {
    const m = M(), q = digitos(m.busca);
    if (!q) return '';
    if (q.length < 4) return '<p class="small muted">Digite pelo menos 4 dígitos do número.</p>';
    const achadas = Object.entries(m.lista).filter(([n]) => n.includes(q));
    if (!achadas.length) return '<p class="small muted">Nenhuma minuta gravada com esse número.</p>';
    return tabelaGravadas(achadas.slice(0, 20).map(([n, i]) => linhaGravada(n, i, fora)).join(''))
      + (achadas.length > 20 ? `<p class="small muted">Mostrando 20 de ${achadas.length}. Digite mais dígitos para achar a minuta.</p>` : '');
  }

  // Sem a lista completa (ficava longa demais): números, busca por processo e só os últimos envios.
  P.painelMinutasGestao = function () {
    const m = M();
    const lista = Object.entries(m.lista).sort((a, b) => (b[1].enviadoEm || 0) - (a[1].enviadoEm || 0));
    const fora = new Set(lista.length ? foraDaFila() : []);
    const concluidas = lista.filter(([, i]) => i.concluidaEm).length;
    const ultimas = lista.slice(0, ULTIMAS).map(([n, i]) => linhaGravada(n, i, fora)).join('');
    return `<section class="painel" id="min-painel">
      <h2>Minutas para o Residente</h2>
      <p>Envie os arquivos .txt das minutas (um por processo, com o número do processo no nome do arquivo). O residente abre o texto pelo botão “Minuta” na fila dele, com a formatação do arquivo. A minuta é apagada sozinha 90 dias depois da conclusão do processo no painel.</p>
      <div class="linha-botoes"><input type="file" id="min-arquivos" accept=".txt,text/plain" multiple hidden>
        <button class="btn" type="button" data-macao="escolher">Escolher arquivos .txt</button>
        <span class="small muted">ou arraste os arquivos para cá</span></div>
      ${m.imp ? previa(m.imp) : ''}
      <h3>Gravadas <span class="muted mono">${lista.length}</span></h3>
      ${lista.length ? `<div class="small">Na fila do residente: <b class="mono">${lista.length - fora.size}</b> · Fora da fila: <b class="mono">${fora.size}</b> · Concluídas (aguardando exclusão automática): <b class="mono">${concluidas}</b></div>
        <label class="campo"><span>Buscar minuta pelo número do processo</span><input type="search" id="min-busca" class="mono" inputmode="numeric" placeholder="Ex.: 0801234" value="${esc(m.busca || '')}" autocomplete="off"></label>
        <div id="min-busca-res">${resultadoBusca(fora)}</div>
        <h3>Últimos envios</h3>
        ${tabelaGravadas(ultimas)}
        ${fora.size ? `<div class="linha-botoes"><button class="btn" type="button" data-macao="apagar-fora">Apagar as ${fora.size} de processos fora da fila</button></div>` : ''}` : '<p class="small muted">Nenhuma minuta gravada.</p>'}
    </section>`;
  };

  const vg = $('#v-gestao');
  if (vg) {
    // A busca só redesenha o resultado (redesenhar a aba inteira a cada tecla tiraria o cursor do lugar).
    vg.addEventListener('input', e => {
      if (e.target.id !== 'min-busca') return;
      M().busca = e.target.value;
      const r = $('#min-busca-res'); if (r) r.innerHTML = resultadoBusca(new Set(foraDaFila()));
    });
    vg.addEventListener('change', e => { if (e.target.id === 'min-arquivos' && e.target.files.length) lerArquivos([...e.target.files]).catch(falha); });
    vg.addEventListener('dragover', e => { if (e.target.closest('#min-painel')) e.preventDefault(); });
    vg.addEventListener('drop', e => {
      if (!e.target.closest('#min-painel')) return;
      e.preventDefault();
      const fs = [...(e.dataTransfer.files || [])].filter(f => /\.txt$/i.test(f.name));
      if (fs.length) lerArquivos(fs).catch(falha); else toast('Arraste arquivos .txt.');
    });
  }

  if (st.estado === 'ok' && PERFIS_MINUTAS.includes(st.perfil)) P.carregarMinutas().then(render);
})();
