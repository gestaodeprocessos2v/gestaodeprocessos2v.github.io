-- "Caixa de pedido" da juntada no PJe (área E-mails). O botão "Juntar no PJe" do card grava aqui o processo e os e-mails;
-- o script local (extrator, no Edge do painel, com a sessão do gestor) lê o pedido, apaga a linha e faz a juntada de UM processo.
-- O endereço painel:// não aceita argumentos (segurança) e o painel só lê a pasta do extrator; por isso o pedido passa pelo banco.
-- Uma única linha (id = 1): um pedido por vez. Só o gestor lê e grava (RLS). O script só atende o que ainda está pendente na lista
-- de e-mails e ignora pedido com mais de 15 minutos; o pedido sozinho não junta nada.
-- Já aplicado no banco (migração "juntada_pedido", 24/10/2026), depois de testada a RLS em transação desfeita; este arquivo é o registro.

create table public.juntada_pedido (
  id        smallint primary key default 1 check (id = 1),
  numero    text not null check (numero ~ '^[0-9]{20}$'),
  msg_ids   text[] not null default '{}' check (cardinality(msg_ids) <= 50),
  pedido_em timestamptz not null default now()
);

create or replace function app.juntada_pedido_carimbar()
returns trigger language plpgsql set search_path to ''
as $$
begin
  new.pedido_em := now();
  return new;
end $$;

create trigger juntada_pedido_carimbar before insert or update on public.juntada_pedido
  for each row execute function app.juntada_pedido_carimbar();

alter table public.juntada_pedido enable row level security;
revoke all on public.juntada_pedido from anon, authenticated;
grant select, insert, update, delete on public.juntada_pedido to authenticated;

create policy juntada_pedido_le on public.juntada_pedido for select to authenticated using (
  (select app.perfil_atual()) = 'gestor'::perfil_acesso
);
create policy juntada_pedido_ins on public.juntada_pedido for insert to authenticated with check (
  (select app.perfil_atual()) = 'gestor'::perfil_acesso
);
create policy juntada_pedido_upd on public.juntada_pedido for update to authenticated using (
  (select app.perfil_atual()) = 'gestor'::perfil_acesso
) with check (
  (select app.perfil_atual()) = 'gestor'::perfil_acesso
);
create policy juntada_pedido_del on public.juntada_pedido for delete to authenticated using (
  (select app.perfil_atual()) = 'gestor'::perfil_acesso
);

-- Para desfazer:
-- drop table public.juntada_pedido;
-- drop function app.juntada_pedido_carimbar();
