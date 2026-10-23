-- Área "E-mails": a rotina diária (7h30) grava; o painel só lê.
-- A gravação feita pela rotina usa a credencial do conector do Supabase e não passa pela RLS.
-- Visibilidade (RLS em emails_resumo): gestor vê tudo; diretor, os e-mails de publico '2V';
-- magistrado(a), só minutas de publico '2V' do próprio cargo (acesso.magistrado). emails_corpo herda a regra.
-- Cargo escolhido à mão (gestor ou diretor) fica em emails_cargo e vale para os próximos e-mails do processo.
-- Já aplicado no banco (migração "emails_area"); este arquivo é o registro.

create or replace function app.magistrado_atual()
returns text language sql stable security definer set search_path to ''
as $$
  select a.magistrado from public.acesso a
  where a.email = lower((select auth.jwt() ->> 'email'))
$$;

create table public.emails_resumo (
  msg_id        text primary key,
  publico       text not null check (publico in ('2V','GESTOR')),
  numero        text check (numero ~ '^[0-9]{20}$'),
  categoria     text not null check (categoria in ('minuta','cumprimento','informacao','juntada','chamado','outros')),
  cargo         text check (cargo in ('T','S')),
  tarefa        text,
  entrada_tarefa timestamptz,
  urgente       boolean not null default false,
  perecimento   text,
  pedido        text,
  ato_provavel  text,
  remetente     text,
  assunto       text,
  recebido_em   timestamptz not null,
  web_link      text,
  anexo_juntar  boolean not null default false,
  solucionado   boolean not null default false,
  nao_localizado boolean not null default false,
  resumo_em     timestamptz not null default now()
);
create index emails_resumo_recebido_idx on public.emails_resumo (recebido_em desc);
create index emails_resumo_numero_idx on public.emails_resumo (numero);

create table public.emails_corpo (
  msg_id text primary key references public.emails_resumo(msg_id) on delete cascade,
  corpo  text not null check (length(corpo) <= 20000),
  anexos jsonb not null default '[]'::jsonb
);

create table public.emails_cargo (
  numero       text primary key check (numero ~ '^[0-9]{20}$'),
  magistrado   text not null check (magistrado in ('T','S')),
  definido_por text,
  em           timestamptz not null default now()
);

create table public.emails_lidos (
  email  text not null check (email = lower(email)),
  msg_id text not null references public.emails_resumo(msg_id) on delete cascade,
  em     timestamptz not null default now(),
  primary key (email, msg_id)
);

create or replace function app.emails_cargo_propaga()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  update public.emails_resumo
     set cargo = new.magistrado, nao_localizado = false
   where numero = new.numero;
  return new;
end $$;
create trigger emails_cargo_propaga after insert or update on public.emails_cargo
  for each row execute function app.emails_cargo_propaga();

alter table public.emails_resumo enable row level security;
alter table public.emails_corpo  enable row level security;
alter table public.emails_cargo  enable row level security;
alter table public.emails_lidos  enable row level security;

grant select on public.emails_resumo, public.emails_corpo to authenticated;
grant select, insert, update on public.emails_cargo to authenticated;
grant select, insert, delete on public.emails_lidos to authenticated;

create policy emails_resumo_le on public.emails_resumo for select to authenticated using (
  (select app.perfil_atual()) = 'gestor'::perfil_acesso
  or ((select app.perfil_atual()) = 'diretor'::perfil_acesso and publico = '2V')
  or ((select app.perfil_atual()) = 'magistrado'::perfil_acesso and publico = '2V'
      and categoria = 'minuta' and cargo = (select app.magistrado_atual()))
);
create policy emails_corpo_le on public.emails_corpo for select to authenticated using (
  exists (select 1 from public.emails_resumo r where r.msg_id = emails_corpo.msg_id)
);
create policy emails_cargo_le on public.emails_cargo for select to authenticated using (
  (select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[])
);
create policy emails_cargo_ins on public.emails_cargo for insert to authenticated with check (
  (select app.perfil_atual()) = any (array['gestor','diretor']::perfil_acesso[])
);
create policy emails_cargo_upd on public.emails_cargo for update to authenticated using (
  (select app.perfil_atual()) = any (array['gestor','diretor']::perfil_acesso[])
) with check (
  (select app.perfil_atual()) = any (array['gestor','diretor']::perfil_acesso[])
);
create policy emails_lidos_le on public.emails_lidos for select to authenticated using (
  email = lower((select auth.jwt() ->> 'email')) and (select app.perfil_atual()) is not null
);
create policy emails_lidos_ins on public.emails_lidos for insert to authenticated with check (
  email = lower((select auth.jwt() ->> 'email')) and (select app.perfil_atual()) is not null
  and exists (select 1 from public.emails_resumo r where r.msg_id = emails_lidos.msg_id)
);
create policy emails_lidos_del on public.emails_lidos for delete to authenticated using (
  email = lower((select auth.jwt() ->> 'email'))
);

-- Para desfazer:
-- drop table public.emails_lidos, public.emails_cargo, public.emails_corpo, public.emails_resumo;
-- drop function app.emails_cargo_propaga(), app.magistrado_atual();
