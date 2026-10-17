-- Aparência da página (Sistema/Claro/Escuro) guardada na conta da pessoa, para acompanhá-la em qualquer aparelho.
-- Uma linha por e-mail (minúsculo). Cada pessoa lê e grava só a própria linha, e só se o e-mail estiver cadastrado em `acesso`.
-- tema: 'auto' (segue o sistema), 'light' ou 'dark'. Aplicado em produção como migração `preferencias_tema` (17/10/2026).
create table if not exists public.preferencias (
  email text primary key check (email = lower(email)),
  tema text not null default 'auto' check (tema in ('auto', 'light', 'dark')),
  atualizado_em timestamptz not null default now()
);

alter table public.preferencias enable row level security;

grant select, insert, update on public.preferencias to authenticated;

create policy preferencias_le on public.preferencias for select to authenticated
  using (email = lower((select auth.jwt() ->> 'email')) and (select app.perfil_atual()) is not null);
create policy preferencias_ins on public.preferencias for insert to authenticated
  with check (email = lower((select auth.jwt() ->> 'email')) and (select app.perfil_atual()) is not null);
create policy preferencias_upd on public.preferencias for update to authenticated
  using (email = lower((select auth.jwt() ->> 'email')) and (select app.perfil_atual()) is not null)
  with check (email = lower((select auth.jwt() ->> 'email')) and (select app.perfil_atual()) is not null);
