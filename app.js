/* Fila de Trabalho da Vara: página estática (GitHub Pages) + Supabase (login Google e banco com RLS).
   Parte 1: início, login, dados, fila e painel geral. A Gestão está em gestao.js. */
(function () {
  'use strict';
  const R = window.Regras;
  const CFG = window.PAINEL_CONFIG;
  const SETORES = [
    ['secretaria', 'Secretaria'], ['triagem', 'Triagem inicial'], ['comunicacao', 'Comunicação'],
    ['pagamentos', 'Pagamentos'], ['pericia', 'Perícia'], ['audiencia', 'Audiência'],
  ];
  const NOME_SETOR = Object.fromEntries(SETORES);
  // Tipos de pessoa com fila própria. Estagiários e residentes podem devolver; servidores podem enviar.
  const TIPOS = [['servidor', 'Servidores', 'Servidor'], ['estagiario', 'Estagiários', 'Estagiário'], ['residente', 'Residentes', 'Residente']];
  const ROTULO_TIPO = Object.fromEntries(TIPOS.map(t => [t[0], t[2]]));
  const PERFIS = {
    gestor: 'Gestor', servidor: 'Servidor', estagiario: 'Estagiário', residente: 'Residente',
    magistrado: 'Magistrado', diretor: 'Diretor de Secretaria', visitante: 'Visitante',
  };
  const COM_FILA = ['servidor', 'estagiario', 'residente'];
  const DIA = 86400000;
  const LIMITE_NORMAL = 300;

  const st = {
    sb: null, estado: 'carregando', erro: '',
    email: '', perfil: '', nome: '', pessoa: '',
    config: null, rascunho: null,
    tarefas: [], mapaTarefas: new Map(), tarefasEm: null, rascTarefas: null, tarefasAlteradas: false,
    filtroTabela: { busca: '', painel: '' },
    resumo: null,
    filas: [], urgencias: [], devolucoes: [], marcas: {}, notas: {}, acessos: [], negados: [],
    ver: 0, cache: { ver: -1, m: {} },
    aba: 'fila', verComo: '',
    vis: {
      fila: { busca: '', tarefa: '', concl: false, limite: LIMITE_NORMAL, pessoa: '' },
      geral: { busca: '', tarefa: '', concl: false, limite: LIMITE_NORMAL, pessoa: '' },
    },
    anotando: null, notaRascunho: '', devolvendo: null, devMotivo: '', modal: null,
    ultimaVisita: 0, importacao: null, gravando: false, confirmarRemocao: null,
    novaUrgencia: null, novaPessoa: '', rascOutros: null,
  };
  window.PAINEL = { st, R, SETORES, NOME_SETOR, TIPOS, ROTULO_TIPO, PERFIS, DIA };

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ms = v => (v ? Date.parse(v) : null);
  const iso = t => new Date(t).toISOString();
  const dataBR = t => t ? new Date(t).toLocaleDateString('pt-BR') : '—';
  const dataHoraBR = t => t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const dias = t => t ? Math.max(0, Math.floor((Date.now() - t) / DIA)) : null;
  function guardar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento local */ } }
  function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
  }

  const pessoas = () => (st.config && st.config.pessoas) || [];
  const nomes = () => Object.fromEntries(pessoas().map(p => [p.id, p.nome]));
  const nomeDe = id => nomes()[id] || id || '—';
  const tipoDe = id => (pessoas().find(p => p.id === id) || {}).tipo;
  const temFila = () => COM_FILA.includes(st.perfil);
  // "Ver como": o gestor abre, só para leitura, a fila de outra pessoa.
  const pessoaAtiva = () => st.verComo || st.pessoa;
  const tipoAtivo = () => st.verComo ? tipoDe(st.verComo) : st.perfil;
  const podeDevolver = () => tipoAtivo() === 'estagiario' || tipoAtivo() === 'residente';
  const podeEnviar = () => tipoAtivo() === 'servidor';
  const opcoesTipo = sel => TIPOS.map(([id, , rot]) => `<option value="${id}"${(sel || 'servidor') === id ? ' selected' : ''}>${rot}</option>`).join('');

  function opcoesPessoas(sel, vazio, excluir) {
    let h = vazio != null ? `<option value="">${esc(vazio)}</option>` : '';
    for (const [tipo, plural] of TIPOS) {
      const ps = pessoas().filter(p => (p.tipo || 'servidor') === tipo && p.id !== excluir);
      if (!ps.length) continue;
      h += `<optgroup label="${plural}">` + ps.map(p => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.nome)}</option>`).join('') + '</optgroup>';
    }
    return h;
  }

  function baixar(nome, texto) {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function falha(e) {
    console.error(e);
    const c = e && (e.code || e.status);
    if (c === '42501' || c === 403) toast('Você não tem permissão para essa ação.');
    else if (c === 'PGRST301' || c === 401 || /jwt/i.test((e && e.message) || '')) { toast('Sua sessão expirou. Entre de novo.'); sair(); }
    else if (c === '23505') toast('Esse registro já existe.');
    else toast('Não foi possível gravar agora. Tente de novo em instantes.');
  }

  // Lê todas as linhas de uma consulta, de mil em mil (limite da API).
  async function todas(fabrica) {
    const out = [], P = 1000;
    for (let i = 0; ; i += P) {
      const { data, error } = await fabrica(i, i + P - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < P) break;
    }
    return out;
  }

  // ---------- login ----------
  async function entrar() {
    const { error } = await st.sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } },
    });
    if (error) { toast('Não foi possível iniciar o login com o Google.'); console.error(error); }
  }

  async function sair() {
    try { await st.sb.auth.signOut(); } catch (e) { console.error(e); }
    reiniciarEstado();
    st.estado = 'login'; render();
  }

  function reiniciarEstado() {
    Object.assign(st, {
      email: '', perfil: '', nome: '', pessoa: '', config: null, rascunho: null, tarefas: [], mapaTarefas: new Map(), rascTarefas: null,
      tarefasAlteradas: false, resumo: null, filas: [], urgencias: [], devolucoes: [], marcas: {}, notas: {}, acessos: [], negados: [],
      anotando: null, devolvendo: null, modal: null, importacao: null,
    });
    st.ver++;
  }

  // Quem entrou com o Google mas não está cadastrado vê só o aviso; a tentativa fica registrada (e-mail e hora, 90 dias).
  async function registrarNegado(email) {
    const { error } = await st.sb.from('acessos_negados').insert({ email });
    if (error && error.code !== '23505') console.error(error);
  }

  async function aposLogin(session) {
    reiniciarEstado();
    st.email = String(session.user.email || '').toLowerCase();
    st.estado = 'carregando'; render();
    try {
      const { data, error } = await st.sb.from('acesso').select('nome,perfil,pessoa_id').eq('email', st.email).maybeSingle();
      if (error) throw error;
      if (!data) { st.estado = 'negado'; render(); registrarNegado(st.email); return; }
      st.nome = data.nome; st.perfil = data.perfil; st.pessoa = data.pessoa_id || '';
      const visto = Number(ler('fila.visita.' + st.email));
      st.ultimaVisita = visto || Date.now() - DIA;
      guardar('fila.visita.' + st.email, String(Date.now()));
      await carregar();
      const abas = abasDisponiveis();
      const salva = ler('fila.aba.' + st.email);
      st.aba = abas.includes(salva) ? salva : abas[0];
      st.estado = 'ok'; render();
    } catch (e) {
      console.error(e);
      st.estado = 'erro'; st.erro = 'Não foi possível carregar o painel agora.'; render();
    }
  }

  function abasDisponiveis() {
    if (temFila()) return ['fila', 'geral'];
    if (st.perfil === 'gestor') return st.verComo ? ['fila', 'geral', 'gestao'] : ['geral', 'gestao'];
    return ['geral'];
  }

  // ---------- dados ----------
  async function carregar() {
    const sb = st.sb;
    const desdeConcl = iso(Date.now() - 35 * DIA), desdeMarcas = iso(Date.now() - 95 * DIA);
    const gestor = st.perfil === 'gestor';
    const [cfg, filas, urg, dev, marcas, notas, acessos, negados] = await Promise.all([
      sb.from('config').select('chave,valor,atualizado_em'),
      todas((a, b) => sb.from('filas').select('lista,pessoa,itens,importado_em').order('lista').order('pessoa').range(a, b)),
      todas((a, b) => sb.from('urgencias').select('*').or(`concluida_em.is.null,concluida_em.gte.${desdeConcl}`).order('id').range(a, b)),
      todas((a, b) => sb.from('devolucoes').select('*').or(`concluida_em.is.null,concluida_em.gte.${desdeConcl}`).order('id').range(a, b)),
      todas((a, b) => sb.from('marcas').select('pessoa,chave,em,devolvido').gte('em', desdeMarcas).order('pessoa').order('chave').range(a, b)),
      todas((a, b) => sb.from('notas').select('pessoa,numero,texto,em').order('pessoa').order('numero').range(a, b)),
      gestor ? todas((a, b) => sb.from('acesso').select('email,nome,perfil,pessoa_id').order('email').range(a, b)) : Promise.resolve([]),
      gestor ? sb.from('acessos_negados').select('email,em').order('em', { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    ]);
    if (cfg.error) throw cfg.error;
    if (negados.error) throw negados.error;
    const porChave = Object.fromEntries((cfg.data || []).map(r => [r.chave, r]));
    st.config = porChave.geral ? porChave.geral.valor : null;
    if (!st.rascunho && st.config) st.rascunho = JSON.parse(JSON.stringify(st.config));
    st.tarefas = porChave.tarefas ? (porChave.tarefas.valor.itens || []) : [];
    st.tarefasEm = porChave.tarefas ? ms(porChave.tarefas.atualizado_em) : null;
    st.mapaTarefas = R.mapaTarefas(st.tarefas);
    if (!st.tarefasAlteradas) st.rascTarefas = JSON.parse(JSON.stringify(st.tarefas));
    st.resumo = porChave.resumo ? porChave.resumo.valor : null;
    st.filas = filas;
    st.urgencias = urg.map(r => ({
      id: r.id, numero: r.numero, responsavel: r.responsavel, via: r.origem, remetente: r.remetente, de: r.remetente, motivo: r.motivo || '',
      item: r.item || {}, criadaEm: ms(r.criada_em), criadaPor: r.criada_por, concluidaEm: ms(r.concluida_em), concluidaPor: r.concluida_por,
    }));
    st.devolucoes = dev.map(r => ({ id: r.id, item: r.item, de: r.de, para: r.para, motivo: r.motivo || '', em: ms(r.em), concluidaEm: ms(r.concluida_em) }));
    st.marcas = {};
    for (const m of marcas) (st.marcas[m.pessoa] = st.marcas[m.pessoa] || {})[m.chave] = { em: ms(m.em), dev: !!m.devolvido };
    st.notas = {};
    for (const n of notas) (st.notas[n.pessoa] = st.notas[n.pessoa] || {})[n.numero] = { texto: n.texto, em: ms(n.em) };
    st.acessos = acessos;
    st.negados = (negados.data || []).map(r => ({ email: r.email, em: ms(r.em) }));
    if (!st.rascOutros) st.rascOutros = null;
    st.ver++;
  }

  async function atualizar() {
    if (st.estado !== 'ok' || document.hidden || st.gravando || st.modal || st.anotando || st.devolvendo) return;
    try { await carregar(); render(); } catch (e) { console.error(e); }
  }

  // ---------- montagem da fila ----------
  function filaDe(p) {
    const c = st.cache;
    if (c.ver !== st.ver) { c.ver = st.ver; c.m = {}; }
    if (c.m[p]) return c.m[p];
    const itens = [];
    for (const r of st.filas) if (r.pessoa === p) for (const it of r.itens || []) itens.push(it);
    const umMes = Date.now() - 30 * DIA;
    const fila = R.montarFila({
      itens,
      urgencias: st.urgencias.filter(u => u.responsavel === p && (!u.concluidaEm || u.concluidaEm > umMes)),
      devolucoes: st.devolucoes.filter(d => d.para === p && (!d.concluidaEm || d.concluidaEm > umMes)),
      marcas: st.marcas[p] || {}, tarefas: st.mapaTarefas, ultimaVisita: st.ultimaVisita,
    });
    const notas = st.notas[p] || {};
    for (const l of fila) {
      const nota = notas[R.soDigitos(l.n)];
      if (nota && nota.texto) { l.anot = nota.texto; l.anotEm = nota.em; }
      l.dono = p;
    }
    c.m[p] = fila;
    return fila;
  }

  function linhasGeral(pessoa) {
    const ids = pessoa ? [pessoa] : pessoas().map(p => p.id);
    const out = [];
    for (const id of ids) for (const l of filaDe(id)) out.push(l);
    // Todos os servidores: ordem geral (grupo e antiguidade), independente do servidor.
    if (!pessoa) out.sort(R.comparar);
    return out;
  }

  // ---------- render ----------
  function render() {
    renderTopo();
    renderAvisos();
    const ok = st.estado === 'ok';
    $('#v-estado').hidden = ok;
    for (const a of ['fila', 'geral', 'gestao']) $('#v-' + a).hidden = !ok || st.aba !== a;
    if (!ok) {
      for (const a of ['fila', 'geral', 'gestao']) $('#v-' + a).innerHTML = '';
      renderEstado(); renderModal(); return;
    }
    $('#v-estado').innerHTML = '';
    for (const a of ['fila', 'geral', 'gestao']) if (a !== st.aba) $('#v-' + a).innerHTML = '';
    if (st.aba === 'fila') renderLista('fila');
    else if (st.aba === 'geral') renderLista('geral');
    else if (window.PAINEL.renderGestao) window.PAINEL.renderGestao();
    renderModal();
  }

  function renderTopo() {
    const ok = st.estado === 'ok';
    $('#sou').hidden = !ok;
    document.title = ok ? 'Fila de Trabalho · Gestão de Processos' : 'Acesso restrito';
    $('#marca-nome').hidden = !ok; // título e subtítulo só aparecem depois de validado o acesso
    const sel = $('#ver-como');
    const mostrarSel = ok && st.perfil === 'gestor' && pessoas().length > 0;
    sel.hidden = !mostrarSel;
    if (mostrarSel) {
      const h = opcoesPessoas(st.verComo, 'Ver a fila como…');
      if (sel.dataset.h !== h) { sel.innerHTML = h; sel.dataset.h = h; }
      sel.value = st.verComo;
    }
    if (ok) $('#quem').innerHTML = `${esc(st.nome)} <small>${esc(PERFIS[st.perfil] || st.perfil)}</small>`;
    const abas = ok ? abasDisponiveis() : [];
    const nav = $('#abas');
    nav.hidden = abas.length < 2;
    const rot = { fila: 'Fila', geral: 'Geral', gestao: 'Gestão' };
    const h = abas.map(a => `<button class="aba" role="tab" id="aba-${a}" aria-selected="${a === st.aba}" data-aba="${a}">${rot[a]}</button>`).join('');
    if (nav.dataset.h !== h) { nav.innerHTML = h; nav.dataset.h = h; }
    for (const b of nav.querySelectorAll('.aba')) b.setAttribute('aria-selected', String(b.dataset.aba === st.aba));
  }

  function renderAvisos() {
    $('#avisos').innerHTML = st.estado === 'ok' && st.verComo
      ? `<div class="aviso novo"><b>Visualização somente leitura.</b> Você está vendo a fila de ${esc(nomeDe(st.verComo))} como ela vê. Nada é gravado. <button class="btn" type="button" data-acao="sair-ver-como">Voltar à minha visão</button></div>`
      : '';
  }

  function renderEstado() {
    const v = $('#v-estado');
    if (st.estado === 'carregando') {
      v.innerHTML = `<div class="vazio"><h2>Carregando o painel…</h2><p>Buscando a configuração e as filas.</p></div>`;
    } else if (st.estado === 'login') {
      v.innerHTML = `<div class="vazio"><p>Use a conta Google cadastrada pelo gestor.</p><button class="btn primario" type="button" data-acao="entrar">Entrar com Google</button></div>`;
    } else if (st.estado === 'negado') {
      v.innerHTML = `<div class="vazio"><h2>Acesso não autorizado</h2><p>O e-mail <b>${esc(st.email)}</b> não está cadastrado para acesso a essa página. Se você acredita que deve ter acesso, entre em contato com o gestor.</p><button class="btn primario" type="button" data-acao="sair">Sair</button></div>`;
    } else {
      v.innerHTML = `<div class="aviso erro">${esc(st.erro || 'Algo deu errado.')}</div><div class="vazio"><button class="btn primario" type="button" data-acao="tentar">Tentar de novo</button> <button class="btn" type="button" data-acao="sair">Sair</button></div>`;
    }
  }

  function numeroHTML(n) {
    let c = 0, out = '';
    for (const ch of String(n || '')) {
      if (/\d/.test(ch) && ++c === 7) { out += `<span class="dig" title="7º algarismo: usado na distribuição">${ch}</span>`; continue; }
      out += esc(ch);
    }
    return out;
  }

  function linhaHTML(l, modo) {
    const geral = modo === 'geral';
    const selos = [];
    if (l.tipo === 'urgente') selos.push('<span class="selo urgente">Urgente</span>');
    if (l.tipo === 'devolvido') selos.push('<span class="selo devolvido">Devolvido</span>');
    if (l.tipo === 'prioritaria') selos.push('<span class="selo prioritaria">Prioritária</span>');
    if (l.novo && !l.concluido) selos.push('<span class="selo novo">Novo</span>');
    if (l.sg) selos.push('<span class="selo sigilo">Sigiloso</span>');
    if (l.fp) selos.push('<span class="selo paralelo" tabindex="0" title="O processo aparece em uma tarefa principal e em pelo menos um fluxo paralelo. Verificar a necessidade de encerrar o(s) fluxo(s) paralelo(s)">Fluxo paralelo</span>');
    if (l.devolvido) selos.push('<span class="selo devolvido">Devolvido ao servidor</span>');
    if (l.concluido) selos.push('<span class="selo feito">Concluído</span>');
    const d = dias(l.ch);
    let nota = '';
    if (l.origem === 'urgencia') {
      if (l.via === 'envio') nota = `<div class="nota"><b>Enviado por ${esc(nomeDe(l.de))}</b> em ${dataHoraBR(l.criadaEm)}${l.motivo ? ': ' + esc(l.motivo) : ''}</div>`;
      else if (l.via === 'gestor') nota = `<div class="nota"><b>Urgência</b> incluída em ${dataHoraBR(l.criadaEm)}${l.motivo ? ': ' + esc(l.motivo) : ''}</div>`;
      else if (l.motivo) nota = `<div class="nota"><b>Urgência</b>: ${esc(l.motivo)}</div>`;
    }
    if (l.origem === 'devolucao') nota = `<div class="nota"><b>Devolvido por ${esc(nomeDe(l.de))}</b> em ${dataHoraBR(l.criadaEm)}${l.motivo ? ': ' + esc(l.motivo) : ''}</div>`;
    const resp = geral ? `<div class="sub sub-resp">Responsável: ${esc(nomeDe(l.dono))}</div>` : '';
    let acoes = '', anot, form = '';
    const dis = st.verComo ? ' disabled title="Visualização somente leitura"' : '';
    if (geral) {
      anot = l.anot ? `<span class="anot-texto">${esc(l.anot)}</span><span class="quando">${dataHoraBR(l.anotEm)}</span>` : '<span class="muted">—</span>';
    } else {
      if (l.concluido) {
        acoes = `<button class="btn" data-acao="desfazer"${dis}>Desfazer</button>`;
      } else {
        acoes = `<button class="btn feito" data-acao="concluir"${dis}>Marcar como concluído</button>`;
        if (podeEnviar()) acoes += `<button class="btn" data-acao="enviar"${dis}>Enviar para outra pessoa</button>`;
        if (l.origem === 'lista' && podeDevolver()) acoes += `<button class="btn" data-acao="devolver"${dis}>Devolver</button>`;
      }
      if (st.anotando === l.chave) {
        anot = `<form class="anotar-form" data-form="anotar">
          <textarea id="nota-texto" maxlength="2000" rows="3" aria-label="Anotação sobre o processo" placeholder="Ex.: aguardando resposta do INSS ao ofício">${esc(st.notaRascunho)}</textarea>
          <div class="linha-botoes"><button class="btn primario" type="submit">Salvar</button>
          ${l.anot ? '<button class="btn perigo" type="button" data-acao="apagar-nota">Apagar</button>' : ''}
          <button class="btn" type="button" data-acao="cancelar-nota">Cancelar</button></div>
        </form>`;
      } else if (l.anot) {
        anot = `<button class="anot-texto" data-acao="anotar"${dis ? dis : ' title="Editar anotação"'}>${esc(l.anot)}</button><span class="quando">${dataHoraBR(l.anotEm)}</span>`;
      } else {
        anot = `<button class="btn discreto" data-acao="anotar"${dis}>+ Anotar</button>`;
      }
      if (st.devolvendo === l.chave) {
        const sugerido = l.resp || R.atribuir(l, l.s, st.config || {}).pessoa || '';
        form = `<form class="devolver-form" data-form="devolver">
          <label class="small" for="dev-motivo">Motivo</label>
          <input type="text" id="dev-motivo" placeholder="Ex.: precisa de despacho, não sei elaborar o ofício" maxlength="300" value="${esc(st.devMotivo || '')}">
          <label class="small" for="dev-para">Para</label>
          <select id="dev-para">${opcoesPessoas(sugerido, 'Escolha o servidor')}</select>
          <button class="btn primario" type="submit">Devolver ao servidor</button>
          <button class="btn" type="button" data-acao="cancelar-devolucao">Cancelar</button>
        </form>`;
      }
    }
    return `<li class="linha t-${l.tipo}${l.concluido ? ' concluido' : ''}" data-chave="${esc(l.chave)}" data-dono="${esc(l.dono || '')}">
      <div class="faixa"></div>
      <div class="c-num">
        <button class="num" data-acao="copiar" data-n="${esc(l.n)}" title="Copiar número">${numeroHTML(l.n)}</button>
        ${selos.length ? `<div class="selos">${selos.join('')}</div>` : ''}
        ${nota}${resp}
      </div>
      <div class="c-classe"><span class="rot-m">Classe</span>${esc(l.c || '—')}</div>
      <div class="c-tarefa"><span class="rot-m">Tarefa</span>${esc(l.t || '—')}</div>
      <div class="c-cargo"><span class="rot-m">Cargo judicial</span>${esc(l.cg || '—')}</div>
      <div class="c-chegada"><span class="rot-m">Chegada</span>${l.ch ? `${dataBR(l.ch)}<span class="sub"> · <span class="mono">${d}</span> ${d === 1 ? 'dia' : 'dias'}</span>` : '—'}</div>
      <div class="c-anot"><span class="rot-m">Anotação</span>${anot}</div>
      <div class="acoes">${acoes}</div>
      ${form}
    </li>`;
  }

  const CABECALHO_LINHAS = `<li class="linha cab" aria-hidden="true"><div></div><div>Número do processo</div><div>Classe</div><div>Tarefa</div><div>Cargo judicial</div><div>Data de chegada</div><div>Anotação</div><div>Ações</div></li>`;

  function renderLista(modo) {
    const v = $('#v-' + modo);
    const f = st.vis[modo];
    const geral = modo === 'geral';
    if (!st.config) {
      v.innerHTML = `<div class="vazio"><h2>O painel ainda não foi configurado</h2><p>${st.perfil === 'gestor' ? 'Abra a aba Gestão para cadastrar as pessoas e as regras de distribuição.' : 'Aguarde o gestor cadastrar as pessoas e as regras de distribuição.'}</p></div>`;
      return;
    }
    const todas = geral ? linhasGeral(f.pessoa) : filaDe(pessoaAtiva());
    const abertas = todas.filter(l => !l.concluido);
    const conta = t => abertas.filter(l => l.tipo === t).length;
    const novos = geral ? 0 : abertas.filter(l => l.novo).length;
    const tarefas = [...new Set(todas.map(l => l.t).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const busca = R.normTexto(f.busca);
    const buscaDig = R.soDigitos(f.busca);
    const visiveis = todas.filter(l => {
      if (l.concluido && !f.concl) return false;
      if (f.tarefa && l.t !== f.tarefa) return false;
      if (!busca) return true;
      if (buscaDig.length >= 4 && R.soDigitos(l.n).includes(buscaDig)) return true;
      return R.normTexto([l.n, l.c, l.t, l.cg, l.motivo, l.anot, geral ? nomeDe(l.dono) : ''].join(' ')).includes(busca);
    });
    const concluidos = todas.length - abertas.length;
    const ultimaLista = st.filas.filter(r => r.lista === 'semanal').reduce((m, r) => Math.max(m, ms(r.importado_em) || 0), 0);
    const ultimoDiario = st.filas.filter(r => r.lista === 'diaria').reduce((m, r) => Math.max(m, ms(r.importado_em) || 0), 0);

    let h = '';
    if (novos) h += `<div class="aviso novo"><b>${novos} ${novos === 1 ? 'processo novo' : 'processos novos'}</b> em urgências ou tarefas prioritárias desde a sua última visita (${dataHoraBR(st.ultimaVisita)}).</div>`;
    h += `<div class="contagens">
      <button type="button" class="tile urgente" data-acao="ir" data-tipo="urgente" title="Ir para esta lista"><span>Urgentes</span><b>${conta('urgente')}</b></button>
      <button type="button" class="tile devolvido" data-acao="ir" data-tipo="devolvido" title="Ir para esta lista"><span>Devolvidos</span><b>${conta('devolvido')}</b></button>
      <button type="button" class="tile prioritaria" data-acao="ir" data-tipo="prioritaria" title="Ir para esta lista"><span>Prioritárias</span><b>${conta('prioritaria')}</b></button>
      <button type="button" class="tile" data-acao="ir" data-tipo="normal" title="Ir para esta lista"><span>Na fila</span><b>${conta('normal')}</b></button>
      <div class="tile concluido"><span>Concluídos</span><b>${concluidos}</b></div>
    </div>
    <p class="atualizacao">Lista completa: ${ultimaLista ? dataHoraBR(ultimaLista) : 'ainda não enviada'} · Atualização diária: ${ultimoDiario ? dataHoraBR(ultimoDiario) : 'ainda não enviada'} · Clique no número para copiar.</p>
    <div class="filtros">
      <input type="search" id="busca" placeholder="Buscar por número, classe, tarefa, cargo ou anotação" value="${esc(f.busca)}" aria-label="Buscar">
      ${geral && st.perfil !== 'visitante' ? `<select id="filtro-pessoa" aria-label="Filtrar por servidor">${opcoesPessoas(f.pessoa, 'Todos os servidores')}</select>` : ''}
      <select id="filtro-tarefa" aria-label="Filtrar por tarefa"><option value="">Todas as tarefas</option>${tarefas.map(t => `<option${t === f.tarefa ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <label class="small"><input type="checkbox" id="mostrar-concluidos"${f.concl ? ' checked' : ''}> Mostrar concluídos</label>
      <div class="direita"><button class="btn" data-acao="baixar">Baixar CSV</button></div>
    </div>`;

    if (!todas.length) {
      h += `<div class="vazio"><h2>Nenhum processo ${geral ? 'no painel' : 'na sua fila'}</h2><p>A fila é preenchida quando o gestor envia o relatório do PJe+R. Urgências e devoluções aparecem aqui assim que forem incluídas.</p></div>`;
      v.innerHTML = h; return;
    }
    const grupos = [
      ['urgente', 'Urgências', geral ? 'Até o responsável marcar como concluído' : 'Até você marcar como concluído'],
      ['devolvido', 'Devolvidos por estagiários e residentes', 'Processos que não conseguiram tratar'],
      ['prioritaria', 'Tarefas prioritárias', 'Por antiguidade na tarefa'],
      ['normal', 'Fila por antiguidade', 'Do mais antigo para o mais recente na tarefa'],
    ];
    for (const [tipo, titulo, dica] of grupos) {
      let ls = visiveis.filter(l => l.tipo === tipo);
      if (!ls.length) continue;
      const total = ls.length;
      if (tipo === 'normal' && ls.length > f.limite) ls = ls.slice(0, f.limite);
      h += `<section class="grupo g-${tipo}" id="grupo-${modo}-${tipo}" tabindex="-1"><div class="grupo-cab"><span class="ponto"></span><h2>${titulo}</h2><span class="contagem">${total}</span><p>${dica}</p><button type="button" class="btn discreto topo-link" data-acao="topo">↑ Voltar ao topo</button></div><ol class="linhas">${CABECALHO_LINHAS}${ls.map(l => linhaHTML(l, modo)).join('')}</ol>`;
      if (ls.length < total) h += `<button class="btn mais" data-acao="mais">Mostrar mais ${Math.min(LIMITE_NORMAL, total - ls.length)} de ${total - ls.length} restantes</button>`;
      h += '</section>';
    }
    if (!visiveis.length) h += `<div class="vazio"><h2>Nenhum processo com esse filtro</h2><p>Limpe a busca ou escolha outra tarefa.</p></div>`;
    const foco = document.activeElement && document.activeElement.id;
    const pos = foco === 'busca' ? document.activeElement.selectionStart : null;
    v.innerHTML = h;
    if (foco === 'busca') { const b = $('#busca'); b.focus(); if (pos != null) b.setSelectionRange(pos, pos); }
    if (foco === 'dev-motivo' || foco === 'nota-texto') { const m = document.getElementById(foco); if (m) { m.focus(); m.setSelectionRange(m.value.length, m.value.length); } }
  }

  // ---------- gravações da fila ----------
  async function gravarMarca(pessoa, chave, dev, agora) {
    const { error } = await st.sb.from('marcas').upsert({ pessoa, chave, em: iso(agora), devolvido: !!dev }, { onConflict: 'pessoa,chave' });
    if (error) throw error;
    (st.marcas[pessoa] = st.marcas[pessoa] || {})[chave] = { em: agora, dev: !!dev };
    st.ver++;
  }

  async function apagarMarca(pessoa, chave) {
    const { error } = await st.sb.from('marcas').delete().eq('pessoa', pessoa).eq('chave', chave);
    if (error) throw error;
    if (st.marcas[pessoa]) delete st.marcas[pessoa][chave];
    st.ver++;
  }

  // Conclui na fila de quem está logado: marca da lista (número + chegada) ou fecha a urgência/devolução.
  async function concluirLinha(l) {
    const agora = Date.now(), p = st.pessoa;
    if (l.origem === 'lista') { await gravarMarca(p, l.chave, false, agora); return; }
    const urg = l.origem === 'urgencia';
    const campos = urg ? { concluida_em: iso(agora), concluida_por: p } : { concluida_em: iso(agora) };
    const { error } = await st.sb.from(urg ? 'urgencias' : 'devolucoes').update(campos).eq('id', l.id);
    if (error) throw error;
    const lista = urg ? st.urgencias : st.devolucoes;
    const r = lista.find(x => x.id === l.id); if (r) r.concluidaEm = agora;
    // evita que o mesmo processo volte como item comum da lista (mesmo número e mesma chegada)
    if (l.ch != null) await gravarMarca(p, R.chaveItem({ n: l.n, ch: l.ch }), false, agora);
    st.ver++;
  }

  // Desfaz a conclusão: apaga a marca da lista ou reabre a urgência/devolução.
  async function desfazerLinha(l) {
    const p = st.pessoa;
    if (l.origem !== 'lista') {
      const urg = l.origem === 'urgencia';
      const campos = urg ? { concluida_em: null, concluida_por: null } : { concluida_em: null };
      const { error } = await st.sb.from(urg ? 'urgencias' : 'devolucoes').update(campos).eq('id', l.id);
      if (error) throw error;
      const r = (urg ? st.urgencias : st.devolucoes).find(x => x.id === l.id); if (r) r.concluidaEm = null;
      if (l.ch != null) await apagarMarca(p, R.chaveItem({ n: l.n, ch: l.ch }));
    } else await apagarMarca(p, l.chave);
    st.ver++;
  }

  async function gravarNota(numero, texto, pessoa) {
    const chave = R.soDigitos(numero);
    if (texto) {
      const em = Date.now();
      const { error } = await st.sb.from('notas').upsert({ pessoa, numero: chave, texto, em: iso(em) }, { onConflict: 'pessoa,numero' });
      if (error) throw error;
      (st.notas[pessoa] = st.notas[pessoa] || {})[chave] = { texto, em };
    } else {
      const { error } = await st.sb.from('notas').delete().eq('pessoa', pessoa).eq('numero', chave);
      if (error) throw error;
      if (st.notas[pessoa]) delete st.notas[pessoa][chave];
    }
    st.ver++;
  }

  const itemDe = l => { const item = {}; for (const k of ['n', 'c', 't', 'cg', 'ch', 's', 'sg', 'u', 'resp']) if (l[k] != null) item[k] = l[k]; return item; };
  const acharLinha = chave => filaDe(pessoaAtiva()).find(l => l.chave === chave);

  async function enviarProcesso(l, para, motivo) {
    const agora = Date.now();
    const { error } = await st.sb.from('urgencias').insert({
      numero: R.soDigitos(l.n), responsavel: para, origem: 'envio', remetente: st.pessoa,
      motivo: motivo || null, item: itemDe(l), criada_por: st.email,
    });
    const jaTinha = !!error && error.code === '23505';   // reenvio: a urgência já está na fila dele, segue com o resto
    if (error && !jaTinha) throw error;
    try {
      await concluirLinha(l);
      const antiga = ((st.notas[st.pessoa] || {})[R.soDigitos(l.n)] || {}).texto || '';
      const nova = `Enviado para ${nomeDe(para)} em ${dataHoraBR(agora)}${motivo ? ' — ' + motivo : ''}`;
      let texto = antiga ? antiga + '\n' + nova : nova;
      if (texto.length > 2000) texto = texto.slice(-2000);
      await gravarNota(l.n, texto, st.pessoa);
    } catch (e) {
      console.error(e);
      toast('O processo foi enviado, mas não consegui concluir na sua fila. Marque como concluído.');
      return false;
    }
    toast(jaTinha ? `Esse processo já estava como urgência para ${nomeDe(para)}.` : 'Enviado para ' + nomeDe(para) + '.');
    return true;
  }

  async function devolverProcesso(l, para, motivo) {
    const agora = Date.now();
    const { error } = await st.sb.from('devolucoes').insert({ item: itemDe(l), de: st.pessoa, para, motivo: motivo || null });
    if (error) throw error;
    await gravarMarca(st.pessoa, l.chave, true, agora);
  }

  // ---------- janela de envio ----------
  function renderModal() {
    const m = $('#modal'), s = st.modal;
    if (!s) { m.innerHTML = ''; return; }
    const l = acharLinha(s.chave);
    if (!l) { st.modal = null; m.innerHTML = ''; return; }
    const antes = document.activeElement && document.activeElement.id;
    m.innerHTML = `<div class="modal-fundo" data-acao="fechar-modal-fundo"><form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-titulo" data-form="enviar">
      <h2 id="modal-titulo">Enviar para outra pessoa</h2>
      <div class="corpo">
        <p>O processo <b class="mono">${esc(l.n)}</b> sairá da sua fila, como concluído, e entrará como <b>urgência</b> na fila da pessoa escolhida. Na sua anotação ficará registrado para quem foi enviado, com a data e a hora do envio.</p>
        <label class="campo"><span>Enviar para</span><select id="env-para" required>${opcoesPessoas(s.para, 'Escolha a pessoa', st.pessoa)}</select></label>
        <label class="campo"><span>Motivo (opcional)</span><input type="text" id="env-motivo" maxlength="300" placeholder="Ex.: assunto da sua área, pedido do juiz" value="${esc(s.motivo)}"></label>
        <div class="linha-botoes"><button class="btn primario" type="submit" ${s.enviando ? 'disabled' : ''}>${s.enviando ? 'Enviando…' : 'Confirmar envio'}</button><button class="btn" type="button" data-acao="fechar-modal">Cancelar</button></div>
      </div></form></div>`;
    const alvo = antes && document.getElementById(antes);
    (alvo || $('#env-para')).focus();
  }

  function sairVerComo() {
    st.verComo = ''; st.anotando = null; st.devolvendo = null; st.modal = null;
    if (!abasDisponiveis().includes(st.aba)) st.aba = abasDisponiveis()[0];
    render();
  }

  // ---------- eventos ----------
  async function aoClicarFila(ev) {
    const alvo = ev.target.closest('[data-acao]');
    if (!alvo) return;
    const acao = alvo.dataset.acao;
    if (acao === 'sair-ver-como') { sairVerComo(); return; }
    if (acao === 'topo') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (acao === 'ir') {
      const sec = document.getElementById('grupo-' + st.aba + '-' + alvo.dataset.tipo);
      if (sec) { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); sec.focus({ preventScroll: true }); }
      else toast('Nenhum processo nessa lista.');
      return;
    }
    if (st.verComo && ['concluir', 'desfazer', 'devolver', 'enviar', 'anotar', 'apagar-nota'].includes(acao)) { toast('Visualização somente leitura.'); return; }
    const modo = st.aba;
    const f = st.vis[modo];
    const li = alvo.closest('.linha');
    const chave = li && li.dataset.chave;
    const linha = modo === 'fila' && chave ? acharLinha(chave) : null;
    try {
      if (acao === 'copiar') {
        const n = alvo.dataset.n;
        try { await navigator.clipboard.writeText(n); toast('Número copiado: ' + n); }
        catch (e) { const r = document.createRange(); r.selectNodeContents(alvo); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Número selecionado. Use Ctrl+C para copiar.'); }
      } else if (acao === 'concluir' && linha) {
        await concluirLinha(linha); toast('Marcado como concluído.'); render();
      } else if (acao === 'desfazer' && linha) {
        await desfazerLinha(linha); toast('Conclusão desfeita.'); render();
      } else if (acao === 'devolver' && linha) {
        st.devolvendo = linha.chave; st.devMotivo = ''; st.anotando = null; render();
        const m = $('#dev-motivo'); if (m) m.focus();
      } else if (acao === 'enviar' && linha) {
        st.modal = { chave: linha.chave, para: '', motivo: '', enviando: false }; st.anotando = null; st.devolvendo = null; render();
      } else if (acao === 'anotar' && linha) {
        st.anotando = linha.chave; st.notaRascunho = linha.anot || ''; st.devolvendo = null; render();
        const t = $('#nota-texto'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
      } else if (acao === 'cancelar-nota') {
        st.anotando = null; render();
      } else if (acao === 'apagar-nota' && linha) {
        await gravarNota(linha.n, '', st.pessoa); st.anotando = null; toast('Anotação apagada.'); render();
      } else if (acao === 'cancelar-devolucao') {
        st.devolvendo = null; render();
      } else if (acao === 'mais') {
        f.limite += LIMITE_NORMAL; render();
      } else if (acao === 'baixar') {
        const base = modo === 'geral' ? linhasGeral(f.pessoa) : filaDe(pessoaAtiva());
        const linhas = base.filter(l => f.concl || !l.concluido);
        const hoje = new Date().toISOString().slice(0, 10);
        baixar(`fila-${modo === 'geral' ? 'geral' : pessoaAtiva()}-${hoje}.csv`, R.paraCsv(linhas, nomes(), modo === 'geral'));
      }
    } catch (e) { falha(e); }
  }

  async function aoEnviarFormFila(ev) {
    ev.preventDefault();
    if (st.verComo) return;
    const tipo = ev.target.dataset.form;
    try {
      if (tipo === 'anotar') {
        const linha = acharLinha(st.anotando); if (!linha) return;
        await gravarNota(linha.n, $('#nota-texto').value.trim(), st.pessoa);
        st.anotando = null; st.notaRascunho = ''; toast('Anotação salva.'); render();
      } else if (tipo === 'devolver') {
        const linha = acharLinha(st.devolvendo); if (!linha) return;
        const para = $('#dev-para').value, motivo = $('#dev-motivo').value.trim();
        if (!para) { toast('Escolha o servidor que vai receber o processo.'); return; }
        await devolverProcesso(linha, para, motivo);
        st.devolvendo = null; toast('Devolvido para ' + nomeDe(para) + '.'); render();
        atualizar();
      }
    } catch (e) { falha(e); }
  }

  async function aoEnviarModal(ev) {
    ev.preventDefault();
    if (st.verComo) return;
    const s = st.modal; if (!s || s.enviando) return;
    const l = acharLinha(s.chave); if (!l) { st.modal = null; render(); return; }
    const para = $('#env-para').value, motivo = $('#env-motivo').value.trim();
    if (!para) { toast('Escolha a pessoa que vai receber o processo.'); return; }
    s.para = para; s.motivo = motivo; s.enviando = true; renderModal();
    try {
      await enviarProcesso(l, para, motivo);
      st.modal = null; render();
    } catch (e) { s.enviando = false; renderModal(); falha(e); }
  }

  function ligarEventos() {
    $('#btn-sair').addEventListener('click', sair);
    $('#avisos').addEventListener('click', e => { if (e.target.closest('[data-acao="sair-ver-como"]')) sairVerComo(); });
    $('#ver-como').addEventListener('change', e => {
      st.anotando = null; st.devolvendo = null; st.modal = null;
      if (e.target.value) { st.verComo = e.target.value; st.aba = 'fila'; render(); } else sairVerComo();
    });
    $('#abas').addEventListener('click', e => {
      const b = e.target.closest('.aba'); if (!b) return;
      st.aba = b.dataset.aba; guardar('fila.aba.' + st.email, st.aba);
      st.anotando = null; st.devolvendo = null; render();
    });
    $('#v-estado').addEventListener('click', e => {
      const a = e.target.closest('[data-acao]'); if (!a) return;
      if (a.dataset.acao === 'entrar') entrar();
      else if (a.dataset.acao === 'sair') sair();
      else if (a.dataset.acao === 'tentar') iniciarSessao();
    });
    for (const modo of ['fila', 'geral']) {
      const v = $('#v-' + modo);
      v.addEventListener('click', aoClicarFila);
      v.addEventListener('submit', aoEnviarFormFila);
      let t = null;
      v.addEventListener('input', e => {
        if (e.target.id === 'dev-motivo') st.devMotivo = e.target.value;
        if (e.target.id === 'nota-texto') st.notaRascunho = e.target.value;
        if (e.target.id === 'busca') { clearTimeout(t); t = setTimeout(() => { const f = st.vis[modo]; f.busca = e.target.value; f.limite = LIMITE_NORMAL; render(); }, 180); }
      });
      v.addEventListener('change', e => {
        const f = st.vis[modo];
        if (e.target.id === 'filtro-tarefa') { f.tarefa = e.target.value; render(); }
        if (e.target.id === 'filtro-pessoa') { f.pessoa = e.target.value; f.tarefa = ''; f.limite = LIMITE_NORMAL; render(); }
        if (e.target.id === 'mostrar-concluidos') { f.concl = e.target.checked; render(); }
      });
    }
    const modal = $('#modal');
    modal.addEventListener('submit', aoEnviarModal);
    modal.addEventListener('click', e => {
      const a = e.target.closest('[data-acao]'); if (!a) return;
      if (a.dataset.acao === 'fechar-modal' || (a.dataset.acao === 'fechar-modal-fundo' && e.target === a)) { st.modal = null; render(); }
    });
    modal.addEventListener('input', e => { if (st.modal) { if (e.target.id === 'env-motivo') st.modal.motivo = e.target.value; if (e.target.id === 'env-para') st.modal.para = e.target.value; } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.modal && !st.modal.enviando) { st.modal = null; render(); } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
    setInterval(atualizar, 60000);
  }

  // ---------- início ----------
  async function iniciarSessao() {
    st.estado = 'carregando'; render();
    try {
      const { data, error } = await st.sb.auth.getSession();
      if (error) throw error;
      if (location.search.includes('code=') || location.hash.includes('access_token')) history.replaceState(null, '', location.pathname);
      if (!data.session) { st.estado = 'login'; render(); return; }
      await aposLogin(data.session);
    } catch (e) {
      console.error(e); st.estado = 'erro'; st.erro = 'Não foi possível conectar. Verifique a internet e tente de novo.'; render();
    }
  }

  function iniciar() {
    $('#subtitulo').textContent = 'Gestão de Processos · 2ª Vara Federal · ' + new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    ligarEventos();
    if (!window.supabase || !CFG) { st.estado = 'erro'; st.erro = 'Não foi possível carregar os componentes da página.'; render(); return; }
    st.sb = window.supabase.createClient(CFG.url, CFG.chave, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
    st.sb.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT' && st.estado === 'ok') setTimeout(() => { reiniciarEstado(); st.estado = 'login'; render(); }, 0);
    });
    Object.assign(window.PAINEL, { render, toast, esc, ms, iso, dataBR, dataHoraBR, falha, todas, carregar, atualizar, baixar, pessoas, nomes, nomeDe, tipoDe, opcoesPessoas, opcoesTipo, filaDe, guardar, ler });
    iniciarSessao();
  }
  iniciar();
})();
