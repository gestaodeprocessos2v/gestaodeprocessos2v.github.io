# Fila de Trabalho · Gestão de Processos (2ª Vara Federal)

Painel da fila de trabalho da 2ª Vara Federal da Paraíba. Página estática (GitHub Pages) com login Google e banco no Supabase.

- Este repositório contém apenas o código da página. Não há dados de processos, nomes nem e-mails aqui.
- Os dados ficam no Supabase e só são lidos por e-mails cadastrados pelo gestor (regras de acesso no banco, RLS).
- `config.js` traz só a URL do projeto e a chave pública (publishable), que foi feita para ficar no navegador. Nunca coloque chaves secretas neste repositório.

## O que o painel faz

- Distribui os processos do PJe+R (CSV) entre servidores, estagiários e residentes, por setor, dígito do número e exceções de classe ou etiqueta.
- Abas **Fila** (fila própria), **Geral** (todas as filas) e **Gestão** (só o gestor).
- Fila própria do **Diretor de Secretaria** (por etiquetas, só urgências e fila por antiguidade) e do **Gestor** (por etiqueta, no topo da Gestão), em paralelo às dos servidores.
- Ordem de trabalho: urgentes, devolvidos, prioritárias e demais, por antiguidade na tarefa.
- Conclusão com desfazer, anotações, devolução (estagiários, residentes e diretor), envio para outra pessoa (inclusive ao Gestor, que recebe como urgência).
- Processo com anotação e não concluído não some ao importar um CSV novo: fica na fila de quem anotou, no topo da seção, com a marca "Saiu da lista", até ser concluído ou a anotação ser excluída.
- Visões por pessoa e filtro por etiqueta (Pagamentos), configurados na Gestão.

## Arquivos

- `index.html`: estrutura da página e política de segurança de conteúdo.
- `estilo.css`: identidade visual do painel.
- `regras.js`: leitura do CSV, distribuição, montagem e ordem da fila.
- `app.js`: login, carregamento dos dados, abas Fila e Geral, conclusão, anotação, devolução, envio, visões, filtro de etiqueta e avisos.
- `gestao.js`: aba Gestão (importação, urgências, resumo, avisos dos servidores, acessos negados, limpeza, tarefas do PJe e configuração).
- `config.js`: URL do projeto e chave pública.
