/* Fila de Trabalho da Vara — área "E-mails" (gestor, diretor e magistrado(a)).
   Os e-mails são gravados todo dia útil pela rotina das 7h30; aqui só se lê (e o gestor ou o diretor definem o cargo quando não identificado).
   Quem vê o quê é decidido pelo banco (RLS): gestor vê tudo; diretor, os e-mails da 2vara@; magistrado(a), só as minutas do próprio cargo. */
(function () {
  'use strict';
  const P = window.PAINEL;
  if (!P || !P.render) return;
  const { st, esc, toast, falha, dataBR, dataHoraBR, todas } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fmtCNJ = n => (n && n.length === 20 ? `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16)}` : '');
  const vazio = (titulo, p) => `<div class="vazio"><h2>${esc(titulo)}</h2><p>${p}</p></div>`;
  const podeVer = () => P.PERFIS_EMAILS.includes(st.perfil);
  const podeCargo = () => st.perfil === 'gestor' || st.perfil === 'diretor';

  const ROTULO_CARGO = { T: 'Juiz Titular', S: 'Juíza Substituta' };
  const ROTULO_CAT = { minuta: 'Minuta', cumprimento: 'Cumprimento pela secretaria', informacao: 'Informação ou orientação', juntada: 'Juntada', chamado: 'Chamado', outros: 'Outros' };
  const ABAS = [['emsub', 'Juíza Substituta'], ['emtit', 'Juiz Titular'], ['emnl', 'Não localizado'], ['emsec', 'Secretaria'], ['emdem', 'Demais'], ['emgest', 'Só gestor']];

  // ---------- estado ----------
  const E = () => st.emails || (st.emails = { itens: [], lidos: new Set(), carregado: false, erro: false, busca: '', modal: null, corpos: {},
    conclusoes: {}, notas: {}, concAtiva: false, concl: false, anotando: null, rascunho: '' });

  // Abas que a pessoa enxerga. Magistrado(a): só a aba do seu cargo (o banco só entrega as minutas dela).
  P.abasEmails = function () {
    if (st.perfil === 'gestor') return ABAS.map(a => a[0]);
    if (st.perfil === 'diretor') return ABAS.filter(a => a[0] !== 'emgest').map(a => a[0]);
    return [st.magistrado === 'T' ? 'emtit' : 'emsub'];
  };

  // ---------- carga ----------
  P.carregarEmails = async function () {
    if (!podeVer()) return;
    const s = E();
    try {
      const lerOpc = (tabela, campos) => todas((a, b) => st.sb.from(tabela).select(campos).order('chave').range(a, b))
        .then(r => ({ ok: true, r }), e => { console.error(tabela + ' indisponível', e); return { ok: false, r: [] }; });
      const [itens, lidos, conc, notas] = await Promise.all([
        todas((a, b) => st.sb.from('emails_resumo')
          .select('msg_id,publico,numero,categoria,cargo,tarefa,entrada_tarefa,urgente,perecimento,pedido,ato_provavel,remetente,assunto,recebido_em,web_link,anexo_juntar,solucionado,nao_localizado')
          .order('recebido_em', { ascending: false }).order('msg_id').range(a, b)),
        todas((a, b) => st.sb.from('emails_lidos').select('msg_id').eq('email', st.email).order('msg_id').range(a, b)),
        lerOpc('emails_conclusao', 'chave,concluido_por,em'),
        lerOpc('emails_notas', 'chave,texto,por,em'),
      ]);
      s.itens = itens;
      s.lidos = new Set(lidos.map(r => r.msg_id));
      s.conclusoes = Object.fromEntries(conc.r.map(x => [x.chave, { por: x.concluido_por, em: x.em }]));
      s.notas = Object.fromEntries(notas.r.map(x => [x.chave, { texto: x.texto, por: x.por, em: x.em }]));
      s.concAtiva = conc.ok && notas.ok;
      marcarConcluidos();
      s.erro = false;
    } catch (e) { console.error('E-mails indisponíveis', e); s.erro = true; }
    s.carregado = true;
  };

  // ---------- agrupamento e classificação ----------
  // Um item por processo (e por público); e-mails sem número ficam cada um no seu item.
  function grupos() {
    const s = E(), mapa = new Map();
    for (const m of s.itens) {
      const k = m.numero ? `${m.publico}|${m.numero}` : `${m.publico}|msg|${m.msg_id}`;
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(m);
    }
    const lista = [];
    for (const msgs of mapa.values()) {
      msgs.sort((a, b) => Date.parse(a.recebido_em) - Date.parse(b.recebido_em));
      lista.push(montar(msgs));
    }
    return lista;
  }
  function montar(msgs) {
    const rep = msgs[msgs.length - 1];   // o mais recente traz a tarefa e o cargo mais atuais
    const minuta = msgs.some(m => m.categoria === 'minuta');
    const nl = msgs.some(m => m.nao_localizado);
    const sec = msgs.some(m => m.categoria === 'cumprimento' && (m.urgente || m.perecimento));
    const cargo = rep.cargo || (msgs.find(m => m.cargo) || {}).cargo || null;
    let aba;
    if (rep.publico === 'GESTOR') aba = 'emgest';
    else if (minuta && cargo === 'S') aba = 'emsub';
    else if (minuta && cargo === 'T') aba = 'emtit';
    else if (minuta || nl) aba = 'emnl';
    else if (sec) aba = 'emsec';
    else aba = 'emdem';
    const entrada = rep.entrada_tarefa ? Date.parse(rep.entrada_tarefa) : null;
    const ck = P.R.chaveEmail(msgs[0]), conclusao = E().conclusoes[ck] || null;
    return { chave: msgs[0].msg_id, ck, conclusao, concluido: P.R.emailConcluido(msgs, conclusao), numero: rep.numero, msgs, rep, cargo, aba, entrada, urgente: msgs.some(m => m.urgente), anexo: msgs.some(m => m.anexo_juntar), ultimo: Date.parse(rep.recebido_em) };
  }
  // Marca em cada e-mail se o card dele está concluído (a automação de juntada lê esse campo para pular os já resolvidos).
  function marcarConcluidos() { for (const g of grupos()) for (const m of g.msgs) m.concluido = g.concluido; }
  const naoLida = m => !E().lidos.has(m.msg_id);
  const nNaoLidas = g => g.msgs.filter(naoLida).length;

  // Quantidade de e-mails não lidos por aba e no total (aparece no menu e nas abas).
  P.emailsNaoLidos = function (aba) {
    if (!podeVer() || !st.emails || !st.emails.carregado) return 0;
    let n = 0;
    for (const g of grupos()) if (!g.concluido && (!aba || g.aba === aba) && P.abasEmails().includes(g.aba)) n += nNaoLidas(g);
    return n;
  };

  // ---------- tela ----------
  function filtrar(lista, aba) {
    const q = norm(E().busca).trim();
    return lista.filter(g => g.aba === aba && (E().concl || !g.concluido) && (!q || norm([g.numero, fmtCNJ(g.numero), g.rep.tarefa, ...g.msgs.map(m => `${m.remetente} ${m.pedido} ${m.assunto}`)].join(' ')).includes(q)))
      .sort((a, b) => (b.urgente - a.urgente) || ((a.entrada || Infinity) - (b.entrada || Infinity)) || (b.ultimo - a.ultimo));
  }

  const seloCargo = g => g.cargo ? `<span class="selo sigilo">${ROTULO_CARGO[g.cargo]}</span>` : `<span class="selo sigilo">Cargo não identificado</span>`;

  const quando = ms => dataHoraBR(Date.parse(ms));

  function blocoNota(g) {
    const s = E(), n = s.notas[g.ck];
    if (s.anotando === g.ck) {
      return `<form class="anotar-form" data-eform="anotar" data-ck="${esc(g.ck)}">
        <textarea id="em-nota-texto" maxlength="2000" rows="3" aria-label="Anotação sobre o processo" placeholder="Ex.: juntado no processo; aguardando a decisão">${esc(s.rascunho)}</textarea>
        <div class="linha-botoes"><button class="btn primario" type="submit">Salvar</button>${n ? '<button class="btn perigo" type="button" data-eacao="apagar-nota">Apagar</button>' : ''}<button class="btn" type="button" data-eacao="cancelar-nota">Cancelar</button></div>
      </form>`;
    }
    if (n) return `<div class="em-anot"><button class="anot-texto" type="button" data-eacao="anotar" data-ck="${esc(g.ck)}" data-balao="Editar anotação" aria-description="Editar anotação">${esc(n.texto)}</button><span class="quando">${esc(quando(n.em))}${n.por ? ' · ' + esc(n.por) : ''}</span></div>`;
    return `<div><button class="btn discreto" type="button" data-eacao="anotar" data-ck="${esc(g.ck)}">+ Anotar</button></div>`;
  }

  function cartao(g) {
    const r = g.rep, gestor = st.perfil === 'gestor', s = E();
    const novo = nNaoLidas(g) > 0;
    const num = g.numero ? fmtCNJ(g.numero) : 'Sem número de processo';
    const numH = g.numero
      ? `<button class="num em-num" type="button" data-eacao="copiar" data-n="${esc(num)}" data-balao="Copiar número" aria-description="Copiar número">${esc(num)}</button>`
      : `<span class="mono em-num">${esc(num)}</span>`;
    const tarefa = r.tarefa ? `${esc(r.tarefa)}${r.entrada_tarefa ? ` <span class="sub">[desde ${esc(dataBR(Date.parse(r.entrada_tarefa)))}]</span>` : ''}` : 'não localizada no painel';
    const msgs = g.msgs.map(m => `<div class="em-msg">
        <div><b>${esc(dataHoraBR(Date.parse(m.recebido_em)))}</b> · ${esc(m.remetente || '—')}${naoLida(m) ? ' <span class="selo novo">Novo</span>' : ''}${m.anexo_juntar ? ' <span class="selo prioritaria">📎🟥 Anexo para juntar</span>' : ''}</div>
        ${m.pedido ? `<div>${esc(m.pedido)}</div>` : ''}
        <div class="linha-botoes"><button class="btn" type="button" data-eacao="ver" data-id="${esc(m.msg_id)}">Ver mensagem</button>${gestor && m.web_link ? `<a class="btn primario" href="${esc(m.web_link)}" target="_blank" rel="noopener noreferrer">Abrir no Outlook</a>` : ''}</div>
      </div>`).join('');
    const cargoSel = !g.cargo && g.numero && podeCargo()
      ? `<label class="campo em-cargo"><span>Definir cargo</span><select data-ecargo="${esc(g.numero)}"><option value="">Escolha…</option><option value="S">Juíza Substituta</option><option value="T">Juiz Titular</option></select></label>` : '';
    const tipo = r.categoria !== 'minuta' ? ` · ${esc(ROTULO_CAT[r.categoria] || '')}` : '';
    const conclInfo = g.concluido
      ? `<div class="nota"><b>Concluído${g.conclusao && g.conclusao.por ? ' por ' + esc(g.conclusao.por) : ''}</b>${g.conclusao ? ' em ' + esc(quando(g.conclusao.em)) : ' (marcado como solucionado pela rotina)'}</div>` : '';
    const acoes = !s.concAtiva ? '' : g.concluido
      ? (g.conclusao ? `<button class="btn" type="button" data-eacao="desfazer" data-ck="${esc(g.ck)}">Desfazer</button>` : '')
      : `<button class="btn feito" type="button" data-eacao="concluir" data-ck="${esc(g.ck)}">Marcar como concluído</button>`;
    return `<article class="painel em-card${g.urgente ? ' t-urgente' : ''}${g.concluido ? ' concluido' : ''}">
      <h3>${numH} ${seloCargo(g)}${g.urgente ? ' <span class="selo urgente">Urgente</span>' : ''}${novo ? ' <span class="selo novo">Novo</span>' : ''}<span class="sub">${tipo}</span></h3>
      <p><b>Tarefa atual:</b> ${tarefa}</p>
      ${r.ato_provavel ? `<p><b>Ato provável:</b> ${esc(r.ato_provavel)}</p>` : ''}
      ${r.perecimento ? `<p><b>Perecimento:</b> ${esc(r.perecimento)}</p>` : ''}
      ${cargoSel}
      ${msgs}
      ${conclInfo}
      ${s.concAtiva ? blocoNota(g) : ''}
      ${acoes ? `<div class="linha-botoes">${acoes}</div>` : ''}
    </article>`;
  }

  P.renderEmails = function () {
    const v = $('#v-emails'), s = E();
    if (!podeVer()) { v.innerHTML = vazio('E-mails', 'Esta área é restrita ao gestor, ao diretor e ao(à) magistrado(a).'); return; }
    if (!s.carregado) { v.innerHTML = vazio('E-mails', 'Carregando…'); return; }
    if (s.erro) { v.innerHTML = '<div class="aviso erro">Não foi possível carregar os e-mails agora. Tente de novo em instantes.</div>'; return; }
    const abas = P.abasEmails();
    if (!abas.includes(st.abaEmails)) st.abaEmails = abas[0];
    const todos = grupos(), lista = filtrar(todos, st.abaEmails);
    const foco = document.activeElement && document.activeElement.id, pos = foco === 'em-busca' ? document.activeElement.selectionStart : null;
    const ultima = s.itens.length ? Date.parse(s.itens[0].recebido_em) : null;
    const corpo = lista.length ? lista.map(cartao).join('')
      : vazio(s.itens.length ? 'Nada nesta aba' : 'Ainda não há e-mails', s.itens.length ? 'Nenhum e-mail corresponde a esta aba e à busca.' : 'A rotina das 7h30 grava aqui os e-mails de cada dia útil.');
    v.innerHTML = `<div class="em-barra"><input type="search" id="em-busca" placeholder="Buscar por processo, remetente ou pedido" value="${esc(s.busca)}" aria-label="Buscar nos e-mails">${s.concAtiva ? `<label class="small em-mostrar"><input type="checkbox" id="em-mostrar-concl"${s.concl ? ' checked' : ''}> Mostrar concluídos</label>` : ''}</div>
      ${ultima ? `<p class="atualizacao">Último e-mail gravado em ${esc(dataHoraBR(ultima))} · resumo diário gerado pela rotina das 7h30.</p>` : ''}
      <div class="em-lista">${corpo}</div>${renderModalEmail()}`;
    if (foco === 'em-busca') { const b = $('#em-busca'); if (b) { b.focus(); if (pos != null) b.setSelectionRange(pos, pos); } }
  };

  function renderModalEmail() {
    const s = E(), m = s.modal;
    if (!m) return '';
    const msg = s.itens.find(x => x.msg_id === m.id);
    if (!msg) return '';
    const c = s.corpos[m.id];
    const corpo = !c ? (m.erro ? '<p class="aviso erro">Não foi possível abrir a mensagem agora.</p>' : '<p>Carregando…</p>')
      : `<pre class="em-texto">${esc(c.corpo)}</pre>${c.anexos && c.anexos.length ? `<p class="sub"><b>Anexos:</b> ${c.anexos.map(a => esc(a)).join('; ')}</p>` : ''}`;
    return `<div class="modal-fundo" data-eacao="fechar-fundo"><div class="modal em-modal" role="dialog" aria-modal="true" aria-labelledby="em-modal-tit">
      <h2 id="em-modal-tit">${esc(msg.assunto || 'Mensagem')}</h2>
      <div class="corpo">
        <p class="sub">${esc(dataHoraBR(Date.parse(msg.recebido_em)))} · ${esc(msg.remetente || '—')}${msg.numero ? ` · <span class="mono">${esc(fmtCNJ(msg.numero))}</span>` : ''}</p>
        ${corpo}
        <div class="linha-botoes"><button class="btn primario" type="button" data-eacao="fechar">Fechar</button></div>
      </div></div></div>`;
  }

  // ---------- ações ----------
  async function abrirMensagem(id) {
    const s = E();
    s.modal = { id, erro: false }; render();
    if (!s.corpos[id]) {
      const { data, error } = await st.sb.from('emails_corpo').select('corpo,anexos').eq('msg_id', id).maybeSingle();
      if (error || !data) { console.error(error); if (s.modal && s.modal.id === id) s.modal.erro = true; render(); return; }
      s.corpos[id] = data;
    }
    render();
    if (!s.lidos.has(id)) {
      const { error } = await st.sb.from('emails_lidos').upsert({ email: st.email, msg_id: id }, { onConflict: 'email,msg_id', ignoreDuplicates: true });
      if (error) console.error(error); else { s.lidos.add(id); render(); }
    }
  }

  async function definirCargo(numero, magistrado) {
    if (!magistrado) return;
    const { error } = await st.sb.from('emails_cargo').upsert({ numero, magistrado, definido_por: st.nome || st.email, em: new Date().toISOString() }, { onConflict: 'numero' });
    if (error) { falha(error); render(); return; }
    // o banco já corrigiu o cargo dos e-mails desse processo; espelha na tela sem esperar a próxima carga
    for (const m of E().itens) if (m.numero === numero) { m.cargo = magistrado; m.nao_localizado = false; }
    toast(`Cargo definido: ${ROTULO_CARGO[magistrado]}. Vale também para os próximos e-mails desse processo.`);
    render();
  }

  async function copiar(el) {
    const n = el.dataset.n;
    try { await navigator.clipboard.writeText(n); toast('Número copiado: ' + n); }
    catch (e) { const rg = document.createRange(); rg.selectNodeContents(el); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(rg); toast('Número selecionado. Use Ctrl+C para copiar.'); }
  }

  // O banco carimba quem concluiu e a hora (gatilho); a resposta traz os valores reais para a tela.
  async function concluir(ck) {
    const { data, error } = await st.sb.from('emails_conclusao').upsert({ chave: ck }, { onConflict: 'chave' }).select('concluido_por,em').single();
    if (error) { falha(error); return; }
    E().conclusoes[ck] = { por: data.concluido_por, em: data.em };
    marcarConcluidos(); toast('Marcado como concluído.'); render();
  }
  async function desfazer(ck) {
    const { error } = await st.sb.from('emails_conclusao').delete().eq('chave', ck);
    if (error) { falha(error); return; }
    delete E().conclusoes[ck];
    marcarConcluidos(); toast('Conclusão desfeita.'); render();
  }
  function iniciarNota(ck) {
    const s = E(); s.anotando = ck; s.rascunho = (s.notas[ck] || {}).texto || ''; render();
    const t = $('#em-nota-texto'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  }
  async function salvarNota(ck, texto) {
    const s = E();
    if (texto) {
      const { data, error } = await st.sb.from('emails_notas').upsert({ chave: ck, texto }, { onConflict: 'chave' }).select('texto,por,em').single();
      if (error) { falha(error); return; }
      s.notas[ck] = { texto: data.texto, por: data.por, em: data.em };
    } else {
      const { error } = await st.sb.from('emails_notas').delete().eq('chave', ck);
      if (error) { falha(error); return; }
      delete s.notas[ck];
    }
    s.anotando = null; s.rascunho = ''; render();
  }

  const v = $('#v-emails');
  v.addEventListener('click', e => {
    const a = e.target.closest('[data-eacao]'); if (!a) return;
    const acao = a.dataset.eacao;
    if (acao === 'ver') abrirMensagem(a.dataset.id);
    else if (acao === 'copiar') copiar(a);
    else if (acao === 'concluir') concluir(a.dataset.ck);
    else if (acao === 'desfazer') desfazer(a.dataset.ck);
    else if (acao === 'anotar') iniciarNota(a.dataset.ck);
    else if (acao === 'apagar-nota') salvarNota(E().anotando, '');
    else if (acao === 'cancelar-nota') { E().anotando = null; E().rascunho = ''; render(); }
    else if (acao === 'fechar' || (acao === 'fechar-fundo' && e.target === a)) { E().modal = null; render(); }
  });
  v.addEventListener('submit', e => {
    const f = e.target.closest && e.target.closest('[data-eform="anotar"]'); if (!f) return;
    e.preventDefault(); salvarNota(f.dataset.ck, ($('#em-nota-texto').value || '').trim());
  });
  v.addEventListener('change', e => {
    if (e.target.id === 'em-mostrar-concl') { E().concl = e.target.checked; render(); return; }
    if (e.target.dataset && e.target.dataset.ecargo) definirCargo(e.target.dataset.ecargo, e.target.value);
  });
  let buscaTimer = null;
  v.addEventListener('input', e => {
    if (e.target.id === 'em-nota-texto') { E().rascunho = e.target.value; return; }
    if (e.target.id !== 'em-busca') return;
    clearTimeout(buscaTimer); buscaTimer = setTimeout(() => { E().busca = e.target.value; render(); }, 180);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.emails && st.emails.modal) { st.emails.modal = null; render(); } });
  // Se o login terminou antes deste arquivo carregar (conexão muito rápida), busca os e-mails agora.
  if (st.estado === 'ok' && podeVer() && !E().carregado) P.carregarEmails().then(render);
})();
