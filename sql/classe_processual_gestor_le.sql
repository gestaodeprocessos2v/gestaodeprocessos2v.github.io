-- O Gestor passa a ler a tabela classe_processual (código CNJ, nome por extenso e sigla do PJe+R). A aba Gestão usa a tabela
-- para converter a classe cadastrada em "Cadastrar prioridade ou urgência" (o Gestor digita sigla, código ou nome; o painel guarda
-- o nome por extenso e a sigla). Nenhum outro perfil lê a tabela, e ninguém grava por aqui (a carga é feita pelo SQL).
-- Depende de sql/classe_processual.sql. Já aplicado no banco (migrações classe_processual_gestor_le e classe_processual_grant_select,
-- 22/10/2026). Sem nomes de pessoas.
-- A tabela nasceu sem permissão para o papel authenticated; sem o grant a política não chega a ser avaliada.

grant select on public.classe_processual to authenticated;

create policy classe_processual_gestor_le on public.classe_processual
  for select to authenticated
  using ((select app.perfil_atual()) = any (array['gestor']::perfil_acesso[]));

-- ============ Para desfazer ============
-- drop policy classe_processual_gestor_le on public.classe_processual;
-- revoke select on public.classe_processual from authenticated;
