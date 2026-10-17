-- Situação das RPV/PRC no Jurisdição Delegada (JD): uma linha só (id = 1), substituída a cada envio na aba Gestão.
-- itens: { "<20 dígitos do processo>": { "n": requisições, "prc": quantas são PRC, "s": { "<situação>": quantidade } } }
-- Mesmas regras de acesso da tabela fora_vara: leem gestor, servidor, magistrado e diretor; só o gestor grava.
create table if not exists public.jd_requisicoes (
  id integer primary key check (id = 1),
  itens jsonb not null default '{}'::jsonb,
  importado_em timestamptz not null default now(),
  atualizado_por text
);

alter table public.jd_requisicoes enable row level security;

grant select, insert, update on public.jd_requisicoes to authenticated;

create policy jd_requisicoes_le on public.jd_requisicoes for select to authenticated
  using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor']::perfil_acesso[]));
create policy jd_requisicoes_ins on public.jd_requisicoes for insert to authenticated
  with check ((select app.perfil_atual()) = 'gestor'::perfil_acesso);
create policy jd_requisicoes_upd on public.jd_requisicoes for update to authenticated
  using ((select app.perfil_atual()) = 'gestor'::perfil_acesso)
  with check ((select app.perfil_atual()) = 'gestor'::perfil_acesso);
