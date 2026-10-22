-- Nomes das classes em classe_processual passam a ser os que o PJe adota (decisão do Alberto: quando a prioridade por classe
-- usar o nome, vale o do PJe), com só as iniciais maiúsculas, menos preposições e artigos (de, do, em, a, pelo, contra...).
-- Antes eram os nomes do CNJ. Diferenças de conteúdo (além de maiúsculas e acentos): 65 passa a "Ação Civil Pública Cível" e
-- 15160 passa a "Cumprimento de Sentença de Ações Coletivas" (o PJe não traz "Individual").
-- Observações: a 193 (Produção Antecipada da Prova) fica como está: no CNJ o código atual é o 15620, que ainda não existe no
-- PJe. A 319 (Exceção de Incompetência de Juízo) fica na tabela, mas no catálogo do PJe ela está no grupo criminal (fora
-- da lista das classes cíveis); o nome dela foi lido na classe do processo no PJe.
-- Depende de sql/classe_processual.sql. Já aplicado no banco (migração classe_processual_nomes_pje, 22/10/2026).
-- Sem nomes de pessoas.

update public.classe_processual c
set descricao = v.descricao, atualizado_em = now()
from (values
  (7, 'Procedimento Comum Cível'),
  (32, 'Consignação em Pagamento'),
  (34, 'Demarcação / Divisão'),
  (37, 'Embargos de Terceiro Cível'),
  (38, 'Habilitação'),
  (46, 'Restauração de Autos Cível'),
  (49, 'Usucapião'),
  (63, 'Ação Civil Coletiva'),
  (64, 'Ação Civil de Improbidade Administrativa'),
  (65, 'Ação Civil Pública Cível'),
  (66, 'Ação Popular'),
  (81, 'Busca e Apreensão em Alienação Fiduciária'),
  (90, 'Desapropriação'),
  (94, 'Despejo por Falta de Pagamento Cumulado com Cobrança'),
  (119, 'Mandado de Segurança Coletivo'),
  (120, 'Mandado de Segurança Cível'),
  (151, 'Liquidação por Arbitramento'),
  (152, 'Liquidação de Sentença pelo Procedimento Comum'),
  (156, 'Cumprimento de Sentença'),
  (157, 'Cumprimento Provisório de Sentença'),
  (172, 'Embargos à Execução'),
  (193, 'Produção Antecipada da Prova'),
  (241, 'Petição Cível'),
  (261, 'Carta Precatória Cível'),
  (319, 'Exceção de Incompetência de Juízo'),
  (436, 'Procedimento do Juizado Especial Cível'),
  (1294, 'Outros Procedimentos de Jurisdição Voluntária'),
  (1707, 'Reintegração / Manutenção de Posse'),
  (10980, 'Cumprimento Provisório de Decisão'),
  (12075, 'Procedimento Conciliatório'),
  (12078, 'Cumprimento de Sentença contra a Fazenda Pública'),
  (12134, 'Tutela Cautelar Antecedente'),
  (12135, 'Tutela Antecipada Antecedente'),
  (12154, 'Execução de Título Extrajudicial'),
  (12228, 'Protesto'),
  (15160, 'Cumprimento de Sentença de Ações Coletivas')
) as v(codigo, descricao)
where c.codigo = v.codigo;

-- ============ Para desfazer (nomes do CNJ) ============
-- update public.classe_processual c
-- set descricao = v.descricao, atualizado_em = now()
-- from (values
--   (7, 'Procedimento Comum Cível'),
--   (32, 'Consignação em Pagamento'),
--   (34, 'Demarcação / Divisão'),
--   (37, 'Embargos de Terceiro Cível'),
--   (38, 'Habilitação'),
--   (46, 'Restauração de Autos Cível'),
--   (49, 'Usucapião'),
--   (63, 'Ação Civil Coletiva'),
--   (64, 'Ação Civil de Improbidade Administrativa'),
--   (65, 'Ação Civil Pública'),
--   (66, 'Ação Popular'),
--   (81, 'Busca e Apreensão em Alienação Fiduciária'),
--   (90, 'Desapropriação'),
--   (94, 'Despejo por Falta de Pagamento Cumulado Com Cobrança'),
--   (119, 'Mandado de Segurança Coletivo'),
--   (120, 'Mandado de Segurança Cível'),
--   (151, 'Liquidação por Arbitramento'),
--   (152, 'Liquidação de Sentença pelo Procedimento Comum'),
--   (156, 'Cumprimento de sentença'),
--   (157, 'Cumprimento Provisório de Sentença'),
--   (172, 'Embargos à Execução'),
--   (193, 'Produção Antecipada da Prova'),
--   (241, 'Petição Cível'),
--   (261, 'Carta Precatória Cível'),
--   (319, 'Exceção de Incompetência de Juízo'),
--   (436, 'Procedimento do Juizado Especial Cível'),
--   (1294, 'Outros procedimentos de jurisdição voluntária'),
--   (1707, 'Reintegração / Manutenção de Posse'),
--   (10980, 'Cumprimento Provisório de Decisão'),
--   (12075, 'Procedimento Conciliatório'),
--   (12078, 'Cumprimento de Sentença contra a Fazenda Pública'),
--   (12134, 'Tutela Cautelar Antecedente'),
--   (12135, 'Tutela Antecipada Antecedente'),
--   (12154, 'Execução de Título Extrajudicial'),
--   (12228, 'Protesto'),
--   (15160, 'Cumprimento Individual de Sentença de Ações Coletivas')
-- ) as v(codigo, descricao)
-- where c.codigo = v.codigo;
