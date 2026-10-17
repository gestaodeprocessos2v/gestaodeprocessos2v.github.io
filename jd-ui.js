/* Fila de Trabalho da Vara — envio da planilha do Jurisdição Delegada (JD) na aba Gestão.
   A planilha vem da extração das RPV/PRC no JD (colunas: Nº do processo, Nº da requisição, Tipo, Valor, Situação).
   A leitura do xlsx está em metas.js (lerXlsx) e o resumo por processo em regras.js (resumirJD); o card de cada processo fica em app.js. */
(function () {
  'use strict';
  const P = window.PAINEL, M = window.Metas;
  if (!P || !P.render || !M) return;
  const { st, R, esc, toast, falha, iso, dataHoraBR } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const imp = () => st.jdImp || (st.jdImp = { arquivo: '', resumo: null, erro: '', data: '', gravando: false });
  const n = x => x.toLocaleString('pt-BR');

  const pad = x => String(x).padStart(2, '0');
  const paraInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const dataMs = () => { const t = new Date(imp().data).getTime(); return isNaN(t) ? null : t; };

  async function lerPlanilha(arquivo) {
    const s = imp(); s.resumo = null; s.erro = ''; s.arquivo = '';
    if (arquivo) {
      try {
        const x = await M.lerXlsx(await arquivo.arrayBuffer());
        const r = R.resumirJD(x.linhas);
        if (!r.processos) throw new Error('Não encontrei requisições na primeira aba. Ela deve ter as colunas Nº do processo, Nº da requisição, Tipo, Valor (R$) e Situação.');
        s.resumo = r; s.arquivo = arquivo.name;
        s.data = x.criadoEm ? paraInput(x.criadoEm) : '';
      } catch (e) { s.erro = e.message || 'Não consegui ler a planilha.'; }
    }
    render();
  }

  function porSituacao(itens) {
    const t = {};
    for (const it of Object.values(itens)) for (const [sit, q] of Object.entries(it.s)) t[sit] = (t[sit] || 0) + q;
    return t;
  }

  P.painelJDGestao = function () {
    const s = imp(), r = s.resumo, em = dataMs();
    const pronto = r && em != null && !s.gravando;
    const atual = st.jd && st.jd.em ? `<p class="small muted">Dados do JD no painel: ${esc(dataHoraBR(st.jd.em))}.</p>` : '<p class="small muted">Ainda não há dados do JD no painel.</p>';
    const aviso = r && em != null && st.jd && st.jd.em && em < st.jd.em ? `<div class="aviso novo">Os dados do JD que estão no painel são mais novos (${esc(dataHoraBR(st.jd.em))}). Gravar este arquivo os substitui.</div>` : '';
    const sit = r ? Object.entries(porSituacao(r.itens)).sort((a, b) => b[1] - a[1]).map(([k, q]) => `${esc(k)}: <b class="mono">${n(q)}</b>`).join(' · ') : '';
    const previa = s.erro ? `<div class="aviso erro">${esc(s.erro)}</div>` : r ? `<div class="previa">
        <div><b>${n(r.processos)} processos</b> e <b>${n(r.requisicoes)} requisições</b> (${n(r.prc)} PRC) em “${esc(s.arquivo)}”.</div>
        <div class="small">Por situação: ${sit}</div>
      </div>` : '';
    return `<section class="painel">
      <h2>Enviar situação das RPV/PRC (Jurisdição Delegada)</h2>
      <p>Envie a planilha (.xlsx) extraída do Jurisdição Delegada, com uma linha por requisição. Cada processo de tarefa de Pagamentos passa a mostrar, abaixo do número, o resumo das suas RPV/PRC. Cada envio substitui o anterior.</p>
      ${atual}
      <label class="campo"><span>Planilha do JD (.xlsx)</span><input type="file" id="jd-arquivo" accept=".xlsx"></label>
      <label class="campo"><span>Data e hora da extração no JD</span><input type="datetime-local" id="jd-data" value="${esc(s.data)}"></label>
      ${previa}${aviso}
      <div class="linha-botoes">
        <button class="btn primario" type="button" data-acao="jd-gravar" ${pronto ? '' : 'disabled'}>${s.gravando ? 'Gravando…' : 'Gravar situação do JD'}</button>
        ${r || s.erro ? '<button class="btn" type="button" data-acao="jd-cancelar">Limpar</button>' : ''}
      </div>
    </section>`;
  };

  async function gravar() {
    const s = imp(), em = dataMs();
    if (!s.resumo || em == null || s.gravando) return;
    s.gravando = true; render();
    try {
      const { error } = await st.sb.from('jd_requisicoes').upsert({ id: 1, itens: s.resumo.itens, importado_em: iso(em), atualizado_por: st.email }, { onConflict: 'id' });
      if (error) throw error;
      st.jdImp = null;
      toast('Situação do JD gravada.');
      await P.carregar();
    } catch (e) { falha(e); s.gravando = false; }
    render();
  }

  const vg = $('#v-gestao');
  vg.addEventListener('change', e => {
    if (e.target.id === 'jd-arquivo') lerPlanilha(e.target.files && e.target.files[0]);
    else if (e.target.id === 'jd-data') { imp().data = e.target.value; render(); }
  });
  vg.addEventListener('input', e => { if (e.target.id === 'jd-data') imp().data = e.target.value; });
  vg.addEventListener('click', async e => {
    const a = e.target.closest('[data-acao]'); if (!a || !a.dataset.acao.startsWith('jd-')) return;
    try {
      if (a.dataset.acao === 'jd-gravar') await gravar();
      else if (a.dataset.acao === 'jd-cancelar') { st.jdImp = null; render(); }
    } catch (err) { falha(err); }
  });
})();
