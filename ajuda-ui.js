/* Fila de Trabalho da Vara — área "Ajuda" (todos os perfis).
   Guias passo a passo convertidos dos .docx da vara, gravados na tabela ajuda_guias (só leitura pela tela; entram pela ferramenta de SQL).
   O índice carrega título, categoria e palavras-chave; o conteúdo de cada guia (html com as imagens embutidas) é buscado ao abrir.
   Tela: menu à esquerda (categorias que abrem e mostram os guias) e, ao lado, o guia aberto ou o início com a busca e os assuntos. */
(function () {
  'use strict';
  const P = window.PAINEL;
  if (!P || !P.render) return;
  const { st, esc } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const vazio = (titulo, p) => `<div class="vazio"><h2>${esc(titulo)}</h2><p>${p}</p></div>`;
  // Cor de cada categoria, na ordem em que aparecem: a mesma bolinha no menu, nos assuntos e nos resultados.
  const CORES = ['--prod-1', '--prod-3', '--prod-2', '--prod-6', '--prod-0', '--prod-7', '--prod-4'];
  const COR_MISTA = '--prod-5'; // assunto com guias de mais de uma categoria

  // ---------- estado ----------
  const A = () => st.ajuda || (st.ajuda = { lista: [], carregado: false, carregando: false, erro: false, busca: '', palavra: null, abertas: new Set(), aberto: null, guias: {}, erroGuia: null });

  // ---------- carga ----------
  async function carregarLista() {
    const s = A();
    if (s.carregando) return;
    s.carregando = true; s.erro = false;
    const { data, error } = await st.sb.from('ajuda_guias').select('id,titulo,categoria,ordem,palavras').order('categoria').order('ordem').order('titulo');
    s.carregando = false;
    if (error) { console.error(error); s.erro = true; } else { s.lista = data || []; s.carregado = true; }
    render();
  }

  async function abrirGuia(id) {
    const s = A(), info = s.lista.find(g => g.id === id);
    s.aberto = id; s.erroGuia = null;
    if (info) s.abertas.add(info.categoria); // o menu mostra onde se está
    const lay = $('#v-ajuda .aj-layout'); if (lay) lay.classList.remove('menu-cel');
    window.scrollTo({ top: 0 }); render();
    if (s.guias[id]) return;
    const { data, error } = await st.sb.from('ajuda_guias').select('html,atualizado_em').eq('id', id).maybeSingle();
    if (error || !data) { console.error(error); s.erroGuia = id; render(); return; }
    s.guias[id] = { html: limpar(data.html), em: data.atualizado_em };
    render();
  }

  // O html vem só da conversão feita fora da tela, mas passa por uma lista de tags e atributos permitidos antes de ir para a página.
  // Links (A) só https, sempre em nova aba. CODE marca texto copiável (realce amarelo no Word): vira botão "clique para copiar".
  const TAGS = new Set(['H2', 'H3', 'P', 'OL', 'UL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'BR', 'IMG', 'FIGURE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'CODE']);
  const ATRIBUTOS = { OL: ['type', 'start'], IMG: ['src', 'alt', 'width', 'height'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'], A: ['href'] };
  function limpar(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const raiz = doc.body.firstElementChild;
    (function passar(no) {
      for (const f of [...no.children]) {
        if (!TAGS.has(f.tagName)) { f.replaceWith(...f.childNodes); passar(no); return; }
        const ok = ATRIBUTOS[f.tagName] || [];
        for (const at of [...f.attributes]) if (!ok.includes(at.name)) f.removeAttribute(at.name);
        if (f.tagName === 'IMG' && !/^data:image\/(png|jpeg|gif|webp);base64,/.test(f.getAttribute('src') || '')) { f.remove(); continue; }
        if (f.tagName === 'A' && !/^https:\/\//i.test(f.getAttribute('href') || '')) { f.replaceWith(...f.childNodes); passar(no); return; }
        passar(f);
      }
    })(raiz);
    for (const img of raiz.querySelectorAll('img')) { img.loading = 'lazy'; img.decoding = 'async'; }
    for (const a of raiz.querySelectorAll('a')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    for (const c of raiz.querySelectorAll('code')) {
      const b = doc.createElement('button'), p = c.parentElement;
      const bloco = p && p.tagName === 'P' && p.textContent.trim() === c.textContent.trim();
      b.type = 'button'; b.className = bloco ? 'aj-copiar bloco' : 'aj-copiar';
      b.dataset.aacao = 'copiar'; b.dataset.balao = 'Clique para copiar'; b.setAttribute('aria-description', 'Clique para copiar');
      const t = doc.createElement('span'); t.append(...c.childNodes);
      b.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5V3a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>';
      b.prepend(t); c.replaceWith(b);
    }
    return raiz.innerHTML;
  }

  // ---------- dados da tela ----------
  // Categorias na ordem da lista, cada uma com a sua cor e os seus guias.
  function categorias() {
    const cats = [];
    for (const g of A().lista) { let c = cats.find(x => x.nome === g.categoria); if (!c) cats.push(c = { nome: g.categoria, cor: CORES[cats.length % CORES.length], itens: [] }); c.itens.push(g); }
    return cats;
  }
  const corDe = (cats, nome) => (cats.find(c => c.nome === nome) || {}).cor || COR_MISTA;
  // Assuntos: as palavras-chave de todos os guias, sem repetir (acentos e maiúsculas não contam), em ordem alfabética.
  function assuntos(cats) {
    const mapa = new Map();
    for (const g of A().lista) for (const p of g.palavras || []) {
      const k = norm(p).trim(); if (!k) continue;
      const a = mapa.get(k) || mapa.set(k, { k, nome: p.trim(), guias: [] }).get(k);
      if (!a.guias.includes(g)) a.guias.push(g);
    }
    return [...mapa.values()].map(a => {
      const cs = [...new Set(a.guias.map(g => g.categoria))];
      return { ...a, cor: cs.length === 1 ? corDe(cats, cs[0]) : COR_MISTA, cats: cs };
    }).sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  }
  const plural = (n, um, varios) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;

  // ---------- telas ----------
  const SETA = '<svg class="aj-seta" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';

  function menu(cats) {
    const s = A();
    return `<nav class="aj-menu" aria-label="Guias da Ajuda">
      <button class="aj-item aj-inicio" type="button" data-aacao="inicio"${s.aberto ? '' : ' aria-current="page"'}>Início</button>
      ${cats.map(c => `<details class="aj-grupo" data-cat="${esc(c.nome)}"${s.abertas.has(c.nome) ? ' open' : ''}>
        <summary>${SETA}<i style="--c:var(${c.cor})"></i><span>${esc(c.nome)}</span><span class="aj-qtd">${c.itens.length}</span></summary>
        <ul>${c.itens.map(g => `<li><button class="aj-item" type="button" data-aacao="abrir" data-id="${esc(g.id)}"${g.id === s.aberto ? ' aria-current="page"' : ''}>${esc(g.titulo)}</button></li>`).join('')}</ul>
      </details>`).join('')}
    </nav>`;
  }

  function inicio(cats) {
    const s = A(), lista = assuntos(cats);
    const chips = lista.map(a => `<button type="button" class="prod-chip" aria-pressed="${s.palavra === a.k}" data-aacao="palavra" data-v="${esc(a.k)}" style="--c:var(${a.cor})" data-balao="${esc(`${plural(a.guias.length, 'guia', 'guias')} em ${a.cats.join(', ')}`)}"><i></i>${esc(a.nome)}</button>`).join('');
    return `<div class="aj-boas">
        <h2>Como podemos ajudar?</h2>
        <p>Escolha um guia no menu, busque pelo título ou toque num assunto abaixo.</p>
        <div class="em-barra"><input type="search" id="aj-busca" placeholder="Buscar guia pelo título ou assunto" value="${esc(s.busca)}" aria-label="Buscar guia pelo título ou assunto"></div>
      </div>
      ${lista.length ? `<div class="prod-chips aj-assuntos"><div class="prod-chips-bloco"><span class="prod-chips-rot" id="aj-rot-assuntos">Assuntos</span><div class="prod-chips-lista" role="group" aria-labelledby="aj-rot-assuntos">${chips}</div></div></div>` : ''}
      <div id="aj-res" aria-live="polite"></div>`;
  }

  // Resultados da busca ou do assunto ligado, logo abaixo dos assuntos. Redesenha só esta parte (a busca mantém o foco).
  function resultados() {
    const caixa = $('#aj-res'); if (!caixa) return;
    const s = A(), cats = categorias(), q = norm(s.busca).trim();
    let achados = null, rotulo = '';
    if (s.palavra) {
      const a = assuntos(cats).find(x => x.k === s.palavra);
      achados = a ? a.guias : []; rotulo = a ? `Guias sobre “${esc(a.nome)}”` : '';
    } else if (q) {
      achados = s.lista.filter(g => norm([g.titulo, g.categoria, ...(g.palavras || [])].join(' ')).includes(q));
      rotulo = `Resultado da busca`;
    }
    if (!achados) { caixa.innerHTML = ''; return; }
    caixa.innerHTML = !achados.length ? '<p class="atualizacao">Nenhum guia encontrado.</p>'
      : `<h3 class="aj-res-rot">${rotulo} (${achados.length})</h3><ul class="aj-res">${achados.map(g => `<li><button type="button" class="aj-res-item" data-aacao="abrir" data-id="${esc(g.id)}">
          <span class="aj-res-cat"><i style="--c:var(${corDe(cats, g.categoria)})"></i>${esc(g.categoria)}</span>
          <span class="aj-res-tit">${esc(g.titulo)}</span>
          <span class="aj-res-ir">Abrir guia${SETA}</span>
        </button></li>`).join('')}</ul>`;
  }

  function guia(cats) {
    const s = A(), id = s.aberto, info = s.lista.find(g => g.id === id) || { titulo: 'Guia', categoria: '' }, g = s.guias[id];
    const corpo = g ? `<div class="guia">${g.html}</div>`
      : s.erroGuia === id ? '<div class="aviso erro">Não foi possível abrir este guia agora. Tente de novo em instantes.</div>'
      : '<p class="atualizacao">Carregando…</p>';
    return `<article class="aj-guia">
        <p class="aj-cat-nome"><i style="--c:var(${corDe(cats, info.categoria)})"></i>${esc(info.categoria)}</p>
        <h2 class="aj-titulo">${esc(info.titulo)}</h2>
        ${corpo}
        ${g && g.em ? `<p class="atualizacao">Atualizado em ${esc(P.dataBR(Date.parse(g.em)))}.</p>` : ''}
      </article>`;
  }

  function tela() {
    const s = A(), cats = categorias();
    if (!s.lista.length) return vazio('Ajuda', 'Ainda não há guias cadastrados.');
    const atual = s.aberto ? (s.lista.find(g => g.id === s.aberto) || {}).titulo : '';
    return `<div class="aj-layout">
        <div class="aj-barra-cel"><button class="btn" type="button" data-aacao="menu" aria-expanded="false"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14"/></svg>Guias</button>${atual ? `<span>${esc(atual)}</span>` : ''}</div>
        ${menu(cats)}
        <div class="aj-conteudo">${s.aberto ? guia(cats) : inicio(cats)}</div>
      </div>`;
  }

  P.renderAjuda = function () {
    const v = $('#v-ajuda'), s = A();
    if (!s.carregado && (!s.erro || !v.innerHTML)) carregarLista(); // com erro, tenta de novo ao voltar à área
    // Chave da tela: a atualização automática do painel não redesenha a área (as imagens dos guias são grandes).
    const chave = !s.carregado ? (s.erro ? 'erro' : 'carregando') : s.aberto ? `guia|${s.aberto}|${s.guias[s.aberto] ? 1 : 0}|${s.erroGuia === s.aberto ? 1 : 0}|${s.lista.length}` : `inicio|${s.lista.length}`;
    if (v.dataset.h === chave && v.innerHTML) return;
    v.dataset.h = chave;
    v.innerHTML = s.erro && !s.carregado ? '<div class="aviso erro">Não foi possível carregar a Ajuda agora. Tente de novo em instantes.</div>'
      : !s.carregado ? vazio('Ajuda', 'Carregando…')
      : tela();
    if (!s.aberto && s.carregado) resultados();
  };

  // ---------- ações ----------
  const v = $('#v-ajuda');
  v.addEventListener('click', e => {
    const a = e.target.closest('[data-aacao]'); if (!a) return;
    const s = A(), acao = a.dataset.aacao;
    if (acao === 'abrir') abrirGuia(a.dataset.id);
    else if (acao === 'inicio') { s.aberto = null; v.querySelector('.aj-layout')?.classList.remove('menu-cel'); render(); }
    else if (acao === 'menu') { const lay = a.closest('.aj-layout'); a.setAttribute('aria-expanded', lay.classList.toggle('menu-cel')); }
    else if (acao === 'palavra') {
      s.palavra = s.palavra === a.dataset.v ? null : a.dataset.v;
      if (s.palavra && s.busca) { s.busca = ''; const b = $('#aj-busca'); if (b) b.value = ''; }
      for (const c of v.querySelectorAll('[data-aacao="palavra"]')) c.setAttribute('aria-pressed', c.dataset.v === s.palavra);
      resultados();
    }
    else if (acao === 'copiar') copiar(a);
  });
  // Abrir e fechar uma categoria no menu não redesenha a tela; o estado fica guardado para quando ela for redesenhada.
  v.addEventListener('toggle', e => {
    const d = e.target; if (!d.matches || !d.matches('details[data-cat]')) return;
    const s = A(); if (d.open) s.abertas.add(d.dataset.cat); else s.abertas.delete(d.dataset.cat);
  }, true);
  async function copiar(b) {
    const texto = b.querySelector('span').innerText.trim();
    const ok = () => P.toast(texto.length > 60 ? 'Texto copiado.' : 'Copiado: ' + texto);
    try { await navigator.clipboard.writeText(texto); ok(); return; } catch (e) { console.warn('clipboard', e); }
    // Alternativa para navegadores que bloqueiam a API da área de transferência.
    const ta = document.createElement('textarea');
    ta.value = texto; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(ta); ta.select();
    const deu = document.execCommand('copy'); ta.remove(); b.focus();
    if (deu) ok(); else P.toast('Não foi possível copiar. Selecione o texto e use Ctrl+C.');
  }
  v.addEventListener('input', e => {
    if (e.target.id !== 'aj-busca') return;
    const s = A(); s.busca = e.target.value;
    if (s.busca && s.palavra) { s.palavra = null; for (const c of v.querySelectorAll('[data-aacao="palavra"]')) c.setAttribute('aria-pressed', 'false'); }
    resultados();
  });
})();
