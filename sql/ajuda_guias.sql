-- Área "Ajuda": guias passo a passo (convertidos dos .docx da vara), com as imagens embutidas no html como data: URI.
-- Lê qualquer perfil com acesso (o painel exige login); ninguém grava pela tela: os guias entram pela ferramenta de SQL.
-- As imagens são tarjadas antes da conversão (nomes, endereços e números de processo não entram).
create table if not exists public.ajuda_guias (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  titulo text not null,
  categoria text not null default 'Geral',
  ordem integer not null default 0,
  html text not null,
  atualizado_em timestamptz not null default now()
);

alter table public.ajuda_guias enable row level security;

grant select on public.ajuda_guias to authenticated;

create policy ajuda_guias_le on public.ajuda_guias for select to authenticated
  using ((select app.perfil_atual()) is not null);
