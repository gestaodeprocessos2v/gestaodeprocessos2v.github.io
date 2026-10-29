-- Minutas para o Residente: o Gestor envia um .txt por processo (Gestão → "Minutas para o Residente");
-- o residente lê o texto na fila. O texto é guardado como veio (quebras de linha, linhas em branco e recuos).
-- A minuta é apagada sozinha 90 dias depois da conclusão do processo no painel (rotina diária às 6h30).
-- A data da conclusão é carimbada aqui a partir de marcas, para não depender da Limpeza da Gestão, que apaga marcas com mais de 90 dias.
-- Já aplicado no banco (migração "minutas_residente"); este arquivo é o registro. Sem nomes de pessoas.

create table public.minutas_residente (
  numero       text primary key check (numero ~ '^[0-9]{20}$'),
  texto        text not null check (length(texto) <= 20000),
  arquivo      text,
  enviado_em   timestamptz not null default now(),
  enviado_por  text,
  concluida_em timestamptz
);

-- Conclusão (ou desfazer) no painel: carimba ou limpa a data na minuta do processo (chave da marca = dígitos|chegada).
create or replace function app.minutas_carimbar_conclusao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.minutas_residente
     set concluida_em = case when new.desfeito is true then null else new.em end
   where numero = split_part(new.chave, '|', 1);
  return new;
end $$;

drop trigger if exists marcas_minutas_conclusao on public.marcas;
create trigger marcas_minutas_conclusao after insert or update on public.marcas
  for each row execute function app.minutas_carimbar_conclusao();

-- Minuta nova de processo já concluído: começa com a data da conclusão mais recente que não foi desfeita.
create or replace function app.minutas_conclusao_inicial() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select max(m.em) into new.concluida_em from public.marcas m
   where split_part(m.chave, '|', 1) = new.numero and m.desfeito is not true;
  return new;
end $$;

create trigger minutas_conclusao_inicial before insert on public.minutas_residente
  for each row execute function app.minutas_conclusao_inicial();

alter table public.minutas_residente enable row level security;

create policy minutas_le on public.minutas_residente for select to authenticated using (
  (select app.perfil_atual()) = any (array['gestor','residente']::perfil_acesso[])
);
create policy minutas_ins on public.minutas_residente for insert to authenticated with check (
  (select app.perfil_atual()) = 'gestor'
);
create policy minutas_upd on public.minutas_residente for update to authenticated using (
  (select app.perfil_atual()) = 'gestor'
) with check (
  (select app.perfil_atual()) = 'gestor'
);
create policy minutas_del on public.minutas_residente for delete to authenticated using (
  (select app.perfil_atual()) = 'gestor'
);

grant select, insert, update, delete on public.minutas_residente to authenticated;

select cron.schedule('limpar_minutas_residente', '30 6 * * *',
  $$ delete from public.minutas_residente where concluida_em < now() - interval '90 days' $$);

-- Para desfazer:
-- select cron.unschedule('limpar_minutas_residente');
-- drop trigger marcas_minutas_conclusao on public.marcas;
-- drop table public.minutas_residente;
-- drop function app.minutas_carimbar_conclusao(), app.minutas_conclusao_inicial();
