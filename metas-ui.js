/* Fila de Trabalho da Vara — Parte 3: área "Metas CNJ" (telas de consulta) e o envio das planilhas do Portal BI (aba Gestão).
   Os números vêm de duas planilhas baixadas à mão do Portal BI do TRF5; a leitura está em metas.js. */
(function () {
  'use strict';
  const P = window.PAINEL, M = window.Metas;
  if (!P || !P.render || !M) return;
  const { st, esc, toast, falha, iso, dataBR, dataHoraBR, baixar } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const LIMITE_PASSO = 300;

  const ultimo = () => st.metas.envios[0] || null;
  const metaPorId = id => M.METAS.find(m => m.id === id);
  const nomeCurto = id => (metaPorId(id) || { nome: id }).nome.replace(' — ', ' · ');
  const rotuloSit = { ok: 'Cumprida', atencao: 'Em andamento', baixo: 'Abaixo', sem: 'Sem dados' };

  // Valor que representa a meta: o da vara toda (1º Grau + JEF); sem ele, o da única instância que tem dados.
  function valorPrincipal(envio, m) {
    const r = envio.resumo || {};
    if (r.vara && r.vara[m.id] != null) return r.vara[m.id];
    for (const inst of M.INSTANCIAS) { const v = r.instancias && r.instancias[inst] ? r.instancias[inst][m.id] : null; if (v != null) return v; }
    return null;
  }
  const valorInst = (envio, inst, m) => { const i = envio.resumo && envio.resumo.instancias ? envio.resumo.instancias[inst] : null; return i ? i[m.id] : null; };

  function sparkline(serie) {
    if (serie.length < 2) return '';
    const w = 120, h = 30, max = Math.max(1.1, ...serie), min = Math.min(0, ...serie);
    const x = i => (i / (serie.length - 1)) * (w - 4) + 2, y = v => h - 2 - ((v - min) / (max - min)) * (h - 4);
    const pts = serie.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Evolução entre as cargas (de ${esc(M.pct(serie[0]))} para ${esc(M.pct(serie[serie.length - 1]))})"><line x1="0" x2="${w}" y1="${y(1).toFixed(1)}" y2="${y(1).toFixed(1)}" class="spark-meta"/><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function cartao(m, envios) {
    const e = envios[0], v = valorPrincipal(e, m), sit = M.situacao(v);
    const anterior = envios[1] ? valorPrincipal(envios[1], m) : null;
    const dif = v != null && anterior != null ? (v - anterior) * 100 : null;
    const difTxt = dif == null || Math.abs(dif) < 0.005 ? '' : `<span class="dif ${dif > 0 ? 'sobe' : 'desce'}" title="Em relação à carga anterior">${dif > 0 ? '▲' : '▼'} ${Math.abs(dif).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} p.p.</span>`;
    const serie = envios.slice().reverse().map(x => valorPrincipal(x, m)).filter(x => x != null);
    const porInst = M.INSTANCIAS.map(inst => ({ inst, v: valorInst(e, inst, m) })).filter(x => x.v != null);
    const pend = m.pend && e.arquivos && e.arquivos.pendentes && e.arquivos.pendentes.porMeta ? e.arquivos.pendentes.porMeta[m.id] : null;
    return `<article class="meta-card ${sit}" aria-label="${esc(m.nome)}">
      <header><h3>${esc(m.nome)}</h3><span class="selo-sit ${sit}">${rotuloSit[sit]}</span></header>
      <p class="muted small">${esc(m.titulo)}</p>
      <div class="valor-linha"><b class="valor mono">${esc(M.pct(v))}</b>${difTxt}</div>
      ${sparkline(serie)}
      <div class="meta-det small">
        ${porInst.length > 1 ? porInst.map(x => `<span>${esc(x.inst)}: <b class="mono">${esc(M.pct(x.v))}</b></span>`).join('') : ''}
        ${pend != null ? `<span>${pend === 0 ? 'Nenhum processo pendente' : `<b class="mono">${pend.toLocaleString('pt-BR')}</b> ${pend === 1 ? 'processo pendente' : 'processos pendentes'}`}</span>` : ''}
      </div>
    </article>`;
  }

  function telaVisao() {
    const envios = st.metas.envios, e = ultimo();
    if (st.metas.erro) return `<div class="vazio"><h2>Metas CNJ</h2><p>Não foi possível carregar os dados das metas agora. Tente de novo em instantes.</p></div>`;
    if (!e) return `<div class="vazio"><h2>Metas CNJ</h2><p>Os números das Metas Nacionais do Poder Judiciário de 2026 ainda não foram enviados. ${st.perfil === 'gestor' ? 'Envie os relatórios do Portal BI na aba Gestão do painel Fila de Trabalho.' : 'Aguarde o gestor enviar os dados.'}</p></div>`;
    const com = M.METAS.filter(m => valorPrincipal(e, m) != null);
    const sem = M.METAS.filter(m => valorPrincipal(e, m) == null);
    const cargas = envios.length;
    return `<div class="metas-topo">
        <p class="small muted">Dados da carga do Portal BI de <b>${esc(dataHoraBR(Date.parse(e.carga_bi)))}</b> · enviados ao painel em ${esc(dataHoraBR(Date.parse(e.enviado_em)))} · ${cargas} ${cargas === 1 ? 'carga guardada' : 'cargas guardadas'}.
        Percentual de cumprimento de cada meta (100% ou mais cumpre a meta), 2ª Vara Federal da Paraíba, 1º Grau e JEF.</p>
      </div>
      <div class="metas-grid">${com.map(m => cartao(m, envios)).join('')}</div>
      ${sem.length ? `<p class="small muted metas-sem"><b>Sem dados nesta carga:</b> ${sem.map(m => esc(m.nome)).join('; ')}. A vara não tem processos nessas metas, ou o Portal BI não trouxe valor.</p>` : ''}`;
  }

  // ---------- lista de pendentes ----------
  async function garantirPendentes() {
    const m = st.metas; if (m.carregando) return;
    const alvo = ultimo() ? ultimo().id : 0;
    if (m.pendEnvio === alvo && m.pend) return;
    m.carregando = true;
    try {
      const { data, error } = await st.sb.from('metas_pendentes').select('envio_id,atualizado_em,itens').eq('id', 1).maybeSingle();
      if (error) throw error;
      m.pend = data ? data.itens || [] : []; m.pendInfo = data ? { envio: data.envio_id, em: data.atualizado_em } : null; m.pendErro = false;
    } catch (e) { console.error(e); m.pend = []; m.pendInfo = null; m.pendErro = true; }
    m.pendEnvio = alvo; m.carregando = false;
    if (st.area === 'metas' && st.abaMetas === 'pendentes') render();
  }

  function pendentesFiltrados() {
    const f = st.fMetas, busca = f.busca.replace(/\D/g, ''), txt = f.busca.trim().toLowerCase();
    return (st.metas.pend || []).filter(it => (!f.meta || (it.m || []).includes(f.meta)) && (!f.inst || it.i === f.inst)
      && (!f.busca.trim() || (busca && it.n.replace(/\D/g, '').includes(busca)) || (it.c || '').toLowerCase().includes(txt)))
      .sort((a, b) => String(a.d || '9999').localeCompare(String(b.d || '9999')) || a.n.localeCompare(b.n));
  }

  function telaPendentes() {
    const e = ultimo();
    if (st.metas.erro) return `<div class="vazio"><h2>Pendentes por meta</h2><p>Não foi possível carregar os dados das metas agora.</p></div>`;
    if (!e) return `<div class="vazio"><h2>Pendentes por meta</h2><p>A lista de processos pendentes ainda não foi enviada.</p></div>`;
    garantirPendentes();
    if (st.metas.carregando || st.metas.pendEnvio !== e.id) return `<div class="vazio"><h2>Pendentes por meta</h2><p>Carregando a lista…</p></div>`;
    const f = st.fMetas, lista = pendentesFiltrados(), mostrar = lista.slice(0, f.limite);
    const info = st.metas.pendInfo;
    const doEnvio = info && info.envio ? st.metas.envios.find(x => x.id === info.envio) : null;
    const quando = doEnvio ? dataHoraBR(Date.parse(doEnvio.carga_bi)) : info ? dataHoraBR(Date.parse(info.em)) : '—';
    const opMetas = M.METAS.filter(m => m.pend).map(m => `<option value="${m.id}"${f.meta === m.id ? ' selected' : ''}>${esc(m.nome)}</option>`).join('');
    const opInst = M.INSTANCIAS.map(i => `<option value="${esc(i)}"${f.inst === i ? ' selected' : ''}>${esc(i)}</option>`).join('');
    const linhas = mostrar.map(it => `<tr><td class="mono">${esc(it.n)}</td><td>${esc(it.i)}</td><td>${esc((it.c || '').replace(/^\d+\s*-\s*/, ''))}</td><td class="mono">${it.d ? esc(dataBR(Date.parse(it.d + 'T12:00:00'))) : '—'}</td><td>${(it.m || []).map(id => `<span class="chip-meta">${esc(nomeCurto(id))}</span>`).join(' ')}</td></tr>`).join('');
    const aviso = !(st.metas.pend || []).length ? `<div class="vazio"><p>${st.metas.pendErro ? 'Não foi possível carregar a lista agora.' : 'Nenhum processo pendente na última carga.'}</p></div>` : '';
    const diverge = !doEnvio || doEnvio.id !== e.id;
    return `<p class="small muted">Processos da 2ª Vara que ainda faltam julgar em cada meta (carga do Portal BI de ${esc(quando)}), do mais antigo para o mais novo pela data da 1ª distribuição.</p>
      ${diverge && (st.metas.pend || []).length ? `<div class="aviso novo"><b>Atenção:</b> esta lista é de ${esc(quando)}, e não da carga mais recente dos percentuais (${esc(dataHoraBR(Date.parse(e.carga_bi)))}).${st.perfil === 'gestor' ? ' Envie os dois relatórios da mesma carga na aba Gestão.' : ''}</div>` : ''}
      <div class="filtros">
        <input type="search" id="metas-busca" placeholder="Buscar por número ou classe" aria-label="Buscar por número ou classe" value="${esc(f.busca)}">
        <select id="metas-filtro-meta" aria-label="Filtrar por meta"><option value="">Todas as metas</option>${opMetas}</select>
        <select id="metas-filtro-inst" aria-label="Filtrar por instância"><option value="">1º Grau e JEF</option>${opInst}</select>
        <span class="direita"><span class="small muted mono">${lista.length.toLocaleString('pt-BR')} ${lista.length === 1 ? 'processo' : 'processos'}</span><button class="btn" type="button" data-acao="metas-csv">Baixar CSV</button></span>
      </div>
      ${aviso || `<section class="painel largo"><div class="tabela-wrap"><table><thead><tr><th>Número do processo</th><th>Instância</th><th>Classe</th><th>1ª distribuição</th><th>Metas pendentes</th></tr></thead><tbody>${linhas || '<tr><td colspan="5">Nenhum processo com esse filtro.</td></tr>'}</tbody></table></div>
      ${lista.length > mostrar.length ? `<div class="linha-botoes"><button class="btn" type="button" data-acao="metas-mais">Mostrar mais ${Math.min(LIMITE_PASSO, lista.length - mostrar.length)}</button><span class="small muted">Mostrando ${mostrar.length} de ${lista.length}</span></div>` : ''}</section>`}`;
  }

  function csvPendentes() {
    const q = v => { const s = String(v == null ? '' : v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const cab = ['Número do Processo', 'Instância', 'Classe', '1ª Distribuição', 'Metas pendentes'];
    const lin = pendentesFiltrados().map(it => [it.n, it.i, it.c, it.d ? dataBR(Date.parse(it.d + 'T12:00:00')) : '', (it.m || []).map(nomeCurto).join(', ')].map(q).join(';'));
    return '﻿' + [cab.map(q).join(';'), ...lin].join('\r\n');
  }

  P.renderMetas = function () {
    const v = $('#v-metas');
    const foco = document.activeElement && document.activeElement.id;
    const pos = foco === 'metas-busca' ? document.activeElement.selectionStart : null;
    v.innerHTML = st.abaMetas === 'pendentes' ? telaPendentes() : telaVisao();
    if (foco === 'metas-busca') { const b = $('#metas-busca'); if (b) { b.focus(); if (pos != null) b.setSelectionRange(pos, pos); } }
  };

  const vm = $('#v-metas');
  let tBusca = null;
  vm.addEventListener('input', e => {
    if (e.target.id !== 'metas-busca') return;
    clearTimeout(tBusca); const val = e.target.value;
    tBusca = setTimeout(() => { st.fMetas.busca = val; st.fMetas.limite = LIMITE_PASSO; render(); }, 200);
  });
  vm.addEventListener('change', e => {
    if (e.target.id === 'metas-filtro-meta') { st.fMetas.meta = e.target.value; st.fMetas.limite = LIMITE_PASSO; render(); }
    else if (e.target.id === 'metas-filtro-inst') { st.fMetas.inst = e.target.value; st.fMetas.limite = LIMITE_PASSO; render(); }
  });
  vm.addEventListener('click', e => {
    const a = e.target.closest('[data-acao]'); if (!a) return;
    if (a.dataset.acao === 'metas-mais') { st.fMetas.limite += LIMITE_PASSO; render(); }
    else if (a.dataset.acao === 'metas-csv') baixar('pendentes-metas-' + new Date().toISOString().slice(0, 10) + '.csv', csvPendentes());
  });

  // ---------- aba Gestão: envio das planilhas ----------
  const imp = () => (st.metasImp = st.metasImp || { resumo: null, pendentes: null, erroResumo: '', erroPendentes: '', carga: '', gravando: false, remover: null });

  async function lerPlanilha(papel, arquivo) {
    const s = imp(), campo = papel === 'resumo' ? 'resumo' : 'pendentes', erro = papel === 'resumo' ? 'erroResumo' : 'erroPendentes';
    s[campo] = null; s[erro] = '';
    if (arquivo) {
      try {
        const x = await M.lerXlsx(await arquivo.arrayBuffer());
        s[campo] = Object.assign({ arquivo: arquivo.name, criadoEm: x.criadoEm }, papel === 'resumo' ? { dados: M.lerResumo(x.linhas) } : { dados: M.lerPendentes(x.linhas) });
      } catch (e) { s[erro] = e.message || 'Não consegui ler a planilha.'; }
    }
    render();
  }

  const cargaMs = () => { const c = imp().carga; const t = c ? new Date(c).getTime() : NaN; return isNaN(t) ? null : t; };
  function avisosEnvio() {
    const s = imp(), av = [];
    if (s.resumo && s.pendentes) av.push(...M.conferir({ criadoResumo: s.resumo.criadoEm, criadoPendentes: s.pendentes.criadoEm, cargaBi: cargaMs() }));
    const c = cargaMs();
    if (c != null) {
      const mais = st.metas.envios.find(x => Date.parse(x.carga_bi) > c);
      if (mais) av.push(`Já existe um envio de uma carga mais nova (${dataHoraBR(Date.parse(mais.carga_bi))}). Este envio entra no histórico, mas a lista de pendentes passa a ser a deste arquivo.`);
    }
    return av;
  }
  const jaEnviada = () => { const c = cargaMs(); return c != null && st.metas.envios.some(x => Math.abs(Date.parse(x.carga_bi) - c) < 60000); };

  function tabelaPrevia(r) {
    const linhas = M.METAS.filter(m => r.dados.metasLidas.includes(m.id)).map(m => {
      const vara = r.dados.vara ? r.dados.vara[m.id] : null, g = r.dados.instancias['1º Grau'] ? r.dados.instancias['1º Grau'][m.id] : null, j = r.dados.instancias.JEF ? r.dados.instancias.JEF[m.id] : null;
      return `<tr><td>${esc(m.nome)}</td><td class="n">${esc(M.pct(vara))}</td><td class="n">${esc(M.pct(g))}</td><td class="n">${esc(M.pct(j))}</td></tr>`;
    }).join('');
    return `<div class="tabela-wrap"><table><thead><tr><th>Meta</th><th>2ª Vara</th><th>1º Grau</th><th>JEF</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
  }

  P.painelMetasGestao = function () {
    const s = imp(), r = s.resumo, p = s.pendentes;
    const avisos = avisosEnvio();
    const pronto = r && p && cargaMs() != null && !jaEnviada() && !s.gravando;
    const prevRes = s.erroResumo ? `<div class="aviso erro">${esc(s.erroResumo)}</div>` : r ? `<div class="previa"><div class="small"><b>Resumo:</b> “${esc(r.arquivo)}”, 2ª Vara${r.criadoEm ? `, gerado em ${esc(dataHoraBR(r.criadoEm))}` : ''}.</div>${tabelaPrevia(r)}</div>` : '';
    const prevPend = s.erroPendentes ? `<div class="aviso erro">${esc(s.erroPendentes)}</div>` : p ? `<div class="previa"><div class="small"><b>Pendentes por Meta:</b> “${esc(p.arquivo)}”${p.criadoEm ? `, gerado em ${esc(dataHoraBR(p.criadoEm))}` : ''}.</div>
        <div class="small"><b class="mono">${p.dados.total.toLocaleString('pt-BR')}</b> processos pendentes (${Object.entries(p.dados.porInstancia).map(([i, n]) => `${esc(i)}: <b class="mono">${n.toLocaleString('pt-BR')}</b>`).join(' · ')}). Por meta: ${Object.entries(p.dados.porMeta).filter(([, n]) => n > 0).map(([id, n]) => `${esc(nomeCurto(id))}: <b class="mono">${n.toLocaleString('pt-BR')}</b>`).join(' · ') || 'nenhuma'}.</div></div>` : '';
    const historico = st.metas.envios.slice(0, 8).map(x => `<tr><td>${esc(dataHoraBR(Date.parse(x.carga_bi)))}</td><td>${esc(dataHoraBR(Date.parse(x.enviado_em)))}</td><td class="n">${x.n_pendentes.toLocaleString('pt-BR')}</td><td>${s.remover === x.id
      ? `<button class="btn perigo" type="button" data-acao="metas-remover" data-id="${x.id}">Confirmar remoção</button> <button class="btn discreto" type="button" data-acao="metas-cancelar-remocao">Cancelar</button>`
      : `<button class="btn discreto" type="button" data-acao="metas-pedir-remocao" data-id="${x.id}">Remover</button>`}</td></tr>`).join('');
    return `<section class="painel">
      <h2>Enviar relatórios das Metas CNJ</h2>
      <p>No Portal BI do TRF5 (painel “Metas (a partir de 2025)”), filtre pela serventia <b>PB - 2ª Vara Federal</b> e baixe em Excel, na mesma hora, os relatórios <b>Resumo</b> e <b>Pendentes por Meta</b>. Anote a “Última Carga” que aparece no canto superior direito do Portal BI. Os dois arquivos precisam ser da mesma carga.</p>
      <label class="campo"><span>Relatório “Resumo” (.xlsx)</span><input type="file" id="metas-arq-resumo" accept=".xlsx"></label>
      <label class="campo"><span>Relatório “Pendentes por Meta” (.xlsx)</span><input type="file" id="metas-arq-pend" accept=".xlsx"></label>
      <label class="campo"><span>Última Carga do Portal BI (data e hora)</span><input type="datetime-local" id="metas-carga" value="${esc(s.carga)}"></label>
      ${prevRes}${prevPend}
      ${jaEnviada() ? '<div class="aviso erro">Essa carga já foi enviada. Se for um reenvio, remova antes o envio anterior da lista abaixo.</div>' : ''}
      ${avisos.map(a => `<div class="aviso novo">${esc(a)}</div>`).join('')}
      <div class="linha-botoes">
        <button class="btn primario" type="button" data-acao="metas-gravar" ${pronto ? '' : 'disabled'}>${s.gravando ? 'Gravando…' : 'Gravar metas'}</button>
        ${r || p || s.carga ? '<button class="btn" type="button" data-acao="metas-cancelar">Limpar</button>' : ''}
      </div>
      ${historico ? `<h3>Últimos envios</h3><div class="tabela-wrap"><table><thead><tr><th>Carga do Portal BI</th><th>Enviado em</th><th>Pendentes</th><th></th></tr></thead><tbody>${historico}</tbody></table></div>` : ''}
    </section>`;
  };

  async function gravarMetas() {
    const s = imp();
    if (!s.resumo || !s.pendentes || cargaMs() == null || s.gravando || jaEnviada()) return;
    s.gravando = true; render();
    const sb = st.sb;
    let id = null;
    try {
      const pd = s.pendentes.dados;
      const envio = {
        enviado_por: st.email, carga_bi: iso(cargaMs()), n_pendentes: pd.total,
        resumo: { vara: s.resumo.dados.vara, instancias: s.resumo.dados.instancias, metasLidas: s.resumo.dados.metasLidas },
        arquivos: {
          resumo: { nome: s.resumo.arquivo, criadoEm: s.resumo.criadoEm },
          pendentes: { nome: s.pendentes.arquivo, criadoEm: s.pendentes.criadoEm, total: pd.total, porMeta: pd.porMeta, porInstancia: pd.porInstancia },
        },
      };
      const ins = await sb.from('metas_envios').insert(envio).select('id').single();
      if (ins.error) throw ins.error;
      id = ins.data.id;
      const { error } = await sb.from('metas_pendentes').upsert({ id: 1, envio_id: id, atualizado_em: iso(Date.now()), itens: pd.itens }, { onConflict: 'id' });
      if (error) throw error;
      toast('Metas CNJ gravadas.');
      st.metasImp = null; st.metas.pend = null; st.metas.pendEnvio = null;
      await P.carregar();
    } catch (e) {
      if (id != null) { try { await sb.from('metas_envios').delete().eq('id', id); } catch (e2) { console.error(e2); } }
      falha(e); s.gravando = false;
    }
    render();
  }

  async function removerEnvio(id) {
    const { error } = await st.sb.from('metas_envios').delete().eq('id', id);
    if (error) throw error;
    imp().remover = null; st.metas.pend = null; st.metas.pendEnvio = null;
    toast('Envio removido.'); await P.carregar(); render();
  }

  const vg = $('#v-gestao');
  vg.addEventListener('change', e => {
    if (e.target.id === 'metas-arq-resumo') lerPlanilha('resumo', e.target.files && e.target.files[0]);
    else if (e.target.id === 'metas-arq-pend') lerPlanilha('pendentes', e.target.files && e.target.files[0]);
    else if (e.target.id === 'metas-carga') { imp().carga = e.target.value; render(); }
  });
  vg.addEventListener('input', e => { if (e.target.id === 'metas-carga') imp().carga = e.target.value; });
  vg.addEventListener('click', async e => {
    const a = e.target.closest('[data-acao]'); if (!a || !a.dataset.acao.startsWith('metas-')) return;
    try {
      if (a.dataset.acao === 'metas-gravar') await gravarMetas();
      else if (a.dataset.acao === 'metas-cancelar') { st.metasImp = null; render(); }
      else if (a.dataset.acao === 'metas-pedir-remocao') { imp().remover = Number(a.dataset.id); render(); }
      else if (a.dataset.acao === 'metas-cancelar-remocao') { imp().remover = null; render(); }
      else if (a.dataset.acao === 'metas-remover') await removerEnvio(Number(a.dataset.id));
    } catch (err) { falha(err); }
  });
})();
