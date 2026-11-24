-- Visitante passa a ler o que o servidor lê nas filas (só leitura; quem grava continua sendo só o gestor):
-- Metas CNJ (metas_envios, metas_pendentes), tarefas fora das filas (fora_vara: Metas → Pendentes e Processos Parados),
-- RPV/precatório nos processos de Pagamentos (jd_requisicoes, pje1_requisicoes) e o texto das minutas (minutas_residente).
-- No código: PERFIS_METAS e PERFIS_PARADOS (app.js), PERFIS_MINUTAS (minutas-ui.js).
-- Cada política repete a condição que já tinha, só acrescentando 'visitante'. Sem tabela nova e sem GRANT novo
-- (o authenticated já tem select nessas tabelas). Já aplicado no banco (migração visitante_leitura). Sem nomes de pessoas.

alter policy metas_envios_le on public.metas_envios
  using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual','visitante']::perfil_acesso[]));

alter policy metas_pend_le on public.metas_pendentes
  using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual','visitante']::perfil_acesso[]));

alter policy fora_vara_le on public.fora_vara
  using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual','visitante']::perfil_acesso[]));

alter policy jd_requisicoes_le on public.jd_requisicoes
  using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual','visitante']::perfil_acesso[]));

alter policy pje1_requisicoes_le on public.pje1_requisicoes
  using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual','visitante']::perfil_acesso[]));

alter policy minutas_le on public.minutas_residente
  using ((select app.perfil_atual()) = any (array['gestor','servidor','estagiario','residente','visitante']::perfil_acesso[]));

-- ============ Para desfazer ============
-- alter policy metas_envios_le on public.metas_envios
--   using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual']::perfil_acesso[]));
-- alter policy metas_pend_le on public.metas_pendentes
--   using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual']::perfil_acesso[]));
-- alter policy fora_vara_le on public.fora_vara
--   using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual']::perfil_acesso[]));
-- alter policy jd_requisicoes_le on public.jd_requisicoes
--   using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual']::perfil_acesso[]));
-- alter policy pje1_requisicoes_le on public.pje1_requisicoes
--   using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual']::perfil_acesso[]));
-- alter policy minutas_le on public.minutas_residente
--   using ((select app.perfil_atual()) = any (array['gestor','servidor','estagiario','residente']::perfil_acesso[]));
