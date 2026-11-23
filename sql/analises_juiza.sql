-- Recomendações da juíza (JS = Substituta, JT = Titular): o arquivo de recomendações que ela gera (vários processos, 1 ou 2 linhas
-- cada) é lido por uma rotina de IA no computador do Gestor, que grava um <número>_Recomendacao.md por processo em "Análise JS"
-- ou "Análise JT" (pastas separadas das análises do Gestor). O painel lê essa pasta (Rotinas com IA → Recomendações da juíza)
-- e grava aqui; a recomendação aparece na linha do processo, para todo perfil que vê a fila.
-- Cada envio substitui o que havia daquela magistrada (função substituir_analises_juiza, numa transação só).
-- Leitura: todo perfil com acesso. Gravação: só o Gestor (RLS e checagem na função).
-- Já aplicado no banco (migração "analises_juiza"); este arquivo é o registro. Sem nomes de pessoas.

create table public.analises_juiza (
  numero       text not null check (numero ~ '^[0-9]{20}$'),
  magistrada   text not null check (magistrada in ('JS', 'JT')),
  resumo       text not null check (length(resumo) <= 600),
  sem_leitura  boolean not null default false,
  texto        text not null check (length(texto) <= 4000),
  data_arquivo date,
  hash         text not null,
  arquivo      text,
  gravado_em   timestamptz not null default now(),
  primary key (numero, magistrada)
);

alter table public.analises_juiza enable row level security;

create policy analises_juiza_le on public.analises_juiza for select to authenticated using (
  (select app.perfil_atual()) is not null
);
create policy analises_juiza_ins on public.analises_juiza for insert to authenticated with check (
  (select app.perfil_atual()) = 'gestor'
);
create policy analises_juiza_upd on public.analises_juiza for update to authenticated using (
  (select app.perfil_atual()) = 'gestor'
) with check (
  (select app.perfil_atual()) = 'gestor'
);
create policy analises_juiza_del on public.analises_juiza for delete to authenticated using (
  (select app.perfil_atual()) = 'gestor'
);

revoke all on public.analises_juiza from anon, authenticated;
grant select, insert, update, delete on public.analises_juiza to authenticated;

-- Substitui, numa transação, tudo o que há de uma magistrada pelo lote novo (jsonb: lista de objetos com
-- numero, resumo, sem_leitura, texto, data_arquivo, hash, arquivo). Devolve quantas linhas gravou.
create or replace function public.substituir_analises_juiza(p_magistrada text, p_itens jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if (select app.perfil_atual()) is distinct from 'gestor' then
    raise exception 'Só o Gestor pode gravar as recomendações da juíza.' using errcode = '42501';
  end if;
  if p_magistrada not in ('JS', 'JT') then
    raise exception 'Magistrada inválida (use JS ou JT).' using errcode = '22023';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'Lote inválido.' using errcode = '22023';
  end if;
  delete from public.analises_juiza where magistrada = p_magistrada;
  insert into public.analises_juiza (numero, magistrada, resumo, sem_leitura, texto, data_arquivo, hash, arquivo)
    select x.numero, p_magistrada, x.resumo, coalesce(x.sem_leitura, false), x.texto, x.data_arquivo, x.hash, x.arquivo
    from jsonb_to_recordset(p_itens) as x(numero text, resumo text, sem_leitura boolean, texto text, data_arquivo date, hash text, arquivo text);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.substituir_analises_juiza(text, jsonb) from public, anon;
grant execute on function public.substituir_analises_juiza(text, jsonb) to authenticated;

-- Para desfazer: drop function public.substituir_analises_juiza(text, jsonb); drop table public.analises_juiza;
