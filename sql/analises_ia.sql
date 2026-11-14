-- Análises da IA: a análise do encaminhamento de um processo (arquivo <número>_Analise.md) aparece na linha dele na fila.
-- As análises entram junto com a lista do PJe+R: na importação, o painel lê a pasta das análises (permissão do Gestor no
-- navegador), grava as dos processos da lista e apaga as dos processos que não estão mais em nenhuma fila.
-- Leitura: todo perfil com acesso (o mesmo critério de filas). Gravação: só o Gestor.
-- Já aplicado no banco (migração "analises_ia"); este arquivo é o registro. Sem nomes de pessoas.

create table public.analises_ia (
  numero       text primary key check (numero ~ '^[0-9]{20}$'),
  caminho      text not null check (length(caminho) <= 300),
  motivo       text check (length(motivo) <= 1000),
  tarefa       text,
  analisado_em date,
  texto        text not null check (length(texto) <= 40000),
  hash         text not null,
  arquivo      text,
  gravado_em   timestamptz not null default now()
);

alter table public.analises_ia enable row level security;

create policy analises_ia_le on public.analises_ia for select to authenticated using (
  (select app.perfil_atual()) is not null
);
create policy analises_ia_ins on public.analises_ia for insert to authenticated with check (
  (select app.perfil_atual()) = 'gestor'
);
create policy analises_ia_upd on public.analises_ia for update to authenticated using (
  (select app.perfil_atual()) = 'gestor'
) with check (
  (select app.perfil_atual()) = 'gestor'
);
create policy analises_ia_del on public.analises_ia for delete to authenticated using (
  (select app.perfil_atual()) = 'gestor'
);

grant select, insert, update, delete on public.analises_ia to authenticated;
