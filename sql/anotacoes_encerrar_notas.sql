-- Encerramento da tabela notas, depois da publicação das anotações compartilhadas (sql/anotacoes.sql).
-- Páginas abertas ou em cache (até 10 minutos) ainda podiam gravar em notas depois da cópia: aplica nas anotações o que mudou
-- desde o corte e retira a permissão de gravação. A tabela notas fica guardada como cópia de segurança.
-- Corte: horário de pouco antes da cópia inicial.

alter table public.anotacoes disable trigger anotacoes_carimbar;

-- Anotação copiada que a página antiga apagou.
delete from public.anotacoes a
where a.em <= timestamptz '2026-11-09 17:08:56+00' and not a.reabre and a.autor_pessoa = a.pessoa and a.editada_em is null
  and not exists (select 1 from public.notas n where n.pessoa = a.pessoa and n.numero = a.numero);

-- Anotação copiada que a página antiga reescreveu.
update public.anotacoes a set texto = n.texto, em = n.em
from public.notas n
where n.pessoa = a.pessoa and n.numero = a.numero and n.em > timestamptz '2026-11-09 17:08:56+00'
  and a.em <= timestamptz '2026-11-09 17:08:56+00' and not a.reabre and a.autor_pessoa = a.pessoa and a.editada_em is null;

-- Anotação nova feita na página antiga.
insert into public.anotacoes (pessoa, numero, autor_email, autor_pessoa, autor_nome, texto, em, reabre)
select n.pessoa, n.numero, coalesce(a.email, g.email), n.pessoa,
       coalesce(
         case when n.pessoa = '__gestor' then nullif(trim(c.valor ->> 'nomeGestor'), '') end,
         a.nome,
         (select p.e ->> 'nome' from jsonb_array_elements(c.valor -> 'pessoas') p(e) where p.e ->> 'id' = n.pessoa limit 1),
         g.nome,
         case when n.pessoa = '__gestor' then 'Gestor' end,
         ''
       ),
       n.texto, n.em, false
from public.notas n
left join public.acesso a on a.pessoa_id = n.pessoa
left join public.acesso g on n.pessoa = '__gestor' and g.perfil = 'gestor'
left join public.config c on c.chave = 'geral'
where n.em > timestamptz '2026-11-09 17:08:56+00'
  and not exists (select 1 from public.anotacoes x where x.pessoa = n.pessoa and x.numero = n.numero and x.em = n.em and x.texto = n.texto);

alter table public.anotacoes enable trigger anotacoes_carimbar;

revoke insert, update, delete on public.notas from authenticated;
