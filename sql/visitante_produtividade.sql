-- Produtividade da Vara para um Visitante escolhido: o gestor marca, no cadastro de acesso, "Vê a Produtividade da Vara".
-- A pessoa continua Visitante em todo o resto; só ganha a leitura das tabelas da Produtividade.
-- Gestor, Diretor e Magistrado(a) continuam lendo pelo perfil, como antes. Gravar segue só com o gestor.
-- Aplicado no banco em 26/11/2026 (migração visitante_produtividade). Tinha de vir ANTES do código:
-- a página lê a coluna ao entrar. Sem nomes de pessoas.

alter table public.acesso add column if not exists ver_produtividade boolean not null default false;

-- a marcação só existe em acesso de perfil Visitante
alter table public.acesso add constraint acesso_ver_produtividade_ck
  check (not ver_produtividade or perfil = 'visitante');

create or replace function app.ve_produtividade()
returns boolean language sql stable security definer set search_path to ''
as $$
  select coalesce((select a.ver_produtividade from public.acesso a
                   where a.email = lower((select auth.jwt() ->> 'email'))), false)
$$;
revoke all on function app.ve_produtividade() from public, anon;
grant execute on function app.ve_produtividade() to authenticated;

-- Leitura: os três perfis de antes, ou o Visitante marcado.
do $$
declare t text;
begin
  foreach t in array array['produtividade_dia', 'produtividade_envios', 'produtividade_equipe',
                           'produtividade_eventos', 'produtividade_processos_dia'] loop
    execute format('drop policy if exists %I on public.%I', t || '_le', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (
      (select app.perfil_atual()) = any (array['gestor'::perfil_acesso, 'diretor'::perfil_acesso, 'magistrado'::perfil_acesso])
      or (select app.ve_produtividade()))$p$, t || '_le', t);
  end loop;
end $$;

-- ============ Para desfazer ============
-- (recriar as políticas *_le só com os três perfis, como em produtividade.sql)
-- drop function app.ve_produtividade();
-- alter table public.acesso drop constraint acesso_ver_produtividade_ck;
-- alter table public.acesso drop column ver_produtividade;
