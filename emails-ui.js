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
  const E = () => st.emails || (st.emails = { itens: [], lidos: new Set(), carregado: false, erro: false, busca: '', modal: null, corpos: {} });

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
      const [itens, lidos] = await Promise.all([
        todas((a, b) => st.sb.from('emails_resumo')
          .select('msg_id,publico,numero,categoria,cargo,tarefa,entrada_tarefa,urgente,perecimento,pedido,ato_provavel,remetente,assunto,recebido_em,web_link,anexo_juntar,solucionado,nao_localizado')
          .order('recebido_em', { ascending: false }).order('msg_id').range(a, b)),
        todas((a, b) => st.sb.from('emails_lidos').select('msg_id').eq('email', st.email).order('msg_id').range(a, b)),
      ]);
      s.itens = itens;
      s.lidos = new Set(lidos.map(r => r.msg_id));
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
    return { chave: msgs[0].msg_id, numero: rep.numero, msgs, rep, cargo, aba, entrada, urgente: msgs.some(m => m.urgente), anexo: msgs.some(m => m.anexo_juntar), ultimo: Date.parse(rep.recebido_em) };
  }
  const naoLida = m => !E().lidos.has(m.msg_id);
  const nNaoLidas = g => g.msgs.filter(naoLida).length;

  // Quantidade de e-mails não lidos por aba e no total (aparece no menu e nas abas).
  P.emailsNaoLidos = function (aba) {
    if (!podeVer() || !st.emails || !st.emails.carregado) return 0;
    let n = 0;
    for (const g of grupos()) if ((!aba || g.aba === aba) && P.abasEmails().includes(g.aba)) n += nNaoLidas(g);
    return n;
  };

  // ---------- tela ----------
  function filtrar(lista, aba) {
    const q = norm(E().busca).trim();
    return lista.filter(g => g.aba === aba && (!q || norm([g.numero, fmtCNJ(g.numero), g.rep.tarefa, ...g.msgs.map(m => `${m.remetente} ${m.pedido} ${m.assunto}`)].join(' ')).includes(q)))
      .sort((a, b) => (b.urgente - a.urgente) || ((a.entrada || Infinity) - (b.entrada || Infinity)) || (b.ultimo - a.ultimo));
  }

  const seloCargo = g => g.cargo ? `<span class="selo sigilo">${ROTULO_CARGO[g.cargo]}</span>` : `<span class="selo sigilo">Cargo não identificado</span>`;

  function cartao(g) {
    const r = g.rep, gestor = st.perfil === 'gestor';
    const novo = nNaoLidas(g) > 0;
    const num = g.numero ? fmtCNJ(g.numero) : 'Sem número de processo';
    const tarefa = r.tarefa ? `${esc(r.tarefa)}${r.entrada_tarefa ? ` <span class="sub">[desde ${esc(dataBR(Date.parse(r.entrada_tarefa)))}]</span>` : ''}` : 'não localizada no painel';
    const msgs = g.msgs.map(m => `<div class="em-msg">
        <div><b>${esc(dataHoraBR(Date.parse(m.recebido_em)))}</b> · ${esc(m.remetente || '—')}${naoLida(m) ? ' <span class="selo novo">Novo</span>' : ''}${m.anexo_juntar ? ' <span class="selo prioritaria">📎🟥 Anexo para juntar</span>' : ''}</div>
        ${m.pedido ? `<div>${esc(m.pedido)}</div>` : ''}
        <div class="linha-botoes"><button class="btn" type="button" data-eacao="ver" data-id="${esc(m.msg_id)}">Ver mensagem</button>${gestor && m.web_link ? `<a class="btn primario" href="${esc(m.web_link)}" target="_blank" rel="noopener noreferrer">Abrir no Outlook</a>` : ''}</div>
      </div>`).join('');
    const cargoSel = !g.cargo && g.numero && podeCargo()
      ? `<label class="campo em-cargo"><span>Definir cargo</span><select data-ecargo="${esc(g.numero)}"><option value="">Escolha…</option><option value="S">Juíza Substituta</option><option value="T">Juiz Titular</option></select></label>` : '';
    const tipo = r.categoria !== 'minuta' ? ` · ${esc(ROTULO_CAT[r.categoria] || '')}` : '';
    return `<article class="painel em-card${g.urgente ? ' t-urgente' : ''}">
      <h3><span class="mono em-num">${esc(num)}</span> ${seloCargo(g)}${g.urgente ? ' <span class="selo urgente">Urgente</span>' : ''}${novo ? ' <span class="selo novo">Novo</span>' : ''}<span class="sub">${tipo}</span></h3>
      <p><b>Tarefa atual:</b> ${tarefa}</p>
      ${r.ato_provavel ? `<p><b>Ato provável:</b> ${esc(r.ato_provavel)}</p>` : ''}
      ${r.perecimento ? `<p><b>Perecimento:</b> ${esc(r.perecimento)}</p>` : ''}
      ${cargoSel}
      ${msgs}
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
    v.innerHTML = `<div class="em-barra"><input type="search" id="em-busca" placeholder="Buscar por processo, remetente ou pedido" value="${esc(s.busca)}" aria-label="Buscar nos e-mails"></div>
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

  const v = $('#v-emails');
  v.addEventListener('click', e => {
    const a = e.target.closest('[data-eacao]'); if (!a) return;
    const acao = a.dataset.eacao;
    if (acao === 'ver') abrirMensagem(a.dataset.id);
    else if (acao === 'fechar' || (acao === 'fechar-fundo' && e.target === a)) { E().modal = null; render(); }
  });
  v.addEventListener('change', e => {
    if (e.target.dataset && e.target.dataset.ecargo) definirCargo(e.target.dataset.ecargo, e.target.value);
  });
  let buscaTimer = null;
  v.addEventListener('input', e => {
    if (e.target.id !== 'em-busca') return;
    clearTimeout(buscaTimer); buscaTimer = setTimeout(() => { E().busca = e.target.value; render(); }, 180);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.emails && st.emails.modal) { st.emails.modal = null; render(); } });
  // Se o login terminou antes deste arquivo carregar (conexão muito rápida), busca os e-mails agora.
  if (st.estado === 'ok' && podeVer() && !E().carregado) P.carregarEmails().then(render);
})();
