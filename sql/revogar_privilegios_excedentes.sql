-- Retira de anon e authenticated o que a API do painel não usa.
-- TRUNCATE ignora a RLS; TRIGGER e REFERENCES só servem para quem altera a estrutura.
-- Aplicada em 26/10/2026. Reversão: grant truncate, trigger, references on ... to ...
revoke truncate, trigger, references
  on all tables in schema public
  from anon, authenticated;
