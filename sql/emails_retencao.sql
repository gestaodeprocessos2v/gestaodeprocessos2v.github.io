-- Retenção da área E-mails: apaga, todo dia às 06:30 UTC (03:30 de Brasília), os e-mails recebidos há mais de 90 dias.
-- emails_corpo e emails_lidos saem em cascata. Conclusões e anotações (emails_conclusao, emails_notas) ficam: são do processo.
-- Antes ficava no fim da rotina diária de e-mails (nuvem), mas o conector do Supabase pede confirmação para DELETE e a
-- rotina não tem quem responda; a limpeza nunca rodava. Mesmo padrão de limpar_acessos_negados e limpar_minutas_residente.
select cron.schedule('limpar_emails_resumo', '30 6 * * *',
  $$ delete from public.emails_resumo where recebido_em < now() - interval '90 days' $$);

-- Para desfazer:
-- select cron.unschedule('limpar_emails_resumo');
