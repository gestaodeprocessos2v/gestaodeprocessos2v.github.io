-- Área "E-mails": conclusão e anotação COMPARTILHADAS entre gestor, diretor e magistrado(a).
-- Chave do card = a da tela: publico || '|' || numero (ou publico || '|msg|' || msg_id quando o e-mail não tem número).
-- Concluir = inserir/atualizar a linha em emails_conclusao; desfazer = apagar a linha. O autor e a hora são carimbados no servidor
-- (gatilho), para não poderem ser falsificados pelo navegador. A linha só vale enquanto nenhum e-mail novo chegar ao card
-- (a tela compara a data da conclusão com a do último e-mail; ver Regras.emailConcluido).
-- Quem enxerga o quê é decidido pela RLS de emails_resumo: o exists abaixo respeita a política do usuário, então diretor e
-- magistrado(a) só leem e gravam em cards cujos e-mails já enxergam (nenhum número de processo vaza).
-- A coluna emails_resumo.solucionado e a rotina das 7h30 não mudam.
-- Já aplicado no banco (migração "emails_conclusao", 24/10/2026), depois de testada a RLS em transação desfeita; este arquivo é o registro.

create or replace function app.nome_atual()
returns text language sql stable security definer set search_path to ''
as $$
  select a.nome from public.acesso a where a.email = lower((select auth.jwt() ->> 'email'))
$$;

create table public.emails_conclusao (
  chave        text primary key check (length(chave) between 8 and 80),
  concluido_por text not null default '',
  em           timestamptz not null default now()
);

create table public.emails_notas (
  chave  text primary key check (length(chave) between 8 and 80),
  texto  text not null check (length(texto) between 1 and 2000),
  por    text not null default '',
  em     timestamptz not null default now()
);

create or replace function app.emails_conclusao_carimbar()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  new.concluido_por := coalesce(app.nome_atual(), '');
  new.em := now();
  return new;
end $$;

create or replace function app.emails_notas_carimbar()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  new.por := coalesce(app.nome_atual(), '');
  new.em := now();
  return new;
end $$;

create trigger emails_conclusao_carimbar before insert or update on public.emails_conclusao
  for each row execute function app.emails_conclusao_carimbar();
create trigger emails_notas_carimbar before insert or update on public.emails_notas
  for each row execute function app.emails_notas_carimbar();

alter table public.emails_conclusao enable row level security;
alter table public.emails_notas enable row level security;

revoke all on public.emails_conclusao, public.emails_notas from anon, authenticated;
grant select, insert, update, delete on public.emails_conclusao, public.emails_notas to authenticated;

-- Mesma regra para leitura e escrita nas duas tabelas.
create policy emails_conclusao_le on public.emails_conclusao for select to authenticated using (
  (select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[])
  and exists (select 1 from public.emails_resumo r where r.publico || '|' || coalesce(r.numero, 'msg|' || r.msg_id) = emails_conclusao.chave)
);
create policy emails_conclusao_ins on public.emails_conclusao for insert to authenticated with check (
  (select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[])
  and exists (select 1 from public.emails_resumo r where r.publico || '|' || coalesce(r.numero, 'msg|' || r.msg_id) = emails_conclusao.chave)
);
create policy emails_conclusao_upd on public.emails_conclusao for update to authenticated using (
  (select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[])
  and exists (select 1 from public.emails_resumo r where r.publico || '|' || coalesce(r.numero, 'msg|' || r.msg_id) = emails_conclusao.chave)
) with check (
  (select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[])
  and exists (select 1 from public.emails_resumo r where r.publico || '|' || coalesce(r.numero, 'msg|' || r.msg_id) = emails_conclusao.chave)
);
create policy emails_conclusao_del on public.emails_conclusao for delete to authenticated using (
  (select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[])
  and exists (select 1 from public.emails_resumo r where r.publico || '|' || coalesce(r.numero, 'msg|' || r.msg_id) = emails_conclusao.chave)
);

create policy emails_notas_le on public.emails_notas for select to authenticated using (
  (select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[])
  and exists (select 1 from public.emails_resumo r where r.publico || '|' || coalesce(r.numero, 'msg|' || r.msg_id) = emails_notas.chave)
);
create policy emails_notas_ins on public.emails_notas for insert to authenticated with check (
  (select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[])
  and exists (select 1 from public.emails_resumo r where r.publico || '|' || coalesce(r.numero, 'msg|' || r.msg_id) = emails_notas.chave)
);
create policy emails_notas_upd on public.emails_notas for update to authenticated using (
  (select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[])
  and exists (select 1 from public.emails_resumo r where r.publico || '|' || coalesce(r.numero, 'msg|' || r.msg_id) = emails_notas.chave)
) with check (
  (select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[])
  and exists (select 1 from public.emails_resumo r where r.publico || '|' || coalesce(r.numero, 'msg|' || r.msg_id) = emails_notas.chave)
);
create policy emails_notas_del on public.emails_notas for delete to authenticated using (
  (select app.perfil_atual()) = any (array['gestor','diretor','magistrado']::perfil_acesso[])
  and exists (select 1 from public.emails_resumo r where r.publico || '|' || coalesce(r.numero, 'msg|' || r.msg_id) = emails_notas.chave)
);

-- Para desfazer:
-- drop table public.emails_notas, public.emails_conclusao;
-- drop function app.emails_notas_carimbar(), app.emails_conclusao_carimbar(), app.nome_atual();
