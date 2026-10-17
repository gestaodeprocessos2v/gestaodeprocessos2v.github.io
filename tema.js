/* Aparência da página: Sistema (segue o sistema), Claro ou Escuro.
   A escolha é guardada em dois lugares: neste navegador (localStorage), para aplicar na hora, antes do CSS desenhar a página
   e sem piscar o tema errado; e na conta da pessoa (tabela `preferencias`, chave = e-mail), para acompanhá-la em qualquer
   aparelho. Depois do login, app.js chama TEMA.ligar(): o valor da conta vale sobre o do aparelho. Se a conta ainda não tem
   valor, sobe o que já estava neste aparelho. Falha na conta nunca atrapalha: o aparelho segue com o que tem.
   O controle fica no menu do logo (index.html, .seg-tema, botões com data-tema="auto|light|dark"). As cores de cada tema
   estão em estilo.css (variáveis em :root, em @media (prefers-color-scheme: dark) e em :root[data-theme="dark"|"light"]). */
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

  // ---- conta da pessoa (Supabase) ----
  let conta = null; // { sb, email } enquanto há alguém logado
  async function salvarNaConta(t) {
    if (!conta) return;
    try {
      const { error } = await conta.sb.from('preferencias').upsert({ email: conta.email, tema: t, atualizado_em: new Date().toISOString() }, { onConflict: 'email' });
      if (error) throw error;
    } catch (e) { console.warn('Não consegui guardar a aparência na conta.', e); }
  }
  async function ligar(sb, email) {
    conta = { sb, email };
    try {
      const { data, error } = await sb.from('preferencias').select('tema').eq('email', email).maybeSingle();
      if (error) throw error;
      if (conta && conta.email !== email) return;            // saiu ou trocou de pessoa enquanto lia
      if (data && valido(data.tema)) {
        if (data.tema !== atual) { atual = data.tema; gravar(atual); aplicar(atual); marcar(); }
      } else if (atual !== 'auto') {
        salvarNaConta(atual);                                // primeira vez com a conta: sobe a escolha deste aparelho
      }
    } catch (e) { console.warn('Não consegui ler a aparência da conta.', e); }
  }
  function desligar() { conta = null; }
  window.TEMA = { ligar, desligar };

  document.addEventListener('DOMContentLoaded', () => {
    marcar();
    for (const b of document.querySelectorAll('[data-tema]')) {
      b.addEventListener('click', () => {
        if (!valido(b.dataset.tema)) return;
        atual = b.dataset.tema; gravar(atual); aplicar(atual); marcar(); salvarNaConta(atual);
      });
    }
  });

  // Outra aba deste navegador mudou a aparência: acompanha.
  window.addEventListener('storage', e => {
    if (e.key !== CHAVE && e.key !== null) return;
    atual = ler(); aplicar(atual); marcar();
  });
})();
