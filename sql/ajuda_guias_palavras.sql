-- Ajuda: palavras-chave de cada guia (os botões de "Assuntos" no início da área).
-- A coluna herda o grant de tabela (select para authenticated) e a política de leitura já existentes.
-- As palavras são preenchidas pela carga dos guias (ferramentas/converter_guias.py, fora do repositório).
alter table public.ajuda_guias add column if not exists palavras text[] not null default '{}';
