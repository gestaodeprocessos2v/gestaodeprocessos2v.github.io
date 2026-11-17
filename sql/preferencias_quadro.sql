-- Quadro de avisos "Regras da fila" (quadro.js / quadro-ui.js): o que cada pessoa viu do quadro e se pediu para não exibir.
-- quadro_visto: { data (ms), itens: { id da regra: [texto de comparação, texto mostrado] } }, gravado ao fechar o quadro.
-- quadro_ocultar: "Não exibir de novo até uma regra mudar". O quadro volta quando uma regra que afeta a pessoa muda.
-- A tabela já tem RLS e grants (sql/preferencias.sql): cada pessoa lê e grava só a própria linha. Nada novo para anon.
-- O recado do Gestor fica em config (chave 'recado', valor { texto }), com a RLS de config (todos leem, só o Gestor grava).
alter table public.preferencias add column if not exists quadro_visto jsonb;
alter table public.preferencias add column if not exists quadro_ocultar boolean not null default false;
