-- Área "E-mails": pedido de despacho com o juiz.
-- "Despacho" aqui é o advogado pedindo para tratar do processo diretamente com o(a) magistrado(a)
-- (ex.: "gostaria de despachar com o juiz", "agendamento de despacho virtual", "reunião com o/a magistrado/a"),
-- e não o despacho-documento assinado pelo juiz ("conforme despacho", "cumprimento do despacho de id").
-- A rotina diária (7h30) lê o e-mail inteiro e grava despacho_juiz; o painel também procura essas
-- expressões no assunto e no pedido (Regras.pedidoDespacho) para cobrir e-mails antigos.
-- A coluna herda a RLS de emails_resumo; nada a mudar nas políticas.
-- Migração "emails_despacho_juiz".

alter table public.emails_resumo add column if not exists despacho_juiz boolean not null default false;

-- Para desfazer:
-- alter table public.emails_resumo drop column despacho_juiz;
