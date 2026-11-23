-- Minutas: leitura para todos os perfis que têm fila (Gestor, Servidor, Estagiário e Residente).
-- Os processos da minuta podem estar em outros setores; quem controla o que é enviado é o Gestor (planilha do painel).
-- Escrita continua só do Gestor (políticas minutas_ins/upd/del), gatilhos e cron de 90 dias não mudam.
-- Servidor eventual, Diretor, Magistrado(a) e Visitante continuam sem leitura (o eventual não tem o botão na fila).
-- Já aplicado no banco quando constar aqui a migração "minutas_leitura_todos"; este arquivo é o registro.

drop policy if exists minutas_le on public.minutas_residente;
create policy minutas_le on public.minutas_residente for select to authenticated using (
  (select app.perfil_atual()) = any (array['gestor','servidor','estagiario','residente']::perfil_acesso[])
);

-- Reversão:
-- drop policy minutas_le on public.minutas_residente;
-- create policy minutas_le on public.minutas_residente for select to authenticated using (
--   (select app.perfil_atual()) = any (array['gestor','residente']::perfil_acesso[]));
