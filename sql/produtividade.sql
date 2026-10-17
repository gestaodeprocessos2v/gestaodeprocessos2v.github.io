-- Produtividade da Vara: atividades da equipe a partir do relatório "Atividades por Usuário" do Portal BI.
-- Quem lê: gestor, diretor e magistrado (NÃO servidor, estagiário, residente nem visitante). Quem grava: só o gestor.
-- Nenhum nome de pessoa fica neste arquivo: a lista da equipe é carregada pela aba Gestão do painel.
-- Aplicado em produção como migração `produtividade` (17/10/2026) e depois `produtividade_limpeza`, que tirou o que a aba "Por atividade" usava
-- (views por tipo e a coluna `tipo`) e a coluna `ano_anterior`, e `produtividade_agregados`, que trocou as views por tabelas de agregados.
-- Este arquivo já reflete o estado final.

-- Lista de pessoas da equipe (nome exatamente como o BI escreve), com a classificação própria desta área.
create table if not exists public.produtividade_equipe (
  nome_bi text primary key,
  perfil text not null default '',
  grupo text not null default '',
  ordem integer not null default 0,
  ativo boolean not null default true
);

-- Um registro por envio do relatório (histórico).
create table if not exists public.produtividade_envios (
  id bigint generated always as identity primary key,
  enviado_em timestamptz not null default now(),
  enviado_por text,
  arquivo text,
  periodo_ini date,
  periodo_fim date,
  lidas integer not null default 0,        -- linhas de atividade lidas no arquivo
  da_lista integer not null default 0,     -- linhas de pessoas da lista
  novas integer not null default 0,        -- eventos que ainda não estavam guardados
  total_bi integer                         -- total da vara no BI: célula "Totais" do arquivo formatado ou calculado pela regra do BI
);

-- Eventos já tratados pela regra de contagem do BI. `chave` evita contar duas vezes o que se repete entre envios.
create table if not exists public.produtividade_eventos (
  id bigint generated always as identity primary key,
  chave text not null unique,
  envio_id bigint not null references public.produtividade_envios(id) on delete cascade,
  pessoa text not null,                    -- nome_bi
  processo text not null default '',
  atividade text not null,                 -- Documento Minutado, Tarefa ou Retificação
  ocorreu_em timestamp not null,           -- horário do BI, sem fuso
  total integer not null default 1
);
create index if not exists produtividade_eventos_data_idx on public.produtividade_eventos (ocorreu_em);
create index if not exists produtividade_eventos_pessoa_idx on public.produtividade_eventos (pessoa);
create index if not exists produtividade_eventos_envio_idx on public.produtividade_eventos (envio_id);

alter table public.produtividade_equipe enable row level security;
alter table public.produtividade_envios enable row level security;
alter table public.produtividade_eventos enable row level security;

grant select, insert, update, delete on public.produtividade_equipe to authenticated;
grant select, insert, update, delete on public.produtividade_envios to authenticated;
grant select, insert, update, delete on public.produtividade_eventos to authenticated;

do $$
declare t text;
begin
  foreach t in array array['produtividade_equipe', 'produtividade_envios', 'produtividade_eventos'] loop
    execute format($f$create policy %I on public.%I for select to authenticated
      using ((select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[]))$f$, t || '_le', t);
    execute format($f$create policy %I on public.%I for insert to authenticated
      with check ((select app.perfil_atual()) = 'gestor'::perfil_acesso)$f$, t || '_ins', t);
    execute format($f$create policy %I on public.%I for update to authenticated
      using ((select app.perfil_atual()) = 'gestor'::perfil_acesso)
      with check ((select app.perfil_atual()) = 'gestor'::perfil_acesso)$f$, t || '_upd', t);
    execute format($f$create policy %I on public.%I for delete to authenticated
      using ((select app.perfil_atual()) = 'gestor'::perfil_acesso)$f$, t || '_del', t);
  end loop;
end $$;

-- Agregados lidos pelo dashboard, guardados em tabelas (migração `produtividade_agregados`, 17/10/2026). Antes eram views que refaziam o
-- GROUP BY sobre todos os eventos a cada página lida (~3,5 s por página com 207 mil eventos; agora ~10 ms).
-- Só a função produtividade_recalcular grava (o painel a chama depois de gravar ou remover um envio).
create table if not exists public.produtividade_dia (
  dia date not null,
  pessoa text not null,
  atividade text not null,
  atividades integer not null,            -- soma de `total` dos eventos da pessoa naquele dia e atividade
  primary key (dia, pessoa, atividade)
);
-- Processos distintos por pessoa e dia (regra da macro antiga, mantida).
create table if not exists public.produtividade_processos_dia (
  dia date not null,
  pessoa text not null,
  processos integer not null,
  primary key (dia, pessoa)
);

alter table public.produtividade_dia enable row level security;
alter table public.produtividade_processos_dia enable row level security;
grant select on public.produtividade_dia, public.produtividade_processos_dia to authenticated;   -- sem política nem grant de escrita

create policy produtividade_dia_le on public.produtividade_dia for select to authenticated
  using ((select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[]));
create policy produtividade_processos_dia_le on public.produtividade_processos_dia for select to authenticated
  using ((select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[]));

-- Carga inicial (feita uma vez, na migração, a partir dos eventos já guardados):
--   insert into public.produtividade_dia select ocorreu_em::date, pessoa, atividade, sum(total)::integer from public.produtividade_eventos group by 1, 2, 3;
--   insert into public.produtividade_processos_dia select ocorreu_em::date, pessoa, count(distinct processo)::integer from public.produtividade_eventos group by 1, 2;

-- Refaz os agregados de um intervalo de datas; só o gestor executa.
create or replace function public.produtividade_recalcular(p_ini date, p_fim date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select app.perfil_atual()) is distinct from 'gestor'::public.perfil_acesso then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  delete from public.produtividade_dia where dia between p_ini and p_fim;
  insert into public.produtividade_dia (dia, pessoa, atividade, atividades)
    select ocorreu_em::date, pessoa, atividade, sum(total)::integer
    from public.produtividade_eventos
    where ocorreu_em >= p_ini::timestamp and ocorreu_em < (p_fim + 1)::timestamp
    group by 1, 2, 3;
  delete from public.produtividade_processos_dia where dia between p_ini and p_fim;
  insert into public.produtividade_processos_dia (dia, pessoa, processos)
    select ocorreu_em::date, pessoa, count(distinct processo)::integer
    from public.produtividade_eventos
    where ocorreu_em >= p_ini::timestamp and ocorreu_em < (p_fim + 1)::timestamp
    group by 1, 2;
end;
$$;
revoke all on function public.produtividade_recalcular(date, date) from public, anon;
grant execute on function public.produtividade_recalcular(date, date) to authenticated;
