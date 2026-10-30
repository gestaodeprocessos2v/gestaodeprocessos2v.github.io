/* Fila de Trabalho da Vara — área "Ajuda" (todos os perfis).
   Guias passo a passo convertidos dos .docx da vara, gravados na tabela ajuda_guias (só leitura pela tela; entram pela ferramenta de SQL).
   O índice carrega só título e categoria; o conteúdo de cada guia (html com as imagens embutidas) é buscado ao abrir. */
(function () {
  'use strict';
  const P = window.PAINEL;
  if (!P || !P.render) return;
  const { st, esc } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const vazio = (titulo, p) => `<div class="vazio"><h2>${esc(titulo)}</h2><p>${p}</p></div>`;

  // ---------- estado ----------
  const A = () => st.ajuda || (st.ajuda = { lista: [], carregado: false, carregando: false, erro: false, busca: '', aberto: null, guias: {}, erroGuia: null });

  // ---------- carga ----------
  async function carregarLista() {
    const s = A();
    if (s.carregando) return;
    s.carregando = true; s.erro = false;
    const { data, error } = await st.sb.from('ajuda_guias').select('id,titulo,categoria,ordem').order('categoria').order('ordem').order('titulo');
    s.carregando = false;
    if (error) { console.error(error); s.erro = true; } else { s.lista = data || []; s.carregado = true; }
    render();
  }

  async function abrirGuia(id) {
    const s = A();
    s.aberto = id; s.erroGuia = null; window.scrollTo({ top: 0 }); render();
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

  // ---------- telas ----------
  function indice() {
    const s = A();
    if (!s.lista.length) return vazio('Ajuda', 'Ainda não há guias cadastrados.');
    const cats = [];
    for (const g of s.lista) { let c = cats.find(x => x.nome === g.categoria); if (!c) cats.push(c = { nome: g.categoria, itens: [] }); c.itens.push(g); }
    return `<div class="em-barra"><input type="search" id="aj-busca" placeholder="Buscar guia pelo título" value="${esc(s.busca)}" aria-label="Buscar guia pelo título"></div>
      <p class="atualizacao" id="aj-nada" hidden>Nenhum guia com esse título.</p>
      <div class="aj-indice">${cats.map(c => `<section class="aj-cat" data-cat>
        <h2>${esc(c.nome)}</h2>
        <ul>${c.itens.map(g => `<li data-busca="${esc(norm(g.titulo + ' ' + g.categoria))}"><button class="aj-link" type="button" data-aacao="abrir" data-id="${esc(g.id)}">${esc(g.titulo)}</button></li>`).join('')}</ul>
      </section>`).join('')}</div>`;
  }

  function guia() {
    const s = A(), id = s.aberto, info = s.lista.find(g => g.id === id) || { titulo: 'Guia', categoria: '' }, g = s.guias[id];
    const corpo = g ? `<div class="guia">${g.html}</div>`
      : s.erroGuia === id ? '<div class="aviso erro">Não foi possível abrir este guia agora. Tente de novo em instantes.</div>'
      : '<p class="atualizacao">Carregando…</p>';
    return `<div class="aj-topo"><button class="btn aj-voltar" type="button" data-aacao="voltar"><svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 10H4M9.5 4.5 4 10l5.5 5.5"/></svg>Todos os guias</button></div>
      <article class="aj-guia">
        <p class="aj-cat-nome">${esc(info.categoria)}</p>
        <h2 class="aj-titulo">${esc(info.titulo)}</h2>
        ${corpo}
        ${g && g.em ? `<p class="atualizacao">Atualizado em ${esc(P.dataBR(Date.parse(g.em)))}.</p>` : ''}
      </article>`;
  }

  // Filtra o índice sem redesenhar a área (o campo de busca mantém o foco).
  function filtrar() {
    const s = A(), q = norm(s.busca).trim();
    let algum = false;
    for (const sec of document.querySelectorAll('#v-ajuda [data-cat]')) {
      let n = 0;
      for (const li of sec.querySelectorAll('li')) { const ver = !q || li.dataset.busca.includes(q); li.hidden = !ver; if (ver) n++; }
      sec.hidden = !n; if (n) algum = true;
    }
    const nada = $('#aj-nada'); if (nada) nada.hidden = algum;
  }

  P.renderAjuda = function () {
    const v = $('#v-ajuda'), s = A();
    if (!s.carregado && (!s.erro || !v.innerHTML)) carregarLista(); // com erro, tenta de novo ao voltar à área
    // Chave da tela: a atualização automática do painel não redesenha a área (as imagens dos guias são grandes).
    const chave = !s.carregado ? (s.erro ? 'erro' : 'carregando') : s.aberto ? `guia|${s.aberto}|${s.guias[s.aberto] ? 1 : 0}|${s.erroGuia === s.aberto ? 1 : 0}` : `indice|${s.lista.length}`;
    if (v.dataset.h === chave && v.innerHTML) return;
    v.dataset.h = chave;
    v.innerHTML = s.erro && !s.carregado ? '<div class="aviso erro">Não foi possível carregar a Ajuda agora. Tente de novo em instantes.</div>'
      : !s.carregado ? vazio('Ajuda', 'Carregando…')
      : s.aberto ? guia() : indice();
    if (!s.aberto && s.carregado) filtrar();
  };

  // ---------- ações ----------
  const v = $('#v-ajuda');
  v.addEventListener('click', e => {
    const a = e.target.closest('[data-aacao]'); if (!a) return;
    if (a.dataset.aacao === 'abrir') abrirGuia(a.dataset.id);
    else if (a.dataset.aacao === 'voltar') { A().aberto = null; render(); }
    else if (a.dataset.aacao === 'copiar') copiar(a);
  });
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
  v.addEventListener('input', e => { if (e.target.id === 'aj-busca') { A().busca = e.target.value; filtrar(); } });
})();
