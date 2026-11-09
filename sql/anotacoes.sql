-- Anotações compartilhadas: cada processo, no painel de cada pessoa, tem uma lista de anotações independentes (substitui a tabela notas,
-- que tinha uma anotação por pessoa e processo). A anotação pertence ao painel onde foi feita: pessoa = dono do painel.
-- Processo que muda de painel não leva as anotações. Autor, nome e datas são carimbados no servidor (gatilho), para não poderem ser
-- falsificados pelo navegador. reabre = false: registros automáticos ("Enviado para…", "Devolvido para…") e anotações copiadas de notas,
-- que ao serem criadas não reabrem processo concluído.
-- anotacoes_dispensa guarda o botão "Não priorizar": anotações de terceiros anteriores a em deixam de subir e de segurar o processo.
-- Regras da tela em regras.js: estadoAnotacoes, conclusaoReaberta e marcasVigentes.

create table public.anotacoes (
  id           bigint generated always as identity primary key,
  pessoa       text not null,
  numero       text not null check (numero ~ '^[0-9]{20}$'),
  autor_email  text,
  autor_pessoa text,
  autor_nome   text not null default '',
  texto        text not null check (length(texto) between 1 and 2000),
  em           timestamptz not null default now(),
  editada_em   timestamptz,
  reabre       boolean not null default true
);
create index anotacoes_pessoa_numero_idx on public.anotacoes (pessoa, numero);

create table public.anotacoes_dispensa (
  pessoa text not null,
  numero text not null check (numero ~ '^[0-9]{20}$'),
  em     timestamptz not null default now(),
  primary key (pessoa, numero)
);

-- Cópia das anotações atuais, antes de existirem os gatilhos: cada uma mantém autor e data já gravados.
insert into public.anotacoes (pessoa, numero, autor_email, autor_pessoa, autor_nome, texto, em, reabre)
select n.pessoa, n.numero,
       coalesce(a.email, g.email),
       n.pessoa,
       coalesce(
         case when n.pessoa = '__gestor' then nullif(trim(c.valor ->> 'nomeGestor'), '') end,
         a.nome,
         (select p.e ->> 'nome' from jsonb_array_elements(c.valor -> 'pessoas') p(e) where p.e ->> 'id' = n.pessoa limit 1),
         g.nome,
         case when n.pessoa = '__gestor' then 'Gestor' end,
         ''
       ),
       n.texto, n.em, false
from public.notas n
left join public.acesso a on a.pessoa_id = n.pessoa
left join public.acesso g on n.pessoa = '__gestor' and g.perfil = 'gestor'
left join public.config c on c.chave = 'geral'
order by n.em;

create or replace function app.anotacoes_carimbar()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    new.autor_email  := lower((select auth.jwt() ->> 'email'));
    new.autor_pessoa := app.pessoa_atual();
    new.autor_nome   := coalesce(app.nome_atual(), '');
    new.em           := now();
    new.editada_em   := null;
  else
    new.pessoa       := old.pessoa;
    new.numero       := old.numero;
    new.autor_email  := old.autor_email;
    new.autor_pessoa := old.autor_pessoa;
    new.autor_nome   := old.autor_nome;
    new.em           := old.em;
    new.reabre       := old.reabre;
    new.editada_em   := now();
  end if;
  return new;
end $$;

create or replace function app.anotacoes_dispensa_carimbar()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  new.em := now();
  return new;
end $$;

create trigger anotacoes_carimbar before insert or update on public.anotacoes
  for each row execute function app.anotacoes_carimbar();
create trigger anotacoes_dispensa_carimbar before insert or update on public.anotacoes_dispensa
  for each row execute function app.anotacoes_dispensa_carimbar();

alter table public.anotacoes enable row level security;
alter table public.anotacoes_dispensa enable row level security;

revoke all on public.anotacoes, public.anotacoes_dispensa from anon, authenticated;
grant select, insert, update, delete on public.anotacoes, public.anotacoes_dispensa to authenticated;

create policy anotacoes_le on public.anotacoes for select to authenticated
  using ((select app.perfil_atual()) is not null);
create policy anotacoes_ins on public.anotacoes for insert to authenticated
  with check ((select app.perfil_atual()) <> 'visitante');
create policy anotacoes_upd on public.anotacoes for update to authenticated
  using (autor_email = lower((select auth.jwt() ->> 'email')) or autor_pessoa = (select app.pessoa_atual()))
  with check (autor_email = lower((select auth.jwt() ->> 'email')) or autor_pessoa = (select app.pessoa_atual()));
create policy anotacoes_del on public.anotacoes for delete to authenticated
  using (autor_email = lower((select auth.jwt() ->> 'email')) or autor_pessoa = (select app.pessoa_atual()) or pessoa = (select app.pessoa_atual()));

create policy anotacoes_dispensa_le on public.anotacoes_dispensa for select to authenticated
  using ((select app.perfil_atual()) is not null);
create policy anotacoes_dispensa_ins on public.anotacoes_dispensa for insert to authenticated
  with check (pessoa = (select app.pessoa_atual()));
create policy anotacoes_dispensa_upd on public.anotacoes_dispensa for update to authenticated
  using (pessoa = (select app.pessoa_atual())) with check (pessoa = (select app.pessoa_atual()));
create policy anotacoes_dispensa_del on public.anotacoes_dispensa for delete to authenticated
  using (pessoa = (select app.pessoa_atual()));

-- Para desfazer: drop table public.anotacoes_dispensa, public.anotacoes;
--                drop function app.anotacoes_carimbar(), app.anotacoes_dispensa_carimbar();
