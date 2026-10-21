-- Magistrado titular ou substituta: o gestor marca, para cada acesso de perfil Magistrado(a), se é Titular ('T')
-- ou Substituta ('S'). Só define o padrão do filtro de magistrado da aba Pendentes das Metas CNJ (quem entra como
-- titular abre só com o botão Titular ligado, e a substituta, só com o botão Substituta). Não é regra de segurança.
-- Já aplicado no banco (migração acesso_magistrado_tipo, 21/10/2026). Tinha de vir ANTES de publicar o código:
-- a página lê esta coluna ao entrar. Sem nomes de pessoas.

alter table public.acesso add column if not exists magistrado text
  check (magistrado in ('T', 'S'));

-- a letra só existe em acesso de perfil magistrado
alter table public.acesso add constraint acesso_magistrado_ck
  check (magistrado is null or perfil = 'magistrado');

-- Nada muda nas políticas: o próprio usuário já lê a sua linha (acesso_le), só o gestor grava (acesso_gestor_ins/upd).

-- ============ Para desfazer ============
-- alter table public.acesso drop constraint acesso_magistrado_ck;
-- alter table public.acesso drop column magistrado;
