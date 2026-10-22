-- Classes processuais que aparecem nos relatórios do BI e do PJe+R, com o código CNJ e a abreviação do PJe+R.
-- Só para consulta: RLS ativo sem políticas (o app não lê); leitura e escrita só pelo SQL Editor.
-- Já aplicado no banco (migração classe_processual, 22/10/2026). Sem nomes de pessoas nem números de processo.

create table if not exists public.classe_processual (
  codigo            integer primary key,   -- nº CNJ
  descricao         text not null,         -- nome por extenso (CNJ)
  situacao          text not null check (situacao in ('A','I')),  -- A ativa, I inativa (CNJ)
  abreviacao        text not null unique,  -- como o PJe+R escreve
  origem_abreviacao text not null check (origem_abreviacao in ('BI','PJe')),
  prioritaria       boolean not null default false,
  atualizado_em     timestamptz not null default now()
);

alter table public.classe_processual enable row level security;
-- sem políticas de propósito

insert into public.classe_processual
  (codigo, descricao, situacao, abreviacao, origem_abreviacao) values
(7, 'Procedimento Comum Cível', 'A', 'ProceComCiv', 'BI'),
(32, 'Consignação em Pagamento', 'A', 'ConPag', 'PJe'),
(34, 'Demarcação / Divisão', 'A', 'DemDiv', 'BI'),
(37, 'Embargos de Terceiro Cível', 'A', 'ETCiv', 'BI'),
(38, 'Habilitação', 'A', 'Habili', 'BI'),
(46, 'Restauração de Autos Cível', 'A', 'ResAutCiv', 'PJe'),
(49, 'Usucapião', 'A', 'Usucap', 'BI'),
(63, 'Ação Civil Coletiva', 'A', 'ACC', 'BI'),
(64, 'Ação Civil de Improbidade Administrativa', 'A', 'ACIA', 'BI'),
(65, 'Ação Civil Pública', 'A', 'ACPCiv', 'BI'),
(66, 'Ação Popular', 'A', 'APop', 'BI'),
(81, 'Busca e Apreensão em Alienação Fiduciária', 'A', 'BAAF', 'PJe'),
(90, 'Desapropriação', 'A', 'Desapr', 'BI'),
(94, 'Despejo por Falta de Pagamento Cumulado Com Cobrança', 'A', 'DFPCC', 'BI'),
(119, 'Mandado de Segurança Coletivo', 'A', 'MSCol', 'BI'),
(120, 'Mandado de Segurança Cível', 'A', 'MSCiv', 'BI'),
(151, 'Liquidação por Arbitramento', 'A', 'LiqArb', 'PJe'),
(152, 'Liquidação de Sentença pelo Procedimento Comum', 'A', 'LiqProcedCom', 'PJe'),
(156, 'Cumprimento de sentença', 'A', 'CumSen', 'PJe'),
(157, 'Cumprimento Provisório de Sentença', 'A', 'CumPrSe', 'PJe'),
(172, 'Embargos à Execução', 'A', 'EE', 'BI'),
(193, 'Produção Antecipada da Prova', 'I', 'PAP', 'BI'),
(241, 'Petição Cível', 'A', 'PetCiv', 'PJe'),
(261, 'Carta Precatória Cível', 'A', 'CartPrecCiv', 'PJe'),
(319, 'Exceção de Incompetência de Juízo', 'A', 'ExcInc', 'PJe'),
(436, 'Procedimento do Juizado Especial Cível', 'A', 'PJEC', 'BI'),
(1294, 'Outros procedimentos de jurisdição voluntária', 'A', 'OPJV', 'BI'),
(1707, 'Reintegração / Manutenção de Posse', 'A', 'RtMtPosse', 'BI'),
(10980, 'Cumprimento Provisório de Decisão', 'A', 'CumPrDec', 'PJe'),
(12075, 'Procedimento Conciliatório', 'A', 'PCon', 'PJe'),
(12078, 'Cumprimento de Sentença contra a Fazenda Pública', 'A', 'CumSenFaz', 'PJe'),
(12134, 'Tutela Cautelar Antecedente', 'A', 'TutCautAnt', 'BI'),
(12135, 'Tutela Antecipada Antecedente', 'A', 'TutAntAnt', 'BI'),
(12154, 'Execução de Título Extrajudicial', 'A', 'ExTiEx', 'PJe'),
(12228, 'Protesto', 'A', 'Protes', 'PJe'),
(15160, 'Cumprimento Individual de Sentença de Ações Coletivas', 'A', 'CSAC', 'PJe');

-- ============ Para desfazer ============
-- drop table public.classe_processual;
