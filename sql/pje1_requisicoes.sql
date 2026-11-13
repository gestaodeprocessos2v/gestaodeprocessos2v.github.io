-- Requisitórios expedidos fora do JD (no PJE1), lidos do portal RPV/Precatório do TRF5 pelo extrator (alvo pje1).
-- Uma linha só (id = 1), substituída a cada envio na aba Gestão.
-- itens: { "<20 dígitos do processo>": { "r": [ { "num": nº do requisitório (17 dígitos), "trf": nº do processo no TRF5,
--          "tp": "RPV"|"PRC", "sit": "Paga"|"Cancelada"|"Arquivada sem pagamento"|"Em andamento", "em": "AAAA-MM-DD" } ],
--          "cons": "AAAA-MM-DD" (data da consulta) } }
-- r vazio = processo consultado sem nenhum requisitório no PJE1. Sem nome, CPF, banco, conta ou valor.
-- Mesmas regras de acesso de jd_requisicoes: leem gestor, servidor, magistrado e diretor; só o gestor grava.
create table if not exists public.pje1_requisicoes (
  id integer primary key check (id = 1),
  itens jsonb not null default '{}'::jsonb,
  importado_em timestamptz not null default now(),
  atualizado_por text
);

alter table public.pje1_requisicoes enable row level security;

grant select, insert, update on public.pje1_requisicoes to authenticated;

create policy pje1_requisicoes_le on public.pje1_requisicoes for select to authenticated
  using ((select app.perfil_atual()) = any (array['gestor','servidor','magistrado','diretor']::perfil_acesso[]));
create policy pje1_requisicoes_ins on public.pje1_requisicoes for insert to authenticated
  with check ((select app.perfil_atual()) = 'gestor'::perfil_acesso);
create policy pje1_requisicoes_upd on public.pje1_requisicoes for update to authenticated
  using ((select app.perfil_atual()) = 'gestor'::perfil_acesso)
  with check ((select app.perfil_atual()) = 'gestor'::perfil_acesso);
