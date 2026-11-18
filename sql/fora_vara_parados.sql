-- Processos Parados com as tarefas fora das filas (18/11/2026).
-- "parados": no envio da lista do PJe+R, uma entrada por processo e tarefa que não entra em fila de servidor
-- ({ n, c, t, ch, sg, m }). "itens" continua igual (um por processo, para a aba Pendentes das Metas CNJ).
-- RLS e grants da tabela não mudam: os grants de select/insert/update do authenticated são da tabela inteira.
alter table public.fora_vara add column if not exists parados jsonb not null default '[]'::jsonb;
