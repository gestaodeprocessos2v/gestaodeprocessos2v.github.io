/* Fila de Trabalho da Vara — envio da planilha dos requisitórios do PJE1 na aba Gestão.
   A planilha vem da extração do alvo pje1 (requisitórios expedidos fora do JD, nos processos 08 e 00 até 2018 de Pagamentos).
   A leitura do xlsx está em metas.js (lerXlsx) e o resumo em regras.js (resumirPJE1); o card de cada processo fica em app.js. */
(function () {
  'use strict';
  const P = window.PAINEL, M = window.Metas;
  if (!P || !P.render || !M) return;
  const { st, R, esc, toast, falha, iso, dataHoraBR } = P;
  const render = () => P.render();
  const imp = () => st.pje1Imp || (st.pje1Imp = { arquivo: '', resumo: null, erro: '', data: '', gravando: false });
  const n = x => x.toLocaleString('pt-BR');

  const pad = x => String(x).padStart(2, '0');
  const paraInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const dataMs = () => { const t = new Date(imp().data).getTime(); return isNaN(t) ? null : t; };

  async function lerPlanilha(arquivo) {
    const s = imp(); s.resumo = null; s.erro = ''; s.arquivo = '';
    if (arquivo) {
      try {
        const x = await M.lerXlsx(await arquivo.arrayBuffer());
        const r = R.resumirPJE1(x.linhas);
        if (!r.processos) throw new Error('Não encontrei processos na primeira aba da planilha do PJE1.');
        s.resumo = r; s.arquivo = arquivo.name;
        s.data = x.criadoEm ? paraInput(x.criadoEm) : '';
      } catch (e) { s.erro = e.message || 'Não consegui ler a planilha.'; }
    }
    render();
  }

  const lista = (itens, max) => itens.slice(0, max).map(esc).join(', ') + (itens.length > max ? ` e mais ${n(itens.length - max)}` : '');

  P.painelPJE1Gestao = function () {
    const s = imp(), r = s.resumo, em = dataMs();
    const pronto = r && em != null && !s.gravando;
    const atual = st.pje1 && st.pje1.em ? `<p class="small muted">Requisitórios do PJE1 no painel: ${esc(dataHoraBR(st.pje1.em))}.</p>` : '<p class="small muted">Ainda não há requisitórios do PJE1 no painel.</p>';
    const aviso = r && em != null && st.pje1 && st.pje1.em && em < st.pje1.em ? `<div class="aviso novo">Os dados do PJE1 que estão no painel são mais novos (${esc(dataHoraBR(st.pje1.em))}). Gravar este arquivo os substitui.</div>` : '';
    const sit = r ? Object.entries(r.porSit).sort((a, b) => b[1] - a[1]).map(([k, q]) => `${esc(k)}: <b class="mono">${n(q)}</b>`).join(' · ') : '';
    const avisos = !r ? '' : (r.naoConsultados.length ? `<div class="aviso novo">${n(r.naoConsultados.length)} ${r.naoConsultados.length === 1 ? 'processo não foi consultado' : 'processos não foram consultados'} (o portal não respondeu) e ${r.naoConsultados.length === 1 ? 'ficou' : 'ficaram'} como estava${r.naoConsultados.length === 1 ? '' : 'm'}: ${lista(r.naoConsultados, 10)}.</div>` : '')
      + (r.foraDoPadrao.length ? `<div class="aviso novo">${n(r.foraDoPadrao.length)} ${r.foraDoPadrao.length === 1 ? 'requisitório tem' : 'requisitórios têm'} número fora do padrão do PJE1 (17 dígitos); ${r.foraDoPadrao.length === 1 ? 'entrou' : 'entraram'} como PJE1. Confira: ${lista(r.foraDoPadrao, 10)}.</div>` : '');
    const previa = s.erro ? `<div class="aviso erro">${esc(s.erro)}</div>` : r ? `<div class="previa">
        <div><b>${n(r.processos)} processos</b> consultados e <b>${n(r.requisicoes)} requisitórios do PJE1</b> (${n(r.prc)} PRC) em “${esc(s.arquivo)}”.</div>
        <div class="small">Por situação: ${sit || 'nenhum requisitório'}</div>
        <div class="small">Consultados agora: ${n(r.novos)} · Reaproveitados (pagos, cancelados ou arquivados, sem nova consulta): ${n(r.reaproveitados)}</div>
      </div>` : '';
    return `<section class="painel">
      <h2>Enviar requisitórios do PJE1 (portal RPV/Precatório)</h2>
      <p>Envie a planilha (.xlsx) extraída do portal RPV/Precatório do TRF5, com os requisitórios expedidos fora do JD (no PJE1) nos processos de Pagamentos que começam com 08 e nos 00 de 2018 para trás. O card desses processos passa a mostrá-los ao lado dos do JD. Cada envio substitui o anterior.</p>
      ${atual}
      <label class="campo"><span>Planilha do PJE1 (.xlsx)</span><input type="file" id="pje1-arquivo" accept=".xlsx"></label>
      <label class="campo"><span>Data e hora da extração</span><input type="datetime-local" id="pje1-data" value="${esc(s.data)}"></label>
      ${previa}${avisos}${aviso}
      <div class="linha-botoes">
        <button class="btn primario" type="button" data-acao="pje1-gravar" ${pronto ? '' : 'disabled'}>${s.gravando ? 'Gravando…' : 'Gravar requisitórios do PJE1'}</button>
        ${r || s.erro ? '<button class="btn" type="button" data-acao="pje1-cancelar">Limpar</button>' : ''}
      </div>
    </section>`;
  };

  async function gravar() {
    const s = imp(), em = dataMs();
    if (!s.resumo || em == null || s.gravando) return;
    s.gravando = true; render();
    try {
      const { error } = await st.sb.from('pje1_requisicoes').upsert({ id: 1, itens: s.resumo.itens, importado_em: iso(em), atualizado_por: st.email }, { onConflict: 'id' });
      if (error) throw error;
      st.pje1Imp = null;
      toast('Requisitórios do PJE1 gravados.');
      await P.carregar();
    } catch (e) { falha(e); s.gravando = false; }
    render();
  }

  const vg = document.querySelector('#v-gestao');
  vg.addEventListener('change', e => {
    if (e.target.id === 'pje1-arquivo') lerPlanilha(e.target.files && e.target.files[0]);
    else if (e.target.id === 'pje1-data') { imp().data = e.target.value; render(); }
  });
  vg.addEventListener('input', e => { if (e.target.id === 'pje1-data') imp().data = e.target.value; });
  vg.addEventListener('click', async e => {
    const a = e.target.closest('[data-acao]'); if (!a || !a.dataset.acao.startsWith('pje1-')) return;
    try {
      if (a.dataset.acao === 'pje1-gravar') await gravar();
      else if (a.dataset.acao === 'pje1-cancelar') { st.pje1Imp = null; render(); }
    } catch (err) { falha(err); }
  });
})();
