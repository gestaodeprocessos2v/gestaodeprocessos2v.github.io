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
  const TIPOS = [['servidor', 'Servidores', 'Servidor'], ['estagiario', 'Estagiários', 'Estagiário'], ['residente', 'Residentes', 'Residente'], ['diretor', 'Diretor de Secretaria', 'Diretor de Secretaria']];
  const GESTOR_ID = R.GESTOR_ID;
  const ROTULO_TIPO = Object.fromEntries(TIPOS.map(t => [t[0], t[2]]));
  const PERFIS = {
    gestor: 'Gestor', servidor: 'Servidor', estagiario: 'Estagiário', residente: 'Residente',
    magistrado: 'Magistrado(a)', diretor: 'Diretor de Secretaria', visitante: 'Visitante',
  };
  const COM_FILA = ['servidor', 'estagiario', 'residente', 'diretor'];
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
    aba: 'fila', verComo: '', area: 'fila', menuAreas: false,
    abaMetas: 'visao', metas: { envios: [], pend: null, pendEnvio: null, carregando: false, erro: false }, fMetas: { meta: '', inst: '', busca: '', limite: 300 }, metasImp: null,
    vis: {
      fila: { busca: '', tarefa: '', concl: false, limite: LIMITE_NORMAL, pessoa: '', visao: '', etiqueta: '' },
      geral: { busca: '', tarefa: '', concl: false, limite: LIMITE_NORMAL, pessoa: '', visao: '', etiqueta: '' },
      gestor: { busca: '', tarefa: '', concl: false, limite: LIMITE_NORMAL, pessoa: '', visao: '', etiqueta: '' },
    },
    gOculta: false, gBase: 0, duAberta: false, novaUrgDir: { numero: '', setor: 'secretaria', responsavel: '', motivo: '' },
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
  const nomes = () => Object.assign({ [GESTOR_ID]: 'Gestor' }, Object.fromEntries(pessoas().map(p => [p.id, p.nome])));
  const nomeDe = id => nomes()[id] || id || '—';
  const tipoDe = id => id === GESTOR_ID ? 'gestor' : (pessoas().find(p => p.id === id) || {}).tipo;
  // Diretor e gestor têm fila própria, escolhida só por etiquetas, em paralelo com a dos servidores.
  const ehEspecial = id => id === GESTOR_ID || tipoDe(id) === 'diretor';
  const temFila = () => COM_FILA.includes(st.perfil);
  // "Ver como": o gestor abre, só para leitura, a fila de outra pessoa.
  const pessoaAtiva = () => st.verComo || st.pessoa;
  const tipoAtivo = () => st.verComo ? tipoDe(st.verComo) : st.perfil;
  const podeEnviar = modo => modo === 'gestor' || tipoAtivo() === 'servidor' || tipoAtivo() === 'diretor';
  // Estagiário e residente devolvem processos da lista; o diretor devolve urgências recebidas.
  const podeDevolver = l => (['estagiario', 'residente'].includes(tipoAtivo()) && l.origem === 'lista') || (tipoAtivo() === 'diretor' && l.origem === 'urgencia');
  const donoDe = modo => (modo === 'gestor' ? st.pessoa : pessoaAtiva());
  const opcoesTipo = sel => TIPOS.map(([id, , rot]) => `<option value="${id}"${(sel || 'servidor') === id ? ' selected' : ''}>${rot}</option>`).join('');

  // O diretor só entra nas listas em que o chamador pede (inc.diretor); o gestor, só com inc.gestor.
  function opcoesPessoas(sel, vazio, excluir, inc) {
    inc = inc || {};
    let h = vazio != null ? `<option value="">${esc(vazio)}</option>` : '';
    if (inc.gestor && excluir !== GESTOR_ID) h += `<option value="${GESTOR_ID}"${sel === GESTOR_ID ? ' selected' : ''}>Gestor</option>`;
    for (const [tipo, plural] of TIPOS) {
      if (tipo === 'diretor' && !inc.diretor) continue;
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
      area: 'fila', menuAreas: false, abaMetas: 'visao', metas: { envios: [], pend: null, pendEnvio: null, carregando: false, erro: false }, metasImp: null,
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
      st.nome = data.nome; st.perfil = data.perfil; st.pessoa = data.perfil === 'gestor' ? GESTOR_ID : (data.pessoa_id || '');
      const visto = Number(ler('fila.visita.' + st.email));
      st.ultimaVisita = visto || Date.now() - DIA;
      guardar('fila.visita.' + st.email, String(Date.now()));
      await carregar();
      const abas = abasDisponiveis();
      const salva = ler('fila.aba.' + st.email);
      st.aba = abas.includes(salva) ? salva : abas[0];
      st.area = 'fila'; st.menuAreas = false; // o painel sempre abre na Fila de Trabalho
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

  // Áreas do painel (menu do logo). Metas CNJ: gestor, servidores, magistrado(a) e diretor de secretaria.
  const HOJE = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const AREAS = {
    fila: { rotulo: 'Fila de Trabalho', titulo: 'Fila de Trabalho', subtitulo: 'Gestão de Processos · 2ª Vara Federal · ' + HOJE, pagina: 'Fila de Trabalho · Gestão de Processos' },
    metas: { rotulo: 'Metas CNJ', titulo: 'Metas CNJ', subtitulo: 'Metas Nacionais 2026 · 2ª Vara Federal', pagina: 'Metas CNJ · Gestão de Processos' },
  };
  const PERFIS_METAS = ['gestor', 'servidor', 'magistrado', 'diretor'];
  function areasDisponiveis() {
    return PERFIS_METAS.includes(st.perfil) ? ['fila', 'metas'] : ['fila'];
  }
  function irParaArea(area) {
    st.menuAreas = false;
    if (!areasDisponiveis().includes(area)) area = 'fila';
    if (st.area !== area) { st.area = area; st.anotando = null; st.devolvendo = null; st.modal = null; window.scrollTo({ top: 0 }); }
    render();
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
      todas((a, b) => sb.from('marcas').select('pessoa,chave,em,devolvido,item,desfeito').gte('em', desdeMarcas).order('pessoa').order('chave').range(a, b)),
      todas((a, b) => sb.from('notas').select('pessoa,numero,texto,em').order('pessoa').order('numero').range(a, b)),
      gestor ? todas((a, b) => sb.from('acesso').select('email,nome,perfil,pessoa_id').order('email').range(a, b)) : Promise.resolve([]),
      gestor ? sb.from('acessos_negados').select('email,em').order('em', { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    ]);
    if (cfg.error) throw cfg.error;
    if (negados.error) throw negados.error;
    // Metas CNJ: só o histórico dos envios (pequeno); a lista de pendentes é carregada quando a aba Pendentes é aberta.
    if (PERFIS_METAS.includes(st.perfil)) {
      const m = await sb.from('metas_envios').select('id,enviado_em,enviado_por,carga_bi,resumo,n_pendentes,arquivos').order('carga_bi', { ascending: false }).limit(120);
      if (m.error) { console.error(m.error); st.metas.erro = true; } else { st.metas.erro = false; st.metas.envios = m.data || []; }
    }
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
    for (const m of marcas) (st.marcas[m.pessoa] = st.marcas[m.pessoa] || {})[m.chave] = { em: ms(m.em), dev: !!m.devolvido, item: m.item || null, desfeito: !!m.desfeito };
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
    const notasP = st.notas[p] || {};
    // Processo que saiu da lista mas segue na fila por causa da anotação: some assim que a anotação for excluída.
    for (const r of st.filas) if (r.pessoa === p) for (const it of r.itens || []) if (!it.fora || (notasP[R.soDigitos(it.n)] || {}).texto) itens.push(it);
    const umMes = Date.now() - 30 * DIA;
    const fila = R.montarFila({
      itens,
      urgencias: st.urgencias.filter(u => u.via !== 'lista' && u.responsavel === p && (!u.concluidaEm || u.concluidaEm > umMes)),
      devolucoes: st.devolucoes.filter(d => d.para === p && (!d.concluidaEm || d.concluidaEm > umMes)),
      marcas: Object.fromEntries(Object.entries(st.marcas[p] || {}).filter(([, m]) => !m.desfeito)), tarefas: ehEspecial(p) ? new Map() : st.mapaTarefas, ultimaVisita: st.ultimaVisita,
    });
    // Concluídos que já saíram da lista continuam aparecendo (só em "Mostrar concluídos"), pelas marcas guardadas.
    const marcasP = Object.fromEntries(Object.entries(st.marcas[p] || {}).filter(([, m]) => !m.desfeito));
    const presentes = new Set(fila.filter(l => l.ch != null).map(l => R.chaveItem({ n: l.n, ch: l.ch })));
    for (const chave of Object.keys(marcasP)) {
      const m = marcasP[chave];
      if (presentes.has(chave) || fila.some(l => l.chave === chave)) continue;
      let it = m.item;
      if (!it) { // marca antiga, sem dados guardados: só dá para recuperar número e chegada pela chave
        const [dig, ch] = chave.split('|');
        if (!dig || dig.length !== 20) continue;
        it = { n: R.formatarCNJ(dig) }; if (ch) it.ch = Number(ch);
      }
      fila.push(Object.assign({}, it, { origem: 'lista', tipo: it.tipo || 'normal', chave, concluido: true, devolvido: !!m.dev, novo: false, foraDaLista: true }));
    }
    for (const l of fila) {
      const nota = notasP[R.soDigitos(l.n)];
      if (nota && nota.texto) { l.anot = nota.texto; l.anotEm = nota.em; }
      if (l.fora) l.foraDaLista = true;
      l.dono = p;
    }
    fila.sort(R.comparar);
    const todasMarcas = st.marcas[p] || {};
    for (const l of fila) {
      const m = l.ch != null ? todasMarcas[R.chaveItem({ n: l.n, ch: l.ch })] : null;
      const mm = todasMarcas[l.chave] || m;
      if (l.concluido) {
        const fonte = l.origem === 'urgencia' ? st.urgencias.find(x => x.id === l.id) : l.origem === 'devolucao' ? st.devolucoes.find(x => x.id === l.id) : null;
        l.concluidoEm = (fonte && fonte.concluidaEm) || (mm && !mm.desfeito ? mm.em : null) || null;
      } else if (mm && mm.desfeito) l.concluidoAntes = mm.em;
    }
    c.m[p] = fila;
    return fila;
  }

  // Visões (filtros opcionais por pessoa, configurados na Gestão). O painel sempre abre sem filtro; nada é lembrado.
  const visoesDe = p => ((st.config && st.config.visoes) || []).filter(v => p && v.pessoa === p && v.nome && v.valor);
  const idVisao = v => v.pessoa + '|' + v.nome;
  const pessoaDaVisao = modo => (modo === 'geral' ? st.vis.geral.pessoa : pessoaAtiva()) || '';
  function visaoAtiva(modo) { const f = st.vis[modo]; return f.visao ? visoesDe(pessoaDaVisao(modo)).find(v => idVisao(v) === f.visao) || null : null; }
  function passaVisao(v, l) {
    if (v.tipo === 'setor') return l.s === v.valor;
    const casa = R.casaPadrao(l.c, v.valor);
    return v.tipo === 'classe' ? casa : !casa;
  }
  const aplicarVisao = (modo, ls) => { const v = visaoAtiva(modo); return v ? ls.filter(l => passaVisao(v, l)) : ls; };

  function linhasGeral(pessoa) {
    const ids = pessoa ? [pessoa] : pessoas().filter(p => p.tipo !== 'diretor').map(p => p.id);
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
    const emMetas = ok && st.area === 'metas';
    $('#v-estado').hidden = ok;
    for (const a of ['fila', 'geral', 'gestao']) $('#v-' + a).hidden = !ok || emMetas || st.aba !== a;
    $('#v-metas').hidden = !emMetas;
    if (!ok) {
      for (const a of ['fila', 'geral', 'gestao', 'metas']) $('#v-' + a).innerHTML = '';
      renderEstado(); renderModal(); return;
    }
    $('#v-estado').innerHTML = '';
    if (emMetas) {
      for (const a of ['fila', 'geral', 'gestao']) $('#v-' + a).innerHTML = '';
      renderMetas(); renderModal(); return;
    }
    $('#v-metas').innerHTML = '';
    for (const a of ['fila', 'geral', 'gestao']) if (a !== st.aba) $('#v-' + a).innerHTML = '';
    if (st.aba === 'fila') renderLista('fila');
    else if (st.aba === 'geral') renderLista('geral');
    else if (window.PAINEL.renderGestao) {
      const foco = document.activeElement && document.activeElement.id;
      const pos = foco === 'busca' ? document.activeElement.selectionStart : null;
      window.PAINEL.renderGestao();
      if (foco === 'busca') { const b = $('#busca'); if (b) { b.focus(); if (pos != null) b.setSelectionRange(pos, pos); } }
      if (foco === 'nota-texto' || foco === 'dev-motivo') { const m = document.getElementById(foco); if (m) { m.focus(); m.setSelectionRange(m.value.length, m.value.length); } }
    }
    renderModal();
  }

  // Urgências abertas na fila do gestor (processos que servidores, diretor ou o próprio gestor enviaram a ele).
  const urgenciasDoGestor = () => st.perfil === 'gestor' ? filaDe(GESTOR_ID).filter(l => l.origem === 'urgencia' && !l.concluido).length : 0;

  // Área Metas CNJ: por enquanto só a estrutura; os dados virão da planilha do Portal BI enviada pelo gestor.
  function renderMetas() {
    if (window.PAINEL.renderMetas) window.PAINEL.renderMetas();
    else $('#v-metas').innerHTML = '<div class="vazio"><h2>Metas CNJ</h2><p>Carregando…</p></div>';
  }

  function renderMenuAreas(ok) {
    const lista = ok ? areasDisponiveis() : [];
    const btn = $('#btn-areas'), menu = $('#menu-areas');
    const abre = lista.length > 1; // com uma só área o logo continua apenas como identidade
    btn.disabled = !abre;
    if (!abre) st.menuAreas = false;
    btn.setAttribute('aria-expanded', String(st.menuAreas));
    menu.hidden = !st.menuAreas;
    const h = lista.map(a => `<button class="item-area" type="button" role="menuitemradio" aria-checked="${a === st.area}" data-area="${a}">${AREAS[a].rotulo}</button>`).join('');
    if (menu.dataset.h !== h) { menu.innerHTML = h; menu.dataset.h = h; }
    for (const b of menu.querySelectorAll('.item-area')) b.setAttribute('aria-checked', String(b.dataset.area === st.area));
  }

  function renderTopo() {
    const ok = st.estado === 'ok';
    const area = AREAS[ok ? st.area : 'fila'];
    $('#sou').hidden = !ok;
    document.title = ok ? area.pagina : 'Acesso restrito';
    $('#marca-nome').hidden = !ok; // título e subtítulo só aparecem depois de validado o acesso
    $('#marca-nome h1').textContent = area.titulo;
    $('#subtitulo').textContent = area.subtitulo;
    renderMenuAreas(ok);
    const sel = $('#ver-como');
    const mostrarSel = ok && st.area === 'fila' && st.perfil === 'gestor' && pessoas().length > 0;
    sel.hidden = !mostrarSel;
    if (mostrarSel) {
      const h = opcoesPessoas(st.verComo, 'Ver a fila como…', null, { diretor: true });
      if (sel.dataset.h !== h) { sel.innerHTML = h; sel.dataset.h = h; }
      sel.value = st.verComo;
    }
    if (ok) $('#quem').innerHTML = `${esc(st.nome)} <small>${esc(PERFIS[st.perfil] || st.perfil)}</small>`;
    const emMetas = st.area === 'metas';
    const abas = !ok ? [] : emMetas ? ['visao', 'pendentes'] : abasDisponiveis();
    const atual = emMetas ? st.abaMetas : st.aba;
    const nav = $('#abas');
    nav.hidden = abas.length < 2;
    const rot = { fila: 'Fila', geral: 'Geral', gestao: 'Gestão', visao: 'Visão geral', pendentes: 'Pendentes' };
    const nAvisos = emMetas ? 0 : urgenciasDoGestor();
    const h = abas.map(a => `<button class="aba" role="tab" id="aba-${a}" aria-selected="${a === atual}" data-aba="${a}">${rot[a]}${a === 'gestao' && nAvisos ? ` <span class="contagem">${nAvisos}</span>` : ''}</button>`).join('');
    if (nav.dataset.h !== h) { nav.innerHTML = h; nav.dataset.h = h; }
    for (const b of nav.querySelectorAll('.aba')) b.setAttribute('aria-selected', String(b.dataset.aba === atual));
  }

  function renderAvisos() {
    const abertos = urgenciasDoGestor();
    $('#avisos').innerHTML = st.estado === 'ok' && st.area !== 'fila' ? ''
      : st.estado === 'ok' && st.verComo
      ? `<div class="aviso novo"><b>Visualização somente leitura.</b> Você está vendo a fila de ${esc(nomeDe(st.verComo))} como ela vê. Nada é gravado. <button class="btn" type="button" data-acao="sair-ver-como">Voltar à minha visão</button></div>`
      : st.estado === 'ok' && abertos
        ? `<div class="aviso novo"><b>${abertos} ${abertos === 1 ? 'processo enviado' : 'processos enviados'} para você verificar.</b> <button class="btn" type="button" data-acao="abrir-avisos">Ver na aba Gestão</button></div>`
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
    if (l.fp) {
      const balaoFp = 'O processo aparece em uma tarefa principal e em pelo menos um fluxo paralelo. Verificar a necessidade de encerrar o(s) fluxo(s) paralelo(s)';
      selos.push(`<span class="selo paralelo" tabindex="0" role="note" aria-label="Fluxo paralelo. ${esc(balaoFp)}" data-balao="${esc(balaoFp)}">Fluxo paralelo</span>`);
    }
    if (l.devolvido) selos.push('<span class="selo devolvido">Devolvido ao servidor</span>');
    if (l.concluido) selos.push(`<span class="selo feito">Concluído${l.concluidoEm ? ' em ' + dataHoraBR(l.concluidoEm) : ''}</span>`);
    else if (l.concluidoAntes) selos.push(`<span class="selo anterior" title="Esse processo foi concluído e a conclusão foi desfeita">Concluído antes em ${dataHoraBR(l.concluidoAntes)}</span>`);
    if (l.foraDaLista) {
      const balao = l.dono === st.pessoa ? 'Esse processo não apareceu mais na sua lista na última atualização.' : `Esse processo não apareceu mais na lista de ${nomeDe(l.dono)} na última atualização.`;
      selos.push(`<span class="selo fora" tabindex="0" role="note" aria-label="Saiu da lista. ${esc(balao)}" data-balao="${esc(balao)}">Saiu da lista</span>`);
    }
    const d = dias(l.ch);
    let nota = '';
    if (l.origem === 'urgencia') {
      if (l.via === 'envio') nota = `<div class="nota"><b>Enviado por ${esc(nomeDe(l.de))}</b> em ${dataHoraBR(l.criadaEm)}${l.motivo ? ': ' + esc(l.motivo) : ''}</div>`;
      else if (l.via === 'gestor') nota = `<div class="nota"><b>Urgência</b> incluída em ${dataHoraBR(l.criadaEm)}${l.motivo ? ': ' + esc(l.motivo) : ''}</div>`;
      else if (l.motivo) nota = `<div class="nota"><b>Urgência</b>: ${esc(l.motivo)}</div>`;
    }
    if (l.origem === 'devolucao') nota = `<div class="nota"><b>Devolvido por ${esc(nomeDe(l.de))}</b> em ${dataHoraBR(l.criadaEm)}${l.motivo ? ': ' + esc(l.motivo) : ''}</div>`;
    const resp = geral ? `<div class="sub sub-resp">Responsável: ${esc(nomeDe(l.dono))}</div>` : '';
    // Fila do diretor: mostra só as etiquetas da lista dele que o processo tem.
    const etqHTML = l.ed && l.ed.length ? `<div class="etiquetas" aria-label="Etiquetas do filtro">${l.ed.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : '';
    let acoes = '', anot, form = '';
    const dis = st.verComo && modo !== 'gestor' ? ' disabled title="Visualização somente leitura"' : '';
    if (geral) {
      anot = l.anot ? `<span class="anot-texto">${esc(l.anot)}</span><span class="quando">${dataHoraBR(l.anotEm)}</span>` : '<span class="muted">—</span>';
    } else {
      if (l.concluido) {
        acoes = `<button class="btn" data-acao="desfazer"${dis}>Desfazer</button>`;
      } else {
        acoes = `<button class="btn feito" data-acao="concluir"${dis}>Marcar como concluído</button>`;
        if (podeEnviar(modo)) acoes += `<button class="btn" data-acao="enviar"${dis}>Enviar para outra pessoa</button>`;
        if (podeDevolver(l) && modo !== 'gestor') acoes += `<button class="btn" data-acao="devolver"${dis}>Devolver</button>`;
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
        const doDiretor = tipoAtivo() === 'diretor';
        const sugerido = doDiretor ? (l.via === 'envio' && l.de ? l.de : GESTOR_ID) : (l.resp || R.atribuir(l, l.s, st.config || {}).pessoa || '');
        form = `<form class="devolver-form" data-form="devolver">
          <label class="small" for="dev-motivo">Motivo</label>
          <input type="text" id="dev-motivo" placeholder="Ex.: precisa de despacho, não sei elaborar o ofício" maxlength="300" value="${esc(st.devMotivo || '')}">
          <label class="small" for="dev-para">Para</label>
          <select id="dev-para">${opcoesPessoas(sugerido, 'Escolha quem recebe', null, { gestor: doDiretor })}</select>
          <button class="btn primario" type="submit">${doDiretor ? 'Devolver' : 'Devolver ao servidor'}</button>
          <button class="btn" type="button" data-acao="cancelar-devolucao">Cancelar</button>
        </form>`;
      }
    }
    return `<li class="linha t-${l.tipo}${l.concluido ? ' concluido' : ''}" data-chave="${esc(l.chave)}" data-dono="${esc(l.dono || '')}">
      <div class="faixa"></div>
      <div class="c-num">
        <button class="num" data-acao="copiar" data-n="${esc(l.n)}" title="Copiar número">${numeroHTML(l.n)}</button>
        ${selos.length ? `<div class="selos">${selos.join('')}</div>` : ''}
        ${nota}${resp}${etqHTML}
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

  // Seções da lista (Urgências, Devolvidos, Prioritárias, Fila). Concluídos, quando exibidos, ficam juntos no topo de cada seção.
  function htmlGrupos(modo, visiveis, f) {
    const geral = modo === 'geral';
    let h = '';
    const grupos = [
      ['urgente', 'Urgências', 'Por antiguidade na tarefa'],
      ['devolvido', 'Devolvidos', 'Processos devolvidos para você'],
      ['prioritaria', 'Tarefas prioritárias', 'Por antiguidade na tarefa'],
      ['normal', 'Fila por antiguidade', geral ? 'Por antiguidade na tarefa' : 'Do mais antigo para o mais recente na tarefa'],
    ];
    for (const [tipo, titulo, dica] of grupos) {
      let ls = visiveis.filter(l => l.tipo === tipo);
      ls = [...ls.filter(l => l.concluido), ...ls.filter(l => !l.concluido)];
      if (!ls.length) continue;
      const total = ls.length;
      if (tipo === 'normal' && ls.length > f.limite) ls = ls.slice(0, f.limite);
      h += `<section class="grupo g-${tipo}" id="grupo-${modo}-${tipo}" tabindex="-1"><div class="grupo-cab"><span class="ponto"></span><h2>${titulo}</h2><span class="contagem">${total}</span><p>${dica}</p><button type="button" class="btn discreto topo-link" data-acao="topo">↑ Voltar ao topo</button></div><ol class="linhas">${CABECALHO_LINHAS}${ls.map(l => linhaHTML(l, modo)).join('')}</ol>`;
      if (ls.length < total) h += `<button class="btn mais" data-acao="mais">Mostrar mais ${Math.min(LIMITE_NORMAL, total - ls.length)} de ${total - ls.length} restantes</button>`;
      h += '</section>';
    }
    return h;
  }

  // Filtro de etiqueta: fila do diretor usa as etiquetas dele ("ed"); as demais, as de Pagamentos ("et").
  function etConfig(modo) {
    const alvo = modo === 'geral' ? st.vis.geral.pessoa : donoDe(modo);
    const dir = !!alvo && tipoDe(alvo) === 'diretor';
    const cfg = st.config || {};
    return { campo: dir ? 'ed' : 'et', lista: dir ? (cfg.etiquetasDiretor || []).map(x => x.e).filter(Boolean) : (cfg.etiquetasFiltro || []), especial: !!alvo && ehEspecial(alvo) };
  }

  function renderLista(modo) {
    const v = $('#v-' + modo);
    const f = st.vis[modo];
    const geral = modo === 'geral';
    if (!st.config) {
      v.innerHTML = `<div class="vazio"><h2>O painel ainda não foi configurado</h2><p>${st.perfil === 'gestor' ? 'Abra a aba Gestão para cadastrar as pessoas e as regras de distribuição.' : 'Aguarde o gestor cadastrar as pessoas e as regras de distribuição.'}</p></div>`;
      return;
    }
    const todas = aplicarVisao(modo, geral ? linhasGeral(f.pessoa) : filaDe(pessoaAtiva()));
    const abertas = todas.filter(l => !l.concluido);
    const conta = t => abertas.filter(l => l.tipo === t).length;
    const novos = geral ? 0 : abertas.filter(l => l.novo).length;
    const tarefas = [...new Set(todas.map(l => l.t).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const { campo: campoEt, lista: listaEt, especial } = etConfig(modo);
    const etiquetas = listaEt.filter(x => todas.some(l => (l[campoEt] || []).includes(x)));
    if (f.etiqueta && !etiquetas.includes(f.etiqueta)) f.etiqueta = '';
    const busca = R.normTexto(f.busca);
    const buscaDig = R.soDigitos(f.busca);
    const visiveis = todas.filter(l => {
      if (l.concluido && !f.concl) return false;
      if (f.tarefa && l.t !== f.tarefa) return false;
      if (f.etiqueta && !(l[campoEt] || []).includes(f.etiqueta)) return false;
      if (!busca) return true;
      if (buscaDig.length >= 4 && R.soDigitos(l.n).includes(buscaDig)) return true;
      return R.normTexto([l.n, l.c, l.t, l.cg, l.motivo, l.anot, geral ? nomeDe(l.dono) : ''].join(' ')).includes(busca);
    });
    const concluidos = todas.length - abertas.length;
    const ultimaLista = st.filas.filter(r => r.lista === 'semanal').reduce((m, r) => Math.max(m, ms(r.importado_em) || 0), 0);
    const ultimoDiario = st.filas.filter(r => r.lista === 'diaria').reduce((m, r) => Math.max(m, ms(r.importado_em) || 0), 0);

    let h = '';
    if (novos) h += `<div class="aviso novo"><b>${novos} ${novos === 1 ? 'processo novo' : 'processos novos'}</b> em urgências ou tarefas prioritárias desde a sua última visita (${dataHoraBR(st.ultimaVisita)}).</div>`;
    if (modo === 'fila' && st.perfil === 'diretor' && !st.verComo) h += htmlUrgenciaDiretor();
    h += `<div class="contagens">
      <button type="button" class="tile urgente" data-acao="ir" data-tipo="urgente" title="Ir para esta lista"><span>Urgentes</span><b>${conta('urgente')}</b></button>
      ${especial ? '' : `<button type="button" class="tile devolvido" data-acao="ir" data-tipo="devolvido" title="Ir para esta lista"><span>Devolvidos</span><b>${conta('devolvido')}</b></button>
      <button type="button" class="tile prioritaria" data-acao="ir" data-tipo="prioritaria" title="Ir para esta lista"><span>Prioritárias</span><b>${conta('prioritaria')}</b></button>`}
      <button type="button" class="tile" data-acao="ir" data-tipo="normal" title="Ir para esta lista"><span>Na fila</span><b>${conta('normal')}</b></button>
      <div class="tile concluido"><span>Concluídos</span><b>${concluidos}</b></div>
    </div>
    <p class="atualizacao">Lista completa: ${ultimaLista ? dataHoraBR(ultimaLista) : 'ainda não enviada'} · Atualização diária: ${ultimoDiario ? dataHoraBR(ultimoDiario) : 'ainda não enviada'} · Clique no número para copiar.</p>
    <div class="filtros">
      <input type="search" id="busca" placeholder="Buscar por número, classe, tarefa, cargo ou anotação" value="${esc(f.busca)}" aria-label="Buscar">
      ${geral && st.perfil !== 'visitante' ? `<select id="filtro-pessoa" aria-label="Filtrar por servidor">${opcoesPessoas(f.pessoa, 'Todos os servidores', null, { diretor: true })}</select>` : ''}
      ${(() => { const vs = visoesDe(pessoaDaVisao(modo)); return vs.length ? `<select id="filtro-visao" aria-label="Mostrar"><option value="">Painel completo</option>${vs.map(v => `<option value="${esc(idVisao(v))}"${idVisao(v) === f.visao ? ' selected' : ''}>${esc(v.nome)}</option>`).join('')}</select>` : ''; })()}
      <select id="filtro-tarefa" aria-label="Filtrar por tarefa"><option value="">Todas as tarefas</option>${tarefas.map(t => `<option${t === f.tarefa ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
      ${etiquetas.length ? `<select id="filtro-etiqueta" aria-label="Filtrar por etiqueta"><option value="">Todas as etiquetas</option>${etiquetas.map(x => `<option value="${esc(x)}"${x === f.etiqueta ? ' selected' : ''}>${esc(x)} (${todas.filter(l => !l.concluido && (l[campoEt] || []).includes(x)).length})</option>`).join('')}</select>` : ''}
      <label class="small"><input type="checkbox" id="mostrar-concluidos"${f.concl ? ' checked' : ''}> Mostrar concluídos</label>
      <div class="direita"><button class="btn" data-acao="baixar">Baixar CSV</button></div>
    </div>`;

    if (!todas.length) {
      h += `<div class="vazio"><h2>Nenhum processo ${geral ? 'no painel' : 'na sua fila'}</h2><p>A fila é preenchida quando o gestor envia o relatório do PJe+R. Urgências e devoluções aparecem aqui assim que forem incluídas.</p></div>`;
      v.innerHTML = h; return;
    }
    h += htmlGrupos(modo, visiveis, f);
    if (!visiveis.length) h += `<div class="vazio"><h2>Nenhum processo com esse filtro</h2><p>Limpe a busca ou escolha outra tarefa.</p></div>`;
    const foco = document.activeElement && document.activeElement.id;
    const pos = foco === 'busca' ? document.activeElement.selectionStart : null;
    v.innerHTML = h;
    if (foco === 'busca') { const b = $('#busca'); b.focus(); if (pos != null) b.setSelectionRange(pos, pos); }
    if (['dev-motivo', 'nota-texto', 'du-numero', 'du-motivo'].includes(foco)) { const m = document.getElementById(foco); if (m) { m.focus(); m.setSelectionRange(m.value.length, m.value.length); } }
  }

  // ---------- diretor: incluir urgência para outra pessoa (mesmo formato do quadro do gestor) ----------
  function htmlUrgenciaDiretor() {
    const u = st.novaUrgDir, setor = u.setor || 'secretaria';
    const paraGestor = setor === GESTOR_ID;
    const doSetor = paraGestor ? [] : R.pessoasDoSetor(setor, st.config || {});
    const respOpc = doSetor.length
      ? `<option value="">Escolha</option>` + doSetor.map(id => `<option value="${esc(id)}"${id === u.responsavel ? ' selected' : ''}>${esc(nomeDe(id))}</option>`).join('')
      : `<option value="">Nenhuma pessoa atende este setor</option>`;
    const form = st.duAberta ? `<form class="campos" data-form="urgencia-diretor">
        <p class="small muted">A urgência vai para o topo da fila do responsável e fica lá até ele marcar como concluída.</p>
        <label class="campo"><span>Número do processo</span><input type="text" id="du-numero" class="mono" inputmode="numeric" placeholder="0000000-00.0000.0.00.0000" value="${esc(u.numero)}" required></label>
        <label class="campo"><span>Setor</span><select id="du-setor">${SETORES.map(([id, n]) => `<option value="${id}"${id === setor ? ' selected' : ''}>${n}</option>`).join('')}<option value="${GESTOR_ID}"${paraGestor ? ' selected' : ''}>Gestor</option></select></label>
        ${paraGestor ? '' : `<label class="campo"><span>Responsável</span><select id="du-resp" required>${respOpc}</select></label>`}
        <label class="campo"><span>Motivo</span><input type="text" id="du-motivo" maxlength="300" placeholder="Ex.: pedido do juiz, assunto da sua área" value="${esc(u.motivo)}"></label>
        <div class="linha-botoes"><button class="btn primario" type="submit">Incluir urgência</button><button class="btn" type="button" data-acao="du-abrir">Fechar</button></div>
      </form>` : '';
    return `<section class="painel incluir-urg-dir"><div class="linha-botoes"><b>Incluir urgência para outra pessoa</b>${st.duAberta ? '' : '<button class="btn" type="button" data-acao="du-abrir">Incluir urgência</button>'}</div>${form}</section>`;
  }

  function sugerirDu() {
    const u = st.novaUrgDir;
    const doSetor = u.setor === GESTOR_ID ? [] : R.pessoasDoSetor(u.setor, st.config || {});
    if (!doSetor.includes(u.responsavel)) u.responsavel = doSetor.length === 1 ? doSetor[0] : '';
    if (R.soDigitos(u.numero).length >= 7 && doSetor.length) {
      const x = R.atribuir({ n: u.numero }, u.setor, st.config || {});
      if (x.pessoa && doSetor.includes(x.pessoa)) u.responsavel = x.pessoa;
    }
  }

  async function incluirUrgenciaDiretor() {
    const u = st.novaUrgDir, numero = R.soDigitos(u.numero), setor = u.setor || 'secretaria';
    const responsavel = setor === GESTOR_ID ? GESTOR_ID : u.responsavel;
    if (numero.length !== 20) { toast('O número do processo deve ter 20 dígitos (padrão CNJ).'); return; }
    if (!responsavel) { toast('Escolha o responsável.'); return; }
    if (setor !== GESTOR_ID && !R.pessoasDoSetor(setor, st.config || {}).includes(responsavel)) { toast('Esse responsável não atende o setor escolhido.'); return; }
    const { error } = await st.sb.from('urgencias').insert({
      numero, responsavel, origem: 'envio', remetente: st.pessoa, motivo: (u.motivo || '').trim() || null,
      item: setor === GESTOR_ID ? {} : { s: setor }, criada_por: st.email,
    });
    if (error) { if (error.code === '23505') { toast('Esse processo já está como urgência aberta para essa pessoa.'); return; } throw error; }
    st.novaUrgDir = { numero: '', setor, responsavel: '', motivo: '' };
    toast('Urgência incluída para ' + nomeDe(responsavel) + '.');
    await carregar(); render();
  }

  // ---------- gestor: fila própria no topo da aba Gestão ----------
  function htmlGestorFila() {
    if (st.perfil !== 'gestor' || !st.config) return '';
    const f = st.vis.gestor;
    const todas = filaDe(GESTOR_ID);
    const abertas = todas.filter(l => !l.concluido);
    const nUrg = abertas.filter(l => l.tipo === 'urgente').length, nFila = abertas.length - nUrg;
    const etiqueta = st.config.etiquetaGestor == null ? R.ETIQUETA_GESTOR_PADRAO : st.config.etiquetaGestor;
    const novo = st.gOculta && nUrg > st.gBase;
    const cab = `<div class="gestor-cab"><h2>Fila do gestor</h2><span class="contagem">${nUrg} ${nUrg === 1 ? 'urgência' : 'urgências'} · ${nFila} na fila</span>${novo ? '<span class="selo urgente">Novo processo enviado</span>' : ''}<button class="btn" type="button" data-acao="gestor-ocultar">${st.gOculta ? 'Mostrar' : 'Ocultar'}</button></div>`;
    if (st.gOculta) return `<div class="gestor-fila oculta" id="gestor-fila">${cab}</div>`;
    const busca = R.normTexto(f.busca), buscaDig = R.soDigitos(f.busca);
    const visiveis = todas.filter(l => {
      if (l.concluido && !f.concl) return false;
      if (!busca) return true;
      if (buscaDig.length >= 4 && R.soDigitos(l.n).includes(buscaDig)) return true;
      return R.normTexto([l.n, l.c, l.t, l.cg, l.motivo, l.anot].join(' ')).includes(busca);
    });
    let h = `<div class="gestor-fila" id="gestor-fila">${cab}
      <p class="small muted">Processos com a etiqueta “${esc(etiqueta)}” e os que servidores, o diretor ou você enviaram para o gestor. Por antiguidade na tarefa.</p>
      <div class="filtros dentro"><input type="search" id="busca" placeholder="Buscar por número, classe, tarefa, cargo ou anotação" value="${esc(f.busca)}" aria-label="Buscar na fila do gestor">
      <label class="small"><input type="checkbox" id="mostrar-concluidos"${f.concl ? ' checked' : ''}> Mostrar concluídos</label></div>`;
    h += todas.length ? htmlGrupos('gestor', visiveis, f) : '<div class="vazio"><p>Nenhum processo na fila do gestor.</p></div>';
    if (todas.length && !visiveis.length) h += '<div class="vazio"><p>Nenhum processo com esse filtro.</p></div>';
    return h + '</div>';
  }

  // ---------- gravações da fila ----------
  // Guarda junto os dados do processo: assim o concluído continua aparecendo (em "Mostrar concluídos") mesmo que saia da lista nova.
  const fotoDe = l => { const o = {}; for (const k of ['n', 'c', 't', 'cg', 'ch', 's', 'tipo', 'ed']) if (l[k] != null) o[k] = l[k]; return o; };
  async function gravarMarca(pessoa, chave, dev, agora, linha) {
    const item = linha ? fotoDe(linha) : null;
    const reg = { pessoa, chave, em: iso(agora), devolvido: !!dev, desfeito: false };
    if (item) reg.item = item;
    const { error } = await st.sb.from('marcas').upsert(reg, { onConflict: 'pessoa,chave' });
    if (error) throw error;
    (st.marcas[pessoa] = st.marcas[pessoa] || {})[chave] = { em: agora, dev: !!dev, item: item || ((st.marcas[pessoa] || {})[chave] || {}).item || null, desfeito: false };
    st.ver++;
  }

  // Desfazer: o processo volta para a fila, mas a marca fica (desfeita) para mostrar "Concluído antes em ..." até concluir de novo.
  async function desfazerMarca(pessoa, chave) {
    const { error } = await st.sb.from('marcas').update({ desfeito: true }).eq('pessoa', pessoa).eq('chave', chave);
    if (error) throw error;
    const m = (st.marcas[pessoa] || {})[chave]; if (m) m.desfeito = true;
    st.ver++;
  }

  // Conclui na fila de quem está logado: marca da lista (número + chegada) ou fecha a urgência/devolução.
  async function concluirLinha(l) {
    const agora = Date.now(), p = st.pessoa;
    if (l.origem === 'lista') { await gravarMarca(p, l.chave, false, agora, l); return; }
    const urg = l.origem === 'urgencia';
    const campos = urg ? { concluida_em: iso(agora), concluida_por: p } : { concluida_em: iso(agora) };
    const { error } = await st.sb.from(urg ? 'urgencias' : 'devolucoes').update(campos).eq('id', l.id);
    if (error) throw error;
    const lista = urg ? st.urgencias : st.devolucoes;
    const r = lista.find(x => x.id === l.id); if (r) r.concluidaEm = agora;
    // evita que o mesmo processo volte como item comum da lista (mesmo número e mesma chegada)
    if (l.ch != null) await gravarMarca(p, R.chaveItem({ n: l.n, ch: l.ch }), false, agora, l);
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
      if (l.ch != null) await desfazerMarca(p, R.chaveItem({ n: l.n, ch: l.ch }));
    } else await desfazerMarca(p, l.chave);
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

  const itemDe = l => { const item = {}; for (const k of ['n', 'c', 't', 'cg', 'ch', 's', 'sg', 'u', 'et', 'resp']) if (l[k] != null) item[k] = l[k]; return item; };
  const acharLinha = (chave, pessoa) => filaDe(pessoa || pessoaAtiva()).find(l => l.chave === chave);

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
    if (tipoAtivo() === 'diretor') {
      // O diretor devolve a urgência que recebeu: ao servidor (devolvido) ou ao gestor (urgência na fila do gestor).
      if (para === GESTOR_ID) {
        const { error } = await st.sb.from('urgencias').insert({ numero: R.soDigitos(l.n), responsavel: para, origem: 'envio', remetente: st.pessoa, motivo: motivo || null, item: itemDe(l), criada_por: st.email });
        if (error && error.code !== '23505') throw error;
      } else {
        const { error } = await st.sb.from('devolucoes').insert({ item: itemDe(l), de: st.pessoa, para, motivo: motivo || null });
        if (error) throw error;
      }
      await concluirLinha(l);
      const antiga = ((st.notas[st.pessoa] || {})[R.soDigitos(l.n)] || {}).texto || '';
      const nova = `Devolvido para ${nomeDe(para)} em ${dataHoraBR(agora)}${motivo ? ' — ' + motivo : ''}`;
      let texto = antiga ? antiga + '\n' + nova : nova;
      if (texto.length > 2000) texto = texto.slice(-2000);
      await gravarNota(l.n, texto, st.pessoa);
      return;
    }
    const { error } = await st.sb.from('devolucoes').insert({ item: itemDe(l), de: st.pessoa, para, motivo: motivo || null });
    if (error) throw error;
    await gravarMarca(st.pessoa, l.chave, true, agora, l);
  }

  // ---------- janela de envio ----------
  function renderModal() {
    const m = $('#modal'), s = st.modal;
    if (!s) { m.innerHTML = ''; return; }
    const l = acharLinha(s.chave, s.pessoa);
    if (!l) { st.modal = null; m.innerHTML = ''; return; }
    const antes = document.activeElement && document.activeElement.id;
    m.innerHTML = `<div class="modal-fundo" data-acao="fechar-modal-fundo"><form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-titulo" data-form="enviar">
      <h2 id="modal-titulo">Enviar para outra pessoa</h2>
      <div class="corpo">
        <p>O processo <b class="mono">${esc(l.n)}</b> sairá da sua fila, como concluído, e entrará como <b>urgência</b> na fila da pessoa escolhida. Na sua anotação ficará registrado para quem foi enviado, com a data e a hora do envio. Se o processo veio errado para você, escolha <b>Gestor</b> e explique o que está errado.</p>
        <label class="campo"><span>Enviar para</span><select id="env-para" required>${opcoesPessoas(s.para, 'Escolha a pessoa', s.pessoa, { diretor: true, gestor: true })}</select></label>
        <label class="campo"><span>Motivo (opcional)</span><input type="text" id="env-motivo" maxlength="300" placeholder="Ex.: assunto da sua área, pedido do juiz; para o gestor, explique o que está errado" value="${esc(s.motivo)}"></label>
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
  async function aoClicarFila(ev, modoEv) {
    const alvo = ev.target.closest('[data-acao]');
    if (!alvo) return;
    const acao = alvo.dataset.acao;
    if (acao === 'sair-ver-como') { sairVerComo(); return; }
    if (acao === 'topo') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (acao === 'ir') {
      const sec = document.getElementById('grupo-' + (modoEv || st.aba) + '-' + alvo.dataset.tipo);
      if (sec) { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); sec.focus({ preventScroll: true }); }
      else toast('Nenhum processo nessa lista.');
      return;
    }
    const modo = modoEv || st.aba;
    if (st.verComo && modo !== 'gestor' && ['concluir', 'desfazer', 'devolver', 'enviar', 'anotar', 'apagar-nota', 'du-abrir'].includes(acao)) { toast('Visualização somente leitura.'); return; }
    const f = st.vis[modo];
    const li = alvo.closest('.linha');
    const chave = li && li.dataset.chave;
    const linha = (modo === 'fila' || modo === 'gestor') && chave ? acharLinha(chave, donoDe(modo)) : null;
    try {
      if (acao === 'du-abrir') {
        st.duAberta = !st.duAberta; render();
        if (st.duAberta) { const n = $('#du-numero'); if (n) n.focus(); }
      } else if (acao === 'gestor-ocultar') {
        st.gOculta = !st.gOculta;
        if (st.gOculta) st.gBase = filaDe(GESTOR_ID).filter(l => l.tipo === 'urgente' && !l.concluido).length;
        render();
      } else if (acao === 'copiar') {
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
        st.modal = { chave: linha.chave, pessoa: donoDe(modo), para: '', motivo: '', enviando: false }; st.anotando = null; st.devolvendo = null; render();
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
        const base = aplicarVisao(modo, modo === 'geral' ? linhasGeral(f.pessoa) : filaDe(pessoaAtiva())).filter(l => !f.etiqueta || (l[etConfig(modo).campo] || []).includes(f.etiqueta));
        const linhas = base.filter(l => f.concl || !l.concluido);
        const hoje = new Date().toISOString().slice(0, 10);
        baixar(`fila-${modo === 'geral' ? 'geral' : pessoaAtiva()}-${hoje}.csv`, R.paraCsv(linhas, nomes(), modo === 'geral'));
      }
    } catch (e) { falha(e); }
  }

  async function aoEnviarFormFila(ev, modo) {
    ev.preventDefault();
    if (st.verComo && modo !== 'gestor') return;
    if (ev.target.dataset.form === 'urgencia-diretor') { await incluirUrgenciaDiretor(); return; }
    const tipo = ev.target.dataset.form;
    try {
      if (tipo === 'anotar') {
        const linha = acharLinha(st.anotando, donoDe(modo)); if (!linha) return;
        await gravarNota(linha.n, $('#nota-texto').value.trim(), st.pessoa);
        st.anotando = null; st.notaRascunho = ''; toast('Anotação salva.'); render();
      } else if (tipo === 'devolver') {
        const linha = acharLinha(st.devolvendo, donoDe(modo)); if (!linha) return;
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
    const s = st.modal; if (!s || s.enviando) return;
    if (st.verComo && s.pessoa !== st.pessoa) return;
    const l = acharLinha(s.chave, s.pessoa); if (!l) { st.modal = null; render(); return; }
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
    // Menu de áreas (logo): abre e fecha com clique, Esc ou clique fora; setas movem o foco entre as opções.
    $('#btn-areas').addEventListener('click', () => {
      st.menuAreas = !st.menuAreas; renderMenuAreas(st.estado === 'ok');
      if (st.menuAreas) { const c = $('#menu-areas [aria-checked="true"]') || $('#menu-areas .item-area'); if (c) c.focus(); }
    });
    $('#menu-areas').addEventListener('click', e => {
      const b = e.target.closest('[data-area]'); if (b) { irParaArea(b.dataset.area); $('#btn-areas').focus(); }
    });
    $('#menu-areas').addEventListener('keydown', e => {
      const itens = [...document.querySelectorAll('#menu-areas .item-area')];
      const i = itens.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); itens[(i + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length].focus(); }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && st.menuAreas) { st.menuAreas = false; renderMenuAreas(st.estado === 'ok'); $('#btn-areas').focus(); }
    });
    document.addEventListener('click', e => {
      if (st.menuAreas && !e.target.closest('.marca')) { st.menuAreas = false; renderMenuAreas(st.estado === 'ok'); }
    });
    $('#avisos').addEventListener('click', e => {
      if (e.target.closest('[data-acao="sair-ver-como"]')) sairVerComo();
      else if (e.target.closest('[data-acao="abrir-avisos"]')) { st.aba = 'gestao'; guardar('fila.aba.' + st.email, st.aba); render(); window.scrollTo({ top: 0 }); }
    });
    $('#ver-como').addEventListener('change', e => {
      st.anotando = null; st.devolvendo = null; st.modal = null;
      if (e.target.value) { st.verComo = e.target.value; st.aba = 'fila'; render(); } else sairVerComo();
    });
    $('#abas').addEventListener('click', e => {
      const b = e.target.closest('.aba'); if (!b) return;
      if (st.area === 'metas') { st.abaMetas = b.dataset.aba; render(); return; }
      st.aba = b.dataset.aba; guardar('fila.aba.' + st.email, st.aba);
      st.anotando = null; st.devolvendo = null; render();
    });
    $('#v-estado').addEventListener('click', e => {
      const a = e.target.closest('[data-acao]'); if (!a) return;
      if (a.dataset.acao === 'entrar') entrar();
      else if (a.dataset.acao === 'sair') sair();
      else if (a.dataset.acao === 'tentar') iniciarSessao();
    });
    for (const [modo, raiz, dentro] of [['fila', '#v-fila', null], ['geral', '#v-geral', null], ['gestor', '#v-gestao', '#gestor-fila']]) {
      const v = $(raiz);
      const meu = e => !dentro || !!e.target.closest(dentro);
      v.addEventListener('click', e => { if (meu(e)) aoClicarFila(e, modo); });
      v.addEventListener('submit', e => { if (meu(e)) aoEnviarFormFila(e, modo); });
      let t = null;
      v.addEventListener('input', e => {
        if (!meu(e) && !(modo === 'fila')) return;
        if (e.target.id === 'dev-motivo') st.devMotivo = e.target.value;
        if (e.target.id === 'nota-texto') st.notaRascunho = e.target.value;
        if (e.target.id === 'du-numero') { st.novaUrgDir.numero = e.target.value; sugerirDu(); const r = $('#du-resp'); if (r) r.value = st.novaUrgDir.responsavel || ''; }
        if (e.target.id === 'du-motivo') st.novaUrgDir.motivo = e.target.value;
        if (e.target.id === 'busca' && meu(e)) { clearTimeout(t); t = setTimeout(() => { const f = st.vis[modo]; f.busca = e.target.value; f.limite = LIMITE_NORMAL; render(); }, 180); }
      });
      v.addEventListener('change', e => {
        if (modo === 'fila') {
          if (e.target.id === 'du-setor') { st.novaUrgDir.setor = e.target.value; st.novaUrgDir.responsavel = ''; sugerirDu(); render(); return; }
          if (e.target.id === 'du-resp') { st.novaUrgDir.responsavel = e.target.value; return; }
        }
        if (!meu(e)) return;
        const f = st.vis[modo];
        if (e.target.id === 'filtro-tarefa') { f.tarefa = e.target.value; render(); }
        if (e.target.id === 'filtro-etiqueta') { f.etiqueta = e.target.value; f.limite = LIMITE_NORMAL; render(); }
        if (e.target.id === 'filtro-visao') { f.visao = e.target.value; f.tarefa = ''; f.etiqueta = ''; f.limite = LIMITE_NORMAL; render(); }
        if (e.target.id === 'filtro-pessoa') { f.pessoa = e.target.value; f.visao = ''; f.tarefa = ''; f.etiqueta = ''; f.limite = LIMITE_NORMAL; render(); }
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
    ligarEventos();
    if (!window.supabase || !CFG) { st.estado = 'erro'; st.erro = 'Não foi possível carregar os componentes da página.'; render(); return; }
    st.sb = window.supabase.createClient(CFG.url, CFG.chave, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
    st.sb.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT' && st.estado === 'ok') setTimeout(() => { reiniciarEstado(); st.estado = 'login'; render(); }, 0);
    });
    Object.assign(window.PAINEL, { render, toast, esc, ms, iso, dataBR, dataHoraBR, falha, todas, carregar, atualizar, baixar, pessoas, nomes, nomeDe, tipoDe, opcoesPessoas, opcoesTipo, filaDe, guardar, ler, htmlGestorFila, ehEspecial, PERFIS_METAS });
    iniciarSessao();
  }
  iniciar();
})();
