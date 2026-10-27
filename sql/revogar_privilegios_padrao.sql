-- Tabelas novas criadas pelo papel postgres em public deixam de receber, por padrão,
-- TRUNCATE, REFERENCES, TRIGGER e MAINTAIN para anon, authenticated e service_role.
-- Vale só para tabelas futuras; cada migração concede o que o painel usa (ver CLAUDE.md).
-- Aplicada em 26/10/2026.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables
  from anon, authenticated, service_role;
