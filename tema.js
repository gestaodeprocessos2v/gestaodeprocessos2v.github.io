/* Aparência da página: Sistema (segue o sistema), Claro ou Escuro. A escolha fica só neste navegador (localStorage).
   A aplicação roda no <head>, antes do CSS desenhar a página, para não piscar o tema errado. O controle fica no menu do logo
   (index.html, .seg-tema, botões com data-tema="auto|light|dark"). As cores de cada tema estão em estilo.css
   (variáveis em :root, em @media (prefers-color-scheme: dark) e em :root[data-theme="dark"|"light"]). */
(function () {
  'use strict';
  const CHAVE = 'tema';
  const VALIDOS = ['auto', 'light', 'dark'];
  const valido = t => VALIDOS.includes(t);

  function ler() {
    try { const t = localStorage.getItem(CHAVE); return valido(t) ? t : 'auto'; } catch (e) { return 'auto'; }
  }
  function gravar(t) {
    try { if (t === 'auto') localStorage.removeItem(CHAVE); else localStorage.setItem(CHAVE, t); } catch (e) { /* sem armazenamento: vale só nesta visita */ }
  }
  function aplicar(t) {
    const r = document.documentElement;
    if (t === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t);
  }

  let atual = ler();
  aplicar(atual);

  function marcar() {
    for (const b of document.querySelectorAll('[data-tema]')) b.setAttribute('aria-checked', String(b.dataset.tema === atual));
  }

  document.addEventListener('DOMContentLoaded', () => {
    marcar();
    for (const b of document.querySelectorAll('[data-tema]')) {
      b.addEventListener('click', () => {
        if (!valido(b.dataset.tema)) return;
        atual = b.dataset.tema; gravar(atual); aplicar(atual); marcar();
      });
    }
  });

  // Outra aba mudou a aparência: acompanha.
  window.addEventListener('storage', e => {
    if (e.key !== CHAVE && e.key !== null) return;
    atual = ler(); aplicar(atual); marcar();
  });
})();
