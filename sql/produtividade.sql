-- Produtividade da Vara: atividades da equipe a partir do relatório "Atividades por Usuário" do Portal BI.
-- Quem lê: gestor, diretor e magistrado (NÃO servidor, estagiário, residente nem visitante). Quem grava: só o gestor.
-- Nenhum nome de pessoa fica neste arquivo: a lista da equipe é carregada pela aba Gestão do painel.
-- Aplicado em produção como migração `produtividade` (17/10/2026).

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
  total_bi integer,                        -- célula "Totais" do arquivo formatado (vara toda)
  ano_anterior jsonb                       -- opcional: {documentos, retificacoes, tarefas, total}
);

-- Eventos já tratados pela regra de contagem do BI. `chave` evita contar duas vezes o que se repete entre envios.
create table if not exists public.produtividade_eventos (
  id bigint generated always as identity primary key,
  chave text not null unique,
  envio_id bigint not null references public.produtividade_envios(id) on delete cascade,
  pessoa text not null,                    -- nome_bi
  processo text not null default '',
  atividade text not null,                 -- Documento Minutado, Tarefa ou Retificação
  tipo text not null default '',
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

-- Agregados lidos pelo dashboard (herdam a RLS dos eventos: security_invoker).
create or replace view public.produtividade_dia with (security_invoker = true) as
  select pessoa, ocorreu_em::date as dia, atividade, sum(total)::integer as atividades
  from public.produtividade_eventos
  group by pessoa, ocorreu_em::date, atividade;

-- Processos distintos por pessoa e dia (regra da macro antiga, mantida).
create or replace view public.produtividade_processos_dia with (security_invoker = true) as
  select pessoa, ocorreu_em::date as dia, count(distinct processo)::integer as processos
  from public.produtividade_eventos
  group by pessoa, ocorreu_em::date;

-- Por tipo de atividade, por dia (o dashboard pede só o período escolhido).
create or replace view public.produtividade_tipo_dia with (security_invoker = true) as
  select pessoa, ocorreu_em::date as dia, atividade, tipo, sum(total)::integer as atividades
  from public.produtividade_eventos
  group by pessoa, ocorreu_em::date, atividade, tipo;

-- Por tipo de atividade, por mês: para períodos longos o dashboard usa os meses inteiros daqui e só os dias das pontas da view diária.
create or replace view public.produtividade_tipo_mes with (security_invoker = true) as
  select pessoa, date_trunc('month', ocorreu_em)::date as mes, atividade, tipo, sum(total)::integer as atividades
  from public.produtividade_eventos
  group by pessoa, date_trunc('month', ocorreu_em)::date, atividade, tipo;

grant select on public.produtividade_dia, public.produtividade_processos_dia, public.produtividade_tipo_dia, public.produtividade_tipo_mes to authenticated;
