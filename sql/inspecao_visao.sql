-- Inspeção Integrada, etapa 3 (aba "Visão geral"): os indicadores mensais da aba "Visão Geral" do painel de Inspeção do BI
-- (casos novos x baixados, distribuídos x julgados, tempos médios, idades médias e processos sem movimentação; 12 meses),
-- gravados no mesmo envio das listas, na coluna "visao" (jsonb; nula nos envios manuais, que só têm os CSV).
-- Formato: {"ano", "meses": ["AAAA-MM" x 12], "series": {chave: [12 números]}, "ano_acum": {novos, baixados, distribuidos, julgados},
--           "atual": {chave: {"v": valor do mês, "var": variação em relação ao mesmo mês do ano anterior (fração)}}}.
-- A função ganha o parâmetro p_visao, opcional (padrão nulo): a versão anterior do painel continua gravando sem ele.
-- Já aplicado no banco (migração "inspecao_visao"); este arquivo é o registro.

alter table public.inspecao_envios
  add column visao jsonb check (visao is null or (jsonb_typeof(visao) = 'object' and pg_column_size(visao) < 200000));

drop function public.gravar_inspecao(timestamptz, text, jsonb, jsonb, integer, integer, integer, text);

create function public.gravar_inspecao(
  p_carga timestamptz, p_trimestre text, p_arquivos jsonb, p_itens jsonb,
  p_n_criticos integer, p_n_semmov integer, p_n_conclusao integer, p_email text, p_visao jsonb default null
) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  novo bigint;
begin
  if (select app.perfil_atual()) is distinct from 'gestor' then
    raise exception 'Só o Gestor pode gravar a Inspeção Integrada.' using errcode = '42501';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Lote vazio ou inválido.' using errcode = '22023';
  end if;
  if p_carga is null then
    raise exception 'Informe a data e hora da carga do BI.' using errcode = '22023';
  end if;
  if p_visao is not null and (jsonb_typeof(p_visao) <> 'object' or jsonb_typeof(p_visao -> 'meses') <> 'array' or jsonb_typeof(p_visao -> 'series') <> 'object') then
    raise exception 'Visão geral inválida.' using errcode = '22023';
  end if;
  insert into public.inspecao_envios (carga_bi, enviado_por, trimestre, n_criticos, n_semmov, n_conclusao, arquivos, itens, visao)
    values (p_carga, p_email, nullif(trim(p_trimestre), ''), coalesce(p_n_criticos, 0), coalesce(p_n_semmov, 0), coalesce(p_n_conclusao, 0),
            coalesce(p_arquivos, '[]'::jsonb), p_itens, p_visao)
    returning id into novo;
  delete from public.inspecao_envios
    where id not in (select id from public.inspecao_envios order by carga_bi desc, id desc limit 20);
  return novo;
end;
$$;

revoke all on function public.gravar_inspecao(timestamptz, text, jsonb, jsonb, integer, integer, integer, text, jsonb) from public, anon;
grant execute on function public.gravar_inspecao(timestamptz, text, jsonb, jsonb, integer, integer, integer, text, jsonb) to authenticated;

-- Para desfazer: voltar a função de sql/inspecao.sql (8 parâmetros) e "alter table public.inspecao_envios drop column visao;".
