/* Tema da página: Automático (segue o sistema), Claro ou Escuro. A escolha fica só neste navegador (localStorage).
   Carregado no <head>, antes do CSS desenhar a página, para não piscar o tema errado. As cores de cada tema estão em estilo.css
   (variáveis em :root, em @media (prefers-color-scheme: dark) e em :root[data-theme="dark"|"light"]). */
(function () {
  'use strict';
  const CHAVE = 'tema';
  const TEMAS = [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']];
  const valido = t => TEMAS.some(([v]) => v === t);

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

  function rotulo(botao) {
    const nome = TEMAS.find(([v]) => v === atual)[1];
    const proximo = TEMAS[(TEMAS.findIndex(([v]) => v === atual) + 1) % TEMAS.length][1];
    const dica = `Tema: ${nome}. Clique para mudar para ${proximo}.`;
    botao.textContent = nome;
    botao.setAttribute('data-balao', dica);
    botao.setAttribute('aria-label', dica);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const botao = document.getElementById('btn-tema');
    if (!botao) return;
    rotulo(botao);
    botao.addEventListener('click', () => {
      atual = TEMAS[(TEMAS.findIndex(([v]) => v === atual) + 1) % TEMAS.length][0];
      gravar(atual); aplicar(atual); rotulo(botao);
    });
  });
})();
