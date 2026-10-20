-- Servidor eventual passa a ver a área Metas CNJ (no código: PERFIS_METAS em app.js) e o card do Jurisdição Delegada
-- (RPV/PRC) nos processos de Pagamentos, onde ele trabalha.
-- Só leitura: quem grava as metas e o JD continua sendo só o gestor.
-- Depende de sql/servidor_eventual.sql (o valor 'eventual' do enum perfil_acesso já existe no banco).
-- Já aplicado no banco (migração metas_jd_eventual). Sem nomes de pessoas.

alter policy metas_envios_le on public.metas_envios
  using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual']::perfil_acesso[]));

alter policy metas_pend_le on public.metas_pendentes
  using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual']::perfil_acesso[]));

alter policy fora_vara_le on public.fora_vara
  using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual']::perfil_acesso[]));

alter policy jd_requisicoes_le on public.jd_requisicoes
  using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor','eventual']::perfil_acesso[]));

-- ============ Para desfazer ============
-- alter policy metas_envios_le on public.metas_envios
--   using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor']::perfil_acesso[]));
-- alter policy metas_pend_le on public.metas_pendentes
--   using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor']::perfil_acesso[]));
-- alter policy fora_vara_le on public.fora_vara
--   using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor']::perfil_acesso[]));
-- alter policy jd_requisicoes_le on public.jd_requisicoes
--   using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor']::perfil_acesso[]));
