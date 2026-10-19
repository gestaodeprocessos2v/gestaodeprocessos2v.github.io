-- Servidor eventual: trabalha de forma eventual em Comunicação e Pagamentos, sem fila própria,
-- e o painel registra quem concluiu cada processo (marcas.concluida_por).
-- RASCUNHO PARA REVISÃO: não foi aplicado no banco. Aplicar na ordem (partes 1 e 2 em migrações separadas,
-- porque um valor novo de enum só pode ser usado depois de confirmado). Sem nomes de pessoas.

-- ============ Parte 1 (migração própria) ============
alter type public.perfil_acesso add value if not exists 'eventual';

-- ============ Parte 2 ============
-- 2.1 O perfil novo também precisa de pessoa_id (a pessoa cadastrada em config.pessoas, tipo "eventual").
alter table public.acesso drop constraint acesso_fila_ck;
alter table public.acesso add constraint acesso_fila_ck
  check ((perfil in ('servidor', 'estagiario', 'residente', 'diretor', 'eventual')) = (pessoa_id is not null));

-- 2.2 Quem concluiu. Vazio = o próprio dono do processo concluiu (comportamento de sempre).
alter table public.marcas add column if not exists concluida_por text;

-- 2.3 O autor é carimbado no servidor, para não poder ser falsificado pelo navegador.
create or replace function app.marcas_carimbar_autor() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.desfeito is not true then
    new.concluida_por := case when app.pessoa_atual() is distinct from new.pessoa then app.pessoa_atual() else null end;
  end if;
  return new;
end $$;

drop trigger if exists marcas_carimbar_autor on public.marcas;
create trigger marcas_carimbar_autor before insert or update on public.marcas
  for each row execute function app.marcas_carimbar_autor();

-- 2.4 O servidor eventual pode marcar (e desfazer) a conclusão na fila de qualquer dono,
--     só em processos de Comunicação e Pagamentos (o setor vai junto no item guardado). Não apaga marcas.
create policy marcas_eventual_ins on public.marcas for insert to authenticated
  with check ((select app.perfil_atual()) = 'eventual' and item ->> 's' in ('comunicacao', 'pagamentos'));
create policy marcas_eventual_upd on public.marcas for update to authenticated
  using ((select app.perfil_atual()) = 'eventual' and item ->> 's' in ('comunicacao', 'pagamentos'))
  with check ((select app.perfil_atual()) = 'eventual' and item ->> 's' in ('comunicacao', 'pagamentos'));

-- Nada muda em filas e urgencias: a leitura já é liberada a qualquer perfil cadastrado; o gestor, o servidor
-- e o diretor já podem enviar urgência para ela (urg_ins_gestor, urg_ins_envio) e ela conclui as suas (urg_conclui).

-- ============ Para desfazer ============
-- drop policy marcas_eventual_ins on public.marcas; drop policy marcas_eventual_upd on public.marcas;
-- drop trigger marcas_carimbar_autor on public.marcas; drop function app.marcas_carimbar_autor();
-- alter table public.marcas drop column concluida_por;
-- (o valor 'eventual' do enum não pode ser removido; basta não cadastrar ninguém com ele)
