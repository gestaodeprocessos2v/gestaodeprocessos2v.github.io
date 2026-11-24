-- Inspeção Integrada (área nova do painel): as três listas do painel "Inspeção integrada" do BI (processos críticos, sem
-- movimentação e com conclusão antiga) de uma carga do BI. Cada envio do Gestor grava uma linha em inspecao_envios, com os
-- processos todos em "itens" (jsonb: um objeto por processo, já reunindo as listas em que ele aparece). A área lê o envio mais
-- recente e, no futuro, pode comparar uma carga com outra. Guardam-se os 20 envios mais novos (a função apaga os mais antigos).
-- Leitura: todo perfil com acesso (inclusive Visitante). Gravação: só o Gestor (RLS e checagem na função).
-- Nenhum nome de parte: só número, classe, tarefa e datas do BI. Já aplicado no banco (migração "inspecao"); este arquivo é o registro.

create table public.inspecao_envios (
  id           bigint generated always as identity primary key,
  carga_bi     timestamptz not null,
  enviado_em   timestamptz not null default now(),
  enviado_por  text,
  trimestre    text,
  n_criticos   integer not null default 0 check (n_criticos >= 0),
  n_semmov     integer not null default 0 check (n_semmov >= 0),
  n_conclusao  integer not null default 0 check (n_conclusao >= 0),
  arquivos     jsonb not null default '[]'::jsonb,
  itens        jsonb not null check (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) <= 20000)
);

create index inspecao_envios_carga_idx on public.inspecao_envios (carga_bi desc, id desc);

alter table public.inspecao_envios enable row level security;

create policy inspecao_envios_le on public.inspecao_envios for select to authenticated using (
  (select app.perfil_atual()) is not null
);
create policy inspecao_envios_ins on public.inspecao_envios for insert to authenticated with check (
  (select app.perfil_atual()) = 'gestor'
);
create policy inspecao_envios_del on public.inspecao_envios for delete to authenticated using (
  (select app.perfil_atual()) = 'gestor'
);

revoke all on public.inspecao_envios from anon, authenticated;
grant select, insert, delete on public.inspecao_envios to authenticated;

-- Grava um envio e apaga os mais antigos (fica com os 20 de carga mais recente), numa transação só.
-- p_itens: lista de objetos (um por processo). Devolve o id do envio.
create or replace function public.gravar_inspecao(
  p_carga timestamptz, p_trimestre text, p_arquivos jsonb, p_itens jsonb,
  p_n_criticos integer, p_n_semmov integer, p_n_conclusao integer, p_email text
) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  novo bigint;
begin
  if (select app.perfil_atual()) is distinct from 'gestor' then
    raise exception 'Só o Gestor pode gravar a Inspeção Integrada.' using errcode = '42501';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Lote vazio ou inválido.' using errcode = '22023';
  end if;
  if p_carga is null then
    raise exception 'Informe a data e hora da carga do BI.' using errcode = '22023';
  end if;
  insert into public.inspecao_envios (carga_bi, enviado_por, trimestre, n_criticos, n_semmov, n_conclusao, arquivos, itens)
    values (p_carga, p_email, nullif(trim(p_trimestre), ''), coalesce(p_n_criticos, 0), coalesce(p_n_semmov, 0), coalesce(p_n_conclusao, 0),
            coalesce(p_arquivos, '[]'::jsonb), p_itens)
    returning id into novo;
  delete from public.inspecao_envios
    where id not in (select id from public.inspecao_envios order by carga_bi desc, id desc limit 20);
  return novo;
end;
$$;

revoke all on function public.gravar_inspecao(timestamptz, text, jsonb, jsonb, integer, integer, integer, text) from public, anon;
grant execute on function public.gravar_inspecao(timestamptz, text, jsonb, jsonb, integer, integer, integer, text) to authenticated;

-- Para desfazer: drop function public.gravar_inspecao(timestamptz, text, jsonb, jsonb, integer, integer, integer, text); drop table public.inspecao_envios;
