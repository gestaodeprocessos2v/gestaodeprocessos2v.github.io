# Fila de Trabalho · Gestão de Processos (2ª Vara Federal)

Painel da fila de trabalho da 2ª Vara Federal da Paraíba. Página estática (GitHub Pages) com login Google e banco no Supabase.

- Este repositório contém apenas o código da página. Não há dados de processos, nomes nem e-mails aqui.
- Os dados ficam no Supabase e só são lidos por e-mails cadastrados pelo gestor (regras de acesso no banco).
- `config.js` traz só a URL do projeto e a chave pública (publishable), que foi feita para ficar no navegador. Nunca coloque chaves secretas neste repositório.

Arquivos: `index.html`, `estilo.css`, `regras.js` (leitura do CSV e distribuição), `app.js` (login, fila, geral), `gestao.js` (aba Gestão).
