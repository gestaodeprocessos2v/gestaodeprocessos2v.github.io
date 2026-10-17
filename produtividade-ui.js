/* Fila de Trabalho da Vara — área "Produtividade da Vara" (só gestor, diretor e magistrado) e os painéis da aba Gestão
   (Equipe da Produtividade e Envio do relatório do BI). As regras de leitura e de contagem estão em produtividade.js. */
(function () {
  'use strict';
  const P = window.PAINEL, M = window.Metas, X = window.Produtividade;
  if (!P || !P.render || !M || !X) return;
  const { st, R, esc, toast, falha, dataBR, dataHoraBR, todas, baixar } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const nBR = n => Number(n || 0).toLocaleString('pt-BR');
  const txt = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const norm = R.normTexto;
  const ATIV = [X.ATIV_DOC, X.ATIV_RETIF, X.ATIV_TAREFA];
  const PERIODOS = [['30', 'Últimos 30 dias'], ['mes', 'Mês atual'], ['mesAnterior', 'Mês anterior'], ['90', 'Últimos 90 dias'], ['12m', 'Últimos 12 meses'], ['ano', 'Este ano'], ['anoAnterior', 'Ano passado'], ['tudo', 'Tudo']];
  const LOTE = 1000;   // registros por envio ao banco
  const GRANS = [['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']];
  const dBR = d => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
  const dCurta = d => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—');
  const podeVer = () => P.PERFIS_PRODUTIVIDADE.includes(st.perfil);

  // ---------- estado ----------
  const S = () => st.prod || (st.prod = {
    equipe: [], envios: [], carregado: false, erro: false,
    dias: null, procs: null, dadosEnvio: null, carregando: false, erroDados: false, dataFim: null, primeiro: null,
    f: { periodo: '30', gran: 'dia', medida: 'atividades', perfisOff: null, gruposOff: [], busca: '', ordem: 'total', dir: -1 },   // perfisOff = null: ainda vai receber o padrão
    eq: { rasc: null, alterada: false, erro: '', salvando: false },
    imp: { arquivo: '', rel: null, erro: '', novos: null, conferindo: false, gravando: false, remover: null },
  });

  // Lê todas as páginas de uma consulta (o banco devolve no máximo 1.000 linhas por vez), pedindo algumas páginas ao mesmo tempo.
  async function todasParalelo(fabrica, simultaneas = 4) {
    const T = 1000, out = [];
    const primeira = await fabrica(0, T - 1);
    if (primeira.error) throw primeira.error;
    out.push(...primeira.data);
    if (primeira.data.length < T) return out;
    for (let i = T; ; i += T * simultaneas) {
      const rs = await Promise.all(Array.from({ length: simultaneas }, (_, k) => fabrica(i + k * T, i + (k + 1) * T - 1)));
      let fim = false;
      for (const r of rs) { if (r.error) throw r.error; out.push(...r.data); if (r.data.length < T) fim = true; }
      if (fim) break;
    }
    return out;
  }

  // ---------- dados (equipe e envios sempre; o resto só quando a área é aberta) ----------
  P.carregarProd = async function () {
    const s = S();
    try {
      const [eq, ev] = await Promise.all([
        st.sb.from('produtividade_equipe').select('nome_bi,perfil,grupo,ordem,ativo').order('ordem').order('nome_bi'),
        st.sb.from('produtividade_envios').select('id,enviado_em,enviado_por,arquivo,periodo_ini,periodo_fim,lidas,da_lista,novas,total_bi').order('id', { ascending: false }).limit(40),
      ]);
      if (eq.error) throw eq.error;
      if (ev.error) throw ev.error;
      s.equipe = eq.data || []; s.envios = ev.data || []; s.erro = false; s.carregado = true;
    } catch (e) { console.warn('Produtividade indisponível', e); s.erro = true; s.carregado = true; }
  };

  async function garantirDados() {
    const s = S(), ultimo = s.envios[0] ? s.envios[0].id : 0;
    if (s.carregando || (s.dias && s.dadosEnvio === ultimo)) return;
    if (!ultimo) { s.dias = []; s.procs = []; s.dadosEnvio = 0; return; }
    s.carregando = true;
    try {
      const [d, p] = await Promise.all([
        todasParalelo((a, b) => st.sb.from('produtividade_dia').select('pessoa,dia,atividade,atividades').order('dia').order('pessoa').order('atividade').range(a, b)),
        todasParalelo((a, b) => st.sb.from('produtividade_processos_dia').select('pessoa,dia,processos').order('dia').order('pessoa').range(a, b)),
      ]);
      s.dias = d; s.procs = p; s.dadosEnvio = ultimo; s.erroDados = false;
      const todos = d.map(r => r.dia).concat(p.map(r => r.dia)).sort();
      s.primeiro = todos[0] || null; s.dataFim = todos[todos.length - 1] || null;
    } catch (e) { console.error(e); s.erroDados = true; s.dias = s.dias || []; s.procs = s.procs || []; s.dadosEnvio = ultimo; }
    s.carregando = false;
    if (st.area === 'produtividade') render();
  }

  // ---------- auxiliares de tela ----------
  const vazio = (titulo, p) => `<div class="vazio"><h2>${esc(titulo)}</h2><p>${p}</p></div>`;
  // Cores e ordem fixas por nome do grupo ou do perfil (não dependem da ordem da lista da equipe). Tons suaves, definidos em estilo.css (--prod-0..7).
  const chaveNome = n => norm(n).replace(/[^a-z]/g, '');
  const FAMILIA = [['secretaria', 0], ['triagem', 1], ['assessoria', 2], ['digitos', 3], ['estagi', 4], ['residente', 5]];   // começo do nome -> cor
  const ORDEM_GRUPOS = ['secretaria', 'triagem', 'digitos', 'assessoria', 'estagi', 'residente'];
  const ORDEM_PERFIS = ['secretaria', 'assessoria', 'estagi'];
  const posicao = (lista, n) => { const k = chaveNome(n), i = lista.findIndex(x => k.startsWith(x)); return i < 0 ? lista.length : i; };
  const ordenar = (nomes, lista) => nomes.slice().sort((a, b) => posicao(lista, a) - posicao(lista, b) || a.localeCompare(b, 'pt-BR'));
  const grupos = s => ordenar([...new Set(s.equipe.filter(p => p.ativo !== false).map(p => p.grupo || '—'))], ORDEM_GRUPOS);
  const slotCor = n => { const k = chaveNome(n), f = FAMILIA.find(([x]) => k.startsWith(x)); return f ? f[1] : 6 + (k.length % 2); };
  const cor = (gs, g) => `var(--prod-${slotCor(g)})`;
  const rotPerfil = p => (/^estagi/.test(chaveNome(p)) ? 'Estagiários' : p);
  // vazioRot = texto da opção "todos"; null = sem essa opção (período e agrupamento sempre têm um valor).
  const opts = (lista, atual, vazioRot) => (vazioRot == null ? '' : `<option value="">${vazioRot}</option>`) + lista.map(o => `<option value="${esc(o.v)}"${o.v === atual ? ' selected' : ''}>${esc(o.r)}</option>`).join('');

  // ---------- filtros de perfil e grupo (chips, seleção múltipla) ----------
  // O estado guarda o que está DESLIGADO: assim um perfil ou grupo novo na lista da equipe entra ligado. Padrão ao abrir: todos os perfis,
  // menos os estagiários. Os grupos seguem os perfis ligados (só aparecem os grupos deles).
  const ehEstagiario = p => /^estagi/.test(norm(p));
  const perfisTodos = s => ordenar([...new Set(s.equipe.filter(p => p.ativo !== false).map(p => p.perfil || '—'))], ORDEM_PERFIS);
  const gruposDosPerfis = (s, perfis) => ordenar([...new Set(s.equipe.filter(p => p.ativo !== false && perfis.includes(p.perfil || '—')).map(p => p.grupo || '—'))], ORDEM_GRUPOS);
  function iniciarFiltros(s) { if (s.f.perfisOff == null) { s.f.perfisOff = perfisTodos(s).filter(ehEstagiario); s.f.gruposOff = []; } }
  function filtroEfetivo(s) {
    iniciarFiltros(s);
    const perfis = perfisTodos(s).filter(p => !s.f.perfisOff.includes(p));
    return { perfis, grupos: gruposDosPerfis(s, perfis).filter(g => !s.f.gruposOff.includes(g)) };
  }
  function noPadrao(s) {
    iniciarFiltros(s);
    const padrao = perfisTodos(s).filter(ehEstagiario);
    return s.f.gruposOff.length === 0 && s.f.perfisOff.length === padrao.length && padrao.every(p => s.f.perfisOff.includes(p));
  }

  function filtros(s, aba, ctx) {
    const f = s.f, ef = filtroEfetivo(s), gs = grupos(s);
    const sel = (campo, rot, lista, atual, vazioRot) => `<select data-pf="${campo}" aria-label="${rot}">${opts(lista, atual, vazioRot)}</select>`;
    const periodo = sel('periodo', 'Período', PERIODOS.map(([v, r]) => ({ v, r })), f.periodo, null);
    // Só aparecem as opções com atividade no período (regra dos filtros do painel), contadas na equipe inteira para o chip não sumir ao ser desligado; a quantidade fica no balão.
    const chip = (tipo, v, ligado, cor, n, rotulo = v) => `<button type="button" class="prod-chip" aria-pressed="${ligado}" data-pacao="chip" data-tipo="${tipo}" data-v="${esc(v)}" style="--c:${cor}" data-balao="${esc(`${rotulo}: ${nBR(n)} atividades no período`)}"><i></i>${esc(rotulo)}</button>`;
    const chipsPerfil = perfisTodos(s).map(v => [v, ctx.contar({ perfis: [v] })]).filter(([, n]) => n > 0)
      .map(([v, n]) => chip('perfil', v, ef.perfis.includes(v), cor(gs, v), n, rotPerfil(v))).join('');
    const chipsGrupo = gruposDosPerfis(s, ef.perfis).map(v => [v, ctx.contar({ grupos: [v] })]).filter(([, n]) => n > 0)
      .map(([v, n]) => chip('grupo', v, ef.grupos.includes(v), cor(gs, v), n)).join('');
    const chips = `<div class="prod-chips">
      <div class="prod-chips-bloco"><span class="prod-chips-rot" id="rot-perfil">Perfil</span><div class="prod-chips-lista" role="group" aria-labelledby="rot-perfil">${chipsPerfil}</div></div>
      <div class="prod-chips-bloco"><span class="prod-chips-rot" id="rot-grupo">Grupo</span><div class="prod-chips-lista" role="group" aria-labelledby="rot-grupo">${chipsGrupo || '<span class="muted small">Nenhum perfil ligado</span>'}</div></div>
      ${noPadrao(s) ? '' : '<button class="btn discreto" type="button" data-pacao="chips-padrao">Restaurar padrão</button>'}</div>`;
    const extra = [];
    if (aba === 'resumo') extra.push(sel('gran', 'Agrupar por', GRANS.map(([v, r]) => ({ v, r: `Por ${r.toLowerCase()}` })), f.gran, null));
    extra.push(`<div class="seg-tema prod-alterna" role="group" aria-label="Medida">${[['atividades', 'Atividades'], ['processos', 'Processos']].map(([v, r]) => `<button type="button" role="menuitemradio" aria-checked="${f.medida === v}" data-pacao="medida" data-v="${v}">${r}</button>`).join('')}</div>`);
    if (aba !== 'resumo') extra.push(`<input type="search" id="prod-busca" placeholder="Buscar pessoa" value="${esc(f.busca)}" aria-label="Buscar">`);
    return chips + `<div class="filtros prod-filtros">${periodo}${extra.join('')}${aba === 'pessoas' ? '<div class="direita"><button class="btn" type="button" data-pacao="csv">Baixar CSV</button></div>' : ''}</div>`;
  }

  // Variação sobre outro período (o imediatamente anterior ou o mesmo período do ano passado), só quando os envios cobrem esse período.
  const delta = (atual, ant, tem, rot, rotulo) => {
    if (!tem) return '';
    if (!ant) return `<small class="prod-delta muted" data-balao="${esc(rot)}" tabindex="0" role="note">${rotulo}: sem registros</small>`;
    const p = Math.round(((atual - ant) / ant) * 100);
    return `<small class="prod-delta ${p >= 0 ? 'sobe' : 'desce'}" data-balao="${esc(`${rot}\nAntes: ${nBR(ant)}`)}" tabindex="0" role="note">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% ${rotulo}</small>`;
  };

  // ---------- visão geral ----------
  function telaResumo(s, ctx) {
    const f = s.f, ag = ctx.ag(f), ant = ctx.anterior(f), anoAnt = ctx.anoPassado(f);
    const gs = grupos(s), medida = f.medida;
    const semComp = !ctx.temAnt && !ctx.temAno;
    const tile = (rot, v, a, b) => `<div class="tile"><span>${rot}</span><b>${nBR(v)}</b>${delta(v, a, ctx.temAnt, ctx.rotAnt, 'sobre o período anterior')}${delta(v, b, ctx.temAno, ctx.rotAno, 'sobre o mesmo período do ano passado')}${semComp ? '<small class="prod-delta muted">sem período para comparar</small>' : ''}</div>`;
    const t = ag.totais, ta = ant ? ant.totais : {}, tb = anoAnt ? anoAnt.totais : {};
    const cartoes = `<div class="contagens prod-contagens">${tile('Documentos Minutados', t[X.ATIV_DOC], ta[X.ATIV_DOC], tb[X.ATIV_DOC])}${tile('Retificações', t[X.ATIV_RETIF], ta[X.ATIV_RETIF], tb[X.ATIV_RETIF])}${tile('Tarefas', t[X.ATIV_TAREFA], ta[X.ATIV_TAREFA], tb[X.ATIV_TAREFA])}${tile('Total de atividades', t.total, ta.total, tb.total)}${tile('Processos', t.processos, ta.processos, tb.processos)}</div>`;

    // Totais da vara no BI (último envio que trouxe a célula "Totais")
    const env = s.envios.find(e => e.total_bi != null);
    let bi = '';
    if (env) {
      const doEnvio = ctx.agPeriodo(env.periodo_ini, env.periodo_fim);
      const parte = env.total_bi ? Math.round((doEnvio.totais.total / env.total_bi) * 100) : null;
      bi = `<section class="painel prod-bi"><h3>Vara toda no BI</h3><p>Entre ${dBR(env.periodo_ini)} e ${dBR(env.periodo_fim)} o BI registrou <b class="mono">${nBR(env.total_bi)}</b> atividades na 2ª Vara. A equipe da lista (todos os perfis) responde por <b class="mono">${nBR(doEnvio.totais.total)}</b>${parte != null ? ` (${parte}%)` : ''}.</p></section>`;
    }

    // Evolução: colunas empilhadas por grupo
    const val = b => (medida === 'processos' ? b.processos : b.total);
    const max = Math.max(1, ...ag.buckets.map(val));
    const passo = Math.max(1, Math.ceil(ag.buckets.length / 14));
    const colunas = ag.buckets.map((b, i) => {
      const partes = Object.entries(b.grupos).map(([g, v]) => [g, medida === 'processos' ? v.processos : v.atividades]).filter(([, v]) => v > 0)
        .sort((a, c) => gs.indexOf(a[0]) - gs.indexOf(c[0]));
      const periodo = f.gran === 'dia' ? dBR(b.inicio) : `${dBR(b.inicio)} a ${dBR(b.fim)}`;
      const balao = [`${periodo}${b.parcial ? ' (dados parciais)' : ''}`, ...partes.map(([g, v]) => `${g}: ${nBR(v)}`), `Total: ${nBR(val(b))}`].join('\n');
      const seg = partes.map(([g, v]) => `<i class="prod-seg" style="flex:${v};background:${cor(gs, g)}"></i>`).join('');
      return `<div class="prod-col${b.parcial ? ' parcial' : ''}" tabindex="0" role="note" data-balao="${esc(balao)}" aria-label="${esc(balao.replace(/\n/g, '. '))}"><div class="prod-pilha" style="height:${(val(b) / max) * 100}%">${seg}</div><span class="prod-rot">${i % passo === 0 ? esc(b.rotulo) : ''}</span></div>`;
    }).join('');
    const ligados = filtroEfetivo(s).grupos;
    const legenda = gs.filter(g => ligados.includes(g)).map(g => `<span class="prod-leg"><i style="background:${cor(gs, g)}"></i>${esc(g)}</span>`).join('');
    const nome = { dia: 'por dia', semana: 'por semana (segunda a domingo)', mes: 'por mês' }[f.gran];
    const grafico = `<section class="painel largo"><h3>${medida === 'processos' ? 'Processos' : 'Atividades'} ${nome}</h3>
      <div class="prod-grafico-wrap"><span class="prod-max mono">${nBR(max)}</span><div class="prod-grafico">${colunas}</div></div>
      <div class="prod-legenda">${legenda}<span class="muted small">Colunas listradas: período com dados parciais.</span></div></section>`;
    return cartoes + bi + grafico;
  }

  // ---------- por pessoa ----------
  const CAB_CSV = ['Pessoa', 'Perfil', 'Grupo', 'Documentos', 'Retificações', 'Tarefas', 'Dias ativos', 'Atividades', 'Média de atividades por dia ativo', 'Processos', 'Média de processos por dia ativo'];
  const media = p => (p.diasAtivos ? p.total / p.diasAtivos : 0);
  const mediaProc = p => (p.diasAtivos ? p.processos / p.diasAtivos : 0);
  const um = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });   // sempre uma casa decimal
  const valorOrdem = (p, k) => (k === 'media' ? media(p) : k === 'mediaProc' ? mediaProc(p) : p[k]);
  function linhasPessoas(s, ctx) {
    const f = s.f, busca = norm(f.busca);
    let ps = ctx.ag(f).pessoas.filter(p => !busca || norm(p.pessoa).includes(busca));
    const k = f.ordem, d = f.dir;
    ps.sort((a, b) => {
      const va = valorOrdem(a, k), vb = valorOrdem(b, k);
      const c = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : (va || 0) - (vb || 0);
      return c ? c * d : a.pessoa.localeCompare(b.pessoa, 'pt-BR');   // empate: sempre por nome, de A a Z
    });
    return ps;
  }
  function telaPessoas(s, ctx) {
    const f = s.f, gs = grupos(s), ps = linhasPessoas(s, ctx);
    const v = p => (f.medida === 'processos' ? p.processos : p.total);
    const ranking = ps.slice().sort((a, b) => v(b) - v(a) || a.pessoa.localeCompare(b.pessoa, 'pt-BR'));
    const max = Math.max(1, ...ranking.map(v));
    const barras = ranking.map(p => {
      const balao = [p.pessoa, `${rotPerfil(p.perfil || '—')} · ${p.grupo || '—'}`, `Documentos: ${nBR(p[X.ATIV_DOC])}`, `Retificações: ${nBR(p[X.ATIV_RETIF])}`, `Tarefas: ${nBR(p[X.ATIV_TAREFA])}`, `Atividades: ${nBR(p.total)}`, `Processos: ${nBR(p.processos)}`, `Dias com atividade: ${nBR(p.diasAtivos)}`].join('\n');
      return `<div class="prod-rank-lin" tabindex="0" role="note" data-balao="${esc(balao)}" aria-label="${esc(balao.replace(/\n/g, '. '))}"><span class="prod-nome">${esc(p.pessoa)}<small>${esc(p.grupo || '—')}</small></span><span class="prod-barra"><i style="width:${(v(p) / max) * 100}%;background:${cor(gs, p.grupo || '—')}"></i></span><b class="mono">${nBR(v(p))}</b></div>`;
    }).join('');
    const tot = ps.reduce((a, p) => { for (const c of ATIV.concat(['total', 'processos'])) a[c] = (a[c] || 0) + p[c]; return a; }, {});
    const th = (c, r, extra = '', cls = '') => `<th class="${(c === 'pessoa' ? '' : 'n ') + cls}" ${extra} aria-sort="${f.ordem === c ? (f.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="prod-th" data-pacao="ordem" data-campo="${esc(c)}">${r}${f.ordem === c ? (f.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    const cab = `<tr>${th('pessoa', 'Pessoa', 'rowspan="2"')}${th(X.ATIV_DOC, 'Documentos', 'rowspan="2"')}${th(X.ATIV_RETIF, 'Retificações', 'rowspan="2"')}${th(X.ATIV_TAREFA, 'Tarefas', 'rowspan="2"')}${th('diasAtivos', 'Dias ativos', 'rowspan="2"')}<th class="prod-par prod-par-a" colspan="2" scope="colgroup">Atividades</th><th class="prod-par prod-par-p prod-ini" colspan="2" scope="colgroup">Processos</th></tr>` +
      `<tr>${th('total', 'Total', '', 'prod-par-a')}${th('media', 'Média/dia', '', 'prod-par-a')}${th('processos', 'Total', '', 'prod-par-p prod-ini')}${th('mediaProc', 'Média/dia', '', 'prod-par-p')}</tr>`;
    const corpo = ps.map(p => `<tr><td data-balao="${esc(`${rotPerfil(p.perfil || '—')} · ${p.grupo || '—'}`)}">${esc(p.pessoa)}</td><td class="n">${nBR(p[X.ATIV_DOC])}</td><td class="n">${nBR(p[X.ATIV_RETIF])}</td><td class="n">${nBR(p[X.ATIV_TAREFA])}</td><td class="n">${nBR(p.diasAtivos)}</td><td class="n prod-par-a"><b>${nBR(p.total)}</b></td><td class="n prod-par-a prod-media">${um(media(p))}</td><td class="n prod-par-p prod-ini"><b>${nBR(p.processos)}</b></td><td class="n prod-par-p prod-media">${um(mediaProc(p))}</td></tr>`).join('');
    const rodape = `<tr class="prod-total"><td>Total (${ps.length} ${ps.length === 1 ? 'pessoa' : 'pessoas'})</td><td class="n">${nBR(tot[X.ATIV_DOC])}</td><td class="n">${nBR(tot[X.ATIV_RETIF])}</td><td class="n">${nBR(tot[X.ATIV_TAREFA])}</td><td></td><td class="n prod-par-a">${nBR(tot.total)}</td><td class="prod-par-a"></td><td class="n prod-par-p prod-ini">${nBR(tot.processos)}</td><td class="prod-par-p"></td></tr>`;
    return `<section class="painel largo"><h3>Ranking de ${f.medida === 'processos' ? 'processos' : 'atividades'} por pessoa</h3>
        <div class="prod-rank">${barras || '<p class="muted">Nenhuma pessoa com esse filtro.</p>'}</div>
        <div class="prod-legenda">${gs.filter(g => filtroEfetivo(s).grupos.includes(g)).map(g => `<span class="prod-leg"><i style="background:${cor(gs, g)}"></i>${esc(g)}</span>`).join('')}</div></section>
      <section class="painel largo"><h3>Detalhe por pessoa</h3>
        <div class="tabela-wrap"><table class="prod-tabela"><thead>${cab}</thead><tbody>${corpo || '<tr><td colspan="9" class="muted">Nenhuma pessoa com esse filtro.</td></tr>'}${ps.length ? rodape : ''}</tbody></table></div>
        <p class="small muted">Processos: soma, por pessoa, dos processos distintos de cada dia (o mesmo processo em dias diferentes conta mais de uma vez). Médias: total dividido pelos dias ativos (dias com ao menos uma atividade).</p></section>`;
  }
  function csvPessoas(s, ctx) {
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const ps = linhasPessoas(s, ctx);
    const dec = n => n.toFixed(1).replace('.', ',');
    const linhas = [CAB_CSV.join(';')].concat(ps.map(p => [p.pessoa, rotPerfil(p.perfil), p.grupo, p[X.ATIV_DOC], p[X.ATIV_RETIF], p[X.ATIV_TAREFA], p.diasAtivos, p.total, dec(media(p)), p.processos, dec(mediaProc(p))].map(q).join(';')));
    return '﻿' + linhas.join('\r\n');
  }

  // ---------- contexto de cálculo da área ----------
  function contexto(s) {
    const f = s.f, cob = X.cobertura(s.envios);
    const periodo = fl => X.periodoPreset(fl.periodo, s.dataFim, s.primeiro);
    const agBase = (fl, per, gran) => X.agregar({ dias: s.dias, procs: s.procs, equipe: s.equipe, filtro: filtroEfetivo(s), ini: per.ini, fim: per.fim, gran: gran || 'dia', cob });
    const ctx = {
      periodo,
      ag: fl => agBase(fl, periodo(fl), fl.gran),
      agPeriodo: (ini, fim) => X.agregar({ dias: s.dias, procs: s.procs, equipe: s.equipe, ini, fim, gran: 'mes', cob }),
      anterior: fl => { const p = periodo(fl); if (!p.ini) return null; const a = X.periodoAnterior(p.ini, p.fim); return X.coberto(a.ini, a.fim, cob) ? agBase(fl, a, 'mes') : null; },
      contar: filtro => X.agregar({ dias: s.dias, procs: s.procs, equipe: s.equipe, filtro, ini: periodo(f).ini, fim: periodo(f).fim, gran: 'mes' }).totais.total,
    };
    ctx.anoPassado = fl => { const p = periodo(fl); if (!p.ini) return null; const a = X.periodoAnoAnterior(p.ini, p.fim); return X.coberto(a.ini, a.fim, cob) ? agBase(fl, a, 'mes') : null; };
    const per = periodo(f), a = per.ini ? X.periodoAnterior(per.ini, per.fim) : null, b = per.ini ? X.periodoAnoAnterior(per.ini, per.fim) : null;
    ctx.temAnt = !!(a && X.coberto(a.ini, a.fim, cob));
    ctx.rotAnt = a ? `Período anterior: ${dBR(a.ini)} a ${dBR(a.fim)}` : '';
    ctx.temAno = !!(b && X.coberto(b.ini, b.fim, cob));
    ctx.rotAno = b ? `Mesmo período do ano passado: ${dBR(b.ini)} a ${dBR(b.fim)}` : '';
    // Períodos de um ano (ou iguais): o "período anterior" repetiria a comparação com o ano passado, então mostra só esta.
    if (a && b && ((a.ini === b.ini && a.fim === b.fim) || X.diasEntre(per.ini, per.fim) >= 359)) ctx.temAnt = false;
    return ctx;
  }

  // ---------- tela da área ----------
  P.renderProd = function () {
    const v = $('#v-prod'), s = S();
    if (!podeVer()) { v.innerHTML = vazio('Produtividade da Vara', 'Esta área é restrita ao gestor, ao diretor e aos magistrados.'); return; }
    if (!s.carregado) { v.innerHTML = vazio('Produtividade da Vara', 'Carregando…'); return; }
    if (s.erro) { v.innerHTML = `<div class="aviso erro">Não foi possível carregar os dados da Produtividade agora. Tente de novo em instantes.</div>`; return; }
    if (!s.equipe.length) { v.innerHTML = vazio('A lista da equipe ainda não foi cadastrada', st.perfil === 'gestor' ? 'Cadastre as pessoas em <b>Gestão → Equipe da Produtividade</b> e depois envie o relatório do BI.' : 'O gestor ainda precisa cadastrar a equipe.'); return; }
    if (!s.envios.length) { v.innerHTML = vazio('Ainda não há dados de produtividade', st.perfil === 'gestor' ? 'Envie o relatório “Atividades por Usuário” do BI em <b>Gestão → Enviar produtividade do BI</b>.' : 'O gestor ainda não enviou o relatório do BI.'); return; }
    garantirDados();
    if (!s.dias || s.dadosEnvio !== s.envios[0].id) { v.innerHTML = vazio('Carregando a produtividade…', 'Buscando os dados da equipe.'); return; }
    const foco = document.activeElement && document.activeElement.id, pos = foco === 'prod-busca' ? document.activeElement.selectionStart : null;
    const ae = document.activeElement, chipFoco = ae && ae.matches && ae.matches('.prod-chip') ? [ae.dataset.tipo, ae.dataset.v] : null;
    const aba = st.abaProd, ctx = contexto(s);
    const ultimo = s.envios[0];
    const atual = `<p class="atualizacao">Dados do BI de ${dBR(s.primeiro)} a ${dBR(s.dataFim)} · último envio em ${esc(dataHoraBR(Date.parse(ultimo.enviado_em)))} · só as pessoas da lista da equipe.</p>`;
    const ef = filtroEfetivo(s);
    const corpo = !ef.perfis.length ? vazio('Selecione ao menos um perfil', 'Ligue um dos perfis acima para ver os números da equipe.')
      : !ef.grupos.length ? vazio('Selecione ao menos um grupo', 'Ligue um dos grupos acima para ver os números da equipe.')
      : aba === 'pessoas' ? telaPessoas(s, ctx) : telaResumo(s, ctx);
    v.innerHTML = (s.erroDados ? '<div class="aviso erro">Não foi possível carregar todos os dados agora. Os números podem estar incompletos.</div>' : '') + filtros(s, aba, ctx) + atual + corpo;
    if (foco === 'prod-busca') { const b = $('#prod-busca'); if (b) { b.focus(); if (pos != null) b.setSelectionRange(pos, pos); } }
    if (chipFoco) { const c = [...v.querySelectorAll('.prod-chip')].find(x => x.dataset.tipo === chipFoco[0] && x.dataset.v === chipFoco[1]); if (c) c.focus(); }
  };

  // eventos da área
  const vp = $('#v-prod');
  let buscaTimer = null;
  vp.addEventListener('change', e => {
    const c = e.target.dataset && e.target.dataset.pf; if (!c) return;
    const s = S(); s.f[c] = e.target.value;
    // Sugere o agrupamento pelo tamanho do período (continua valendo a escolha manual depois): até 45 dias por dia; até ~7 meses por semana; mais que isso por mês.
    if (c === 'periodo' && s.dataFim) { const p = X.periodoPreset(s.f.periodo, s.dataFim, s.primeiro), n = X.diasEntre(p.ini, p.fim) + 1; s.f.gran = n <= 45 ? 'dia' : n <= 210 ? 'semana' : 'mes'; }
    render();
  });
  vp.addEventListener('input', e => {
    if (e.target.id !== 'prod-busca') return;
    clearTimeout(buscaTimer); buscaTimer = setTimeout(() => { S().f.busca = e.target.value; render(); }, 180);
  });
  vp.addEventListener('click', e => {
    const a = e.target.closest('[data-pacao]'); if (!a) return;
    const s = S(), f = s.f;
    if (a.dataset.pacao === 'medida') { f.medida = a.dataset.v; render(); }
    else if (a.dataset.pacao === 'chip') {
      iniciarFiltros(s);
      const lista = a.dataset.tipo === 'perfil' ? f.perfisOff : f.gruposOff, v = a.dataset.v, i = lista.indexOf(v);
      if (i >= 0) lista.splice(i, 1); else lista.push(v);
      render();
    } else if (a.dataset.pacao === 'chips-padrao') { f.perfisOff = null; f.gruposOff = []; render(); }
    else if (a.dataset.pacao === 'ordem') {
      const c = a.dataset.campo, texto = ['pessoa', 'perfil', 'grupo'].includes(c);
      if (f.ordem === c) f.dir = -f.dir; else { f.ordem = c; f.dir = texto ? 1 : -1; }
      render();
    } else if (a.dataset.pacao === 'csv') baixar(`produtividade-por-pessoa-${new Date().toISOString().slice(0, 10)}.csv`, csvPessoas(s, contexto(s)));
  });
  vp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.prod-col, .prod-rank-lin')) e.preventDefault();
  });

  // ============================ GESTÃO ============================
  // ---------- Equipe da Produtividade ----------
  const clonar = o => JSON.parse(JSON.stringify(o));
  P.painelEquipeGestao = function () {
    const s = S(), eq = s.eq, linhas = eq.rasc || s.equipe;
    const distintos = c => [...new Set(linhas.map(p => txt(p[c])).filter(Boolean))];
    const corpo = linhas.map((p, i) => `<tr>
      <td><input type="text" id="eq-nome-${i}" data-eq="nome_bi" data-i="${i}" value="${esc(p.nome_bi)}" aria-label="Nome no BI"></td>
      <td><input type="text" id="eq-perfil-${i}" list="eq-perfis" data-eq="perfil" data-i="${i}" value="${esc(p.perfil)}" aria-label="Perfil"></td>
      <td><input type="text" id="eq-grupo-${i}" list="eq-grupos" data-eq="grupo" data-i="${i}" value="${esc(p.grupo)}" aria-label="Grupo"></td>
      <td class="ck"><input type="checkbox" id="eq-ativo-${i}" data-eq="ativo" data-i="${i}"${p.ativo !== false ? ' checked' : ''} aria-label="Entra no dashboard"></td>
      <td><button class="btn discreto" type="button" data-acao="pr-eq-excluir" data-i="${i}">Excluir</button></td></tr>`).join('');
    return `<section class="painel largo" id="painel-equipe-prod">
      <h2>Equipe da Produtividade</h2>
      <p>Pessoas que entram no dashboard “Produtividade da Vara”. O <b>nome no BI</b> precisa ser igual ao que o relatório traz (maiúsculas e acentos não importam). Quem não está na lista é descartado quando o relatório é enviado. Se mudar o nome de alguém, os dados já guardados continuam com o nome antigo. Os dados dessa área só são visíveis para o gestor, o diretor e os magistrados.</p>
      ${eq.erro ? `<div class="aviso erro">${esc(eq.erro)}</div>` : ''}
      <label class="campo"><span>Importar lista (.xlsx com Servidor, Perfil e Grupo)</span><input type="file" id="pr-lista-arq" accept=".xlsx"></label>
      <datalist id="eq-perfis">${distintos('perfil').map(v => `<option value="${esc(v)}">`).join('')}</datalist>
      <datalist id="eq-grupos">${distintos('grupo').map(v => `<option value="${esc(v)}">`).join('')}</datalist>
      <div class="filtros dentro"><span id="eq-estado" class="small ${eq.alterada ? 'alterado' : 'muted'}">${eq.alterada ? 'Alterações não salvas' : `${s.equipe.length} ${s.equipe.length === 1 ? 'pessoa' : 'pessoas'}, tudo salvo`}</span>
        <div class="direita"><button class="btn" type="button" data-acao="pr-eq-incluir">Incluir pessoa</button></div></div>
      <div class="tabela-wrap"><table><thead><tr><th>Nome no BI</th><th>Perfil</th><th>Grupo</th><th>Entra</th><th></th></tr></thead>
      <tbody>${corpo || '<tr><td colspan="5" class="muted">Nenhuma pessoa. Importe a lista ou inclua manualmente.</td></tr>'}</tbody></table></div>
      <div class="linha-botoes"><button class="btn primario" type="button" data-acao="pr-eq-salvar" ${eq.alterada && !eq.salvando ? '' : 'disabled'}>${eq.salvando ? 'Salvando…' : 'Salvar equipe'}</button>
        <button class="btn" type="button" data-acao="pr-eq-descartar" ${eq.alterada ? '' : 'disabled'}>Descartar alterações</button></div></section>`;
  };

  function marcarEquipe() {
    const eq = S().eq; eq.alterada = true;
    const e = $('#eq-estado'); if (e) { e.textContent = 'Alterações não salvas'; e.className = 'small alterado'; }
    for (const a of ['pr-eq-salvar', 'pr-eq-descartar']) { const b = document.querySelector(`[data-acao="${a}"]`); if (b) b.disabled = false; }
  }
  function editarEquipe(el) {
    const s = S(); if (!s.eq.rasc) s.eq.rasc = clonar(s.equipe);
    const p = s.eq.rasc[Number(el.dataset.i)]; if (!p) return;
    p[el.dataset.eq] = el.type === 'checkbox' ? el.checked : el.value;
    marcarEquipe();
  }
  async function lerLista(arquivo) {
    const s = S(); s.eq.erro = '';
    if (arquivo) {
      try {
        const x = await M.lerXlsx(await arquivo.arrayBuffer());
        s.eq.rasc = X.lerEquipe(x.linhas); marcarEquipe();
        toast(`${s.eq.rasc.length} pessoas lidas. Confira e clique em Salvar equipe.`);
      } catch (e) { s.eq.erro = e.message || 'Não consegui ler a lista.'; }
    }
    render();
  }
  async function salvarEquipe() {
    const s = S(), eq = s.eq; if (!eq.rasc || eq.salvando) return;
    const itens = eq.rasc.map((p, i) => ({ nome_bi: txt(p.nome_bi), perfil: txt(p.perfil), grupo: txt(p.grupo), ordem: i + 1, ativo: p.ativo !== false })).filter(p => p.nome_bi);
    const vistos = new Set(), repetidas = [];
    for (const p of itens) { const k = norm(p.nome_bi); if (vistos.has(k)) repetidas.push(p.nome_bi); vistos.add(k); }
    if (repetidas.length) { toast('Nome repetido na lista: ' + repetidas.slice(0, 3).join('; ') + '. Exclua uma das linhas antes de salvar.'); return; }
    eq.salvando = true; render();
    try {
      const novos = new Set(itens.map(p => p.nome_bi)), remover = s.equipe.map(p => p.nome_bi).filter(n => !novos.has(n));
      if (itens.length) { const { error } = await st.sb.from('produtividade_equipe').upsert(itens, { onConflict: 'nome_bi' }); if (error) throw error; }
      if (remover.length) { const { error } = await st.sb.from('produtividade_equipe').delete().in('nome_bi', remover); if (error) throw error; }
      eq.rasc = null; eq.alterada = false; eq.erro = '';
      await P.carregar(); toast('Equipe salva.');
    } catch (e) { falha(e); }
    eq.salvando = false; render();
  }

  // ---------- Envio do relatório do BI ----------
  async function conferirNovos(rel) {
    const s = S(), i = s.imp;
    if (!rel.eventos.length || !rel.periodoIni) { i.novos = { novos: 0, guardados: 0 }; return; }
    i.conferindo = true; render();
    try {
      const faixa = q => q.gte('ocorreu_em', rel.periodoIni + 'T00:00:00').lte('ocorreu_em', rel.periodoFim + 'T23:59:59.999');
      // Atalho: se não há nada guardado nesse período (carga inicial), todos os registros são novos e não precisa listar as chaves.
      const cont = await faixa(st.sb.from('produtividade_eventos').select('id', { count: 'exact', head: true }));
      if (!cont.error && cont.count === 0) { i.novos = { novos: rel.eventos.length, guardados: 0 }; i.conferindo = false; return; }
      const ja = new Set((await todas((a, b) => faixa(st.sb.from('produtividade_eventos').select('chave')).order('id').range(a, b))).map(r => r.chave));
      const guardados = rel.eventos.filter(e => ja.has(e.chave)).length;
      i.novos = { novos: rel.eventos.length - guardados, guardados };
    } catch (e) { console.warn(e); i.novos = null; }
    i.conferindo = false;
  }
  async function lerRelatorio(arquivo) {
    const s = S(), i = s.imp; i.rel = null; i.erro = ''; i.novos = null; i.arquivo = '';
    if (arquivo) {
      try {
        const x = await M.lerXlsx(await arquivo.arrayBuffer());
        i.rel = X.lerRelatorio(x.linhas, s.equipe); i.arquivo = arquivo.name;
        if (!i.rel.eventos.length) throw new Error('Não encontrei nenhuma atividade das pessoas da lista neste arquivo. Confira a lista da equipe e o arquivo.');
        await conferirNovos(i.rel);
      } catch (e) { i.rel = null; i.erro = e.message || 'Não consegui ler o relatório.'; }
    }
    render();
  }
  P.painelProdGestao = function () {
    const s = S(), i = s.imp, r = i.rel;
    const por = r ? r.eventos.reduce((a, e) => { a[e.atividade] = (a[e.atividade] || 0) + e.total; return a; }, {}) : {};
    const previa = i.erro ? `<div class="aviso erro">${esc(i.erro)}</div>` : r ? `<div class="previa">
        <div><b>${nBR(r.eventos.length)} registros das pessoas da lista</b> em “${esc(i.arquivo)}”, de ${dBR(r.periodoIni)} a ${dBR(r.periodoFim)}.</div>
        <div class="small">Atividades pela regra do BI: ${ATIV.map(a => `${a === X.ATIV_DOC ? 'documentos' : a === X.ATIV_RETIF ? 'retificações' : 'tarefas'} <b class="mono">${nBR(por[a])}</b>`).join(' · ')} · total <b class="mono">${nBR(Object.values(por).reduce((x, y) => x + y, 0))}</b>.</div>
        <div class="small">${r.totalBi != null ? `Total da vara no BI: <b class="mono">${nBR(r.totalBi)}</b> ${r.totalOrigem === 'celula' ? '(célula “Totais” do arquivo' + (r.totalCalculado != null && r.totalCalculado !== r.totalCelula ? `; o cálculo pela regra do BI deu ${nBR(r.totalCalculado)}` : ', conferido pelo cálculo da regra do BI') + ')' : '(calculado pela regra do BI: tarefas e retificações somadas e documentos distintos por processo e segundo; o arquivo não traz a linha “Totais”)'}. ` : ''}${i.conferindo ? 'Conferindo o que já está guardado…' : i.novos ? `Novos: <b class="mono">${nBR(i.novos.novos)}</b> · já guardados: <b class="mono">${nBR(i.novos.guardados)}</b>.` : ''}</div>
        ${r.invalidas ? `<div class="aviso novo">${r.invalidas} linhas com data inválida foram ignoradas.</div>` : ''}
      </div>` : '';
    const hist = s.envios.slice(0, 8).map(e => `<tr><td>${esc(dataHoraBR(Date.parse(e.enviado_em)))}</td><td>${dBR(e.periodo_ini)} a ${dBR(e.periodo_fim)}</td><td class="n">${nBR(e.da_lista)}</td><td class="n">${nBR(e.novas)}</td><td class="n">${e.total_bi == null ? '—' : nBR(e.total_bi)}</td>
      <td>${i.remover === e.id ? `<button class="btn perigo" type="button" data-acao="pr-env-remover" data-id="${e.id}">Confirmar remoção</button> <button class="btn discreto" type="button" data-acao="pr-env-cancelar">Cancelar</button>` : `<button class="btn discreto" type="button" data-acao="pr-env-pedir" data-id="${e.id}">Remover</button>`}</td></tr>`).join('');
    return `<section class="painel" id="painel-prod-envio">
      <h2>Enviar produtividade do BI</h2>
      <p>No Portal BI (painel “Atuação de Magistrados e Servidores”, aba “Produtividade dos Servidores”), filtre pela serventia <b>PB - 2ª Vara Federal</b> e exporte a tabela “Atividades por Usuário” em Excel, com as colunas Usuário, Número Processo, Atividade, Tipo Atividade, Data Atividade e Total Atividades. Os envios se acumulam: o que já está guardado não é contado de novo, então não há problema em repetir dias. Para a carga inicial, envie em partes (por exemplo, um mês ou um trimestre por arquivo, na ordem que preferir): cada arquivo leva menos de um minuto e dá para conferir os totais de cada parte.</p>
      <label class="campo"><span>Relatório (.xlsx)</span><input type="file" id="pr-arq" accept=".xlsx"></label>
      ${previa}
      <div class="linha-botoes">
        <button class="btn primario" type="button" data-acao="pr-env-gravar" ${r && !i.gravando && !i.conferindo ? '' : 'disabled'}>${i.gravando ? 'Gravando…' : 'Gravar produtividade'}</button>
        ${r || i.erro ? '<button class="btn" type="button" data-acao="pr-env-limpar">Limpar</button>' : ''}
      </div>
      ${hist ? `<h3>Últimos envios</h3><div class="tabela-wrap"><table><thead><tr><th>Enviado em</th><th>Período</th><th>Da lista</th><th>Novos</th><th>Total BI</th><th></th></tr></thead><tbody>${hist}</tbody></table></div>
      <p class="small muted">Remover um envio apaga os registros que ele acrescentou. Os totais do dashboard são refeitos a cada envio ou remoção; se os números parecerem desatualizados, use “Recalcular totais”.</p>
      <div class="linha-botoes"><button class="btn discreto" type="button" data-acao="pr-env-recalcular" ${s.recalculando ? 'disabled' : ''}>${s.recalculando ? 'Recalculando…' : 'Recalcular totais'}</button></div>` : ''}
    </section>`;
  };

  async function gravarEnvio() {
    const s = S(), i = s.imp, r = i.rel; if (!r || i.gravando) return;
    i.gravando = true; render();
    let id = null;
    try {
      const ins = await st.sb.from('produtividade_envios').insert({
        enviado_por: st.email, arquivo: i.arquivo, periodo_ini: r.periodoIni, periodo_fim: r.periodoFim,
        lidas: r.lidas, da_lista: r.daLista, novas: 0, total_bi: r.totalBi,
      }).select('id').single();
      if (ins.error) throw ins.error;
      id = ins.data.id;
      let novas = 0;
      for (let k = 0; k < r.eventos.length; k += LOTE) {
        const lote = r.eventos.slice(k, k + LOTE).map(e => ({ chave: e.chave, envio_id: id, pessoa: e.pessoa, processo: e.processo, atividade: e.atividade, ocorreu_em: e.ocorreu_em, total: e.total }));
        const g = await st.sb.from('produtividade_eventos').upsert(lote, { onConflict: 'chave', ignoreDuplicates: true }).select('chave');
        if (g.error) throw g.error;
        novas += (g.data || []).length;
        const b = document.querySelector('[data-acao="pr-env-gravar"]'); if (b) b.textContent = `Gravando… ${Math.min(100, Math.round(((k + LOTE) / r.eventos.length) * 100))}%`;
      }
      // Os totais do dashboard ficam em tabelas prontas: refaz só o período deste envio (se falhar, o envio criado é desfeito abaixo).
      const rc = await st.sb.rpc('produtividade_recalcular', { p_ini: r.periodoIni, p_fim: r.periodoFim });
      if (rc.error) throw rc.error;
      const up = await st.sb.from('produtividade_envios').update({ novas }).eq('id', id);
      if (up.error) throw up.error;
      s.imp = { arquivo: '', rel: null, erro: '', novos: null, conferindo: false, gravando: false, remover: null };
      s.dadosEnvio = null; s.dias = null;
      await P.carregar(); toast(`Produtividade gravada: ${nBR(novas)} registros novos.`);
    } catch (e) {
      if (id != null) { try { await st.sb.from('produtividade_envios').delete().eq('id', id); } catch (e2) { console.error(e2); } }
      falha(e); i.gravando = false;
    }
    render();
  }
  async function removerEnvio(id) {
    const s = S(), env = s.envios.find(e => e.id === id);
    const { error } = await st.sb.from('produtividade_envios').delete().eq('id', id);
    if (error) throw error;
    s.imp.remover = null; s.dadosEnvio = null; s.dias = null;
    let aviso = 'Envio removido.';
    if (env && env.periodo_ini && env.periodo_fim) {
      const rc = await st.sb.rpc('produtividade_recalcular', { p_ini: env.periodo_ini, p_fim: env.periodo_fim });
      if (rc.error) { console.error(rc.error); aviso = 'Envio removido, mas não consegui atualizar os totais. Use “Recalcular totais”.'; }
    }
    toast(aviso); await P.carregar(); render();
  }
  // Refaz todos os totais do dashboard a partir dos registros guardados (reparo, caso os números pareçam desatualizados).
  async function recalcularTudo() {
    const s = S(); if (s.recalculando) return;
    s.recalculando = true; render();
    try {
      const rc = await st.sb.rpc('produtividade_recalcular', { p_ini: '1900-01-01', p_fim: '2100-12-31' });
      if (rc.error) throw rc.error;
      s.dadosEnvio = null; s.dias = null;
      toast('Totais recalculados.'); await P.carregar();
    } catch (e) { falha(e); }
    s.recalculando = false; render();
  }

  // eventos da Gestão (ações com prefixo pr-)
  const vg = $('#v-gestao');
  vg.addEventListener('input', e => {
    if (e.target.dataset && e.target.dataset.eq && e.target.type !== 'checkbox') editarEquipe(e.target);
  });
  vg.addEventListener('change', e => {
    if (e.target.id === 'pr-lista-arq') lerLista(e.target.files && e.target.files[0]);
    else if (e.target.id === 'pr-arq') lerRelatorio(e.target.files && e.target.files[0]);
    else if (e.target.dataset && e.target.dataset.eq && e.target.type === 'checkbox') editarEquipe(e.target);
  });
  vg.addEventListener('click', async e => {
    const a = e.target.closest('[data-acao]'); if (!a || !a.dataset.acao.startsWith('pr-')) return;
    const s = S(), eq = s.eq, acao = a.dataset.acao;
    try {
      if (acao === 'pr-eq-incluir') { if (!eq.rasc) eq.rasc = clonar(s.equipe); eq.rasc.push({ nome_bi: '', perfil: '', grupo: '', ordem: eq.rasc.length + 1, ativo: true }); marcarEquipe(); render(); const el = document.getElementById('eq-nome-' + (eq.rasc.length - 1)); if (el) el.focus(); }
      else if (acao === 'pr-eq-excluir') { if (!eq.rasc) eq.rasc = clonar(s.equipe); eq.rasc.splice(Number(a.dataset.i), 1); marcarEquipe(); render(); }
      else if (acao === 'pr-eq-descartar') { eq.rasc = null; eq.alterada = false; eq.erro = ''; render(); toast('Alterações na equipe descartadas.'); }
      else if (acao === 'pr-eq-salvar') await salvarEquipe();
      else if (acao === 'pr-env-gravar') await gravarEnvio();
      else if (acao === 'pr-env-limpar') { s.imp = { arquivo: '', rel: null, erro: '', novos: null, conferindo: false, gravando: false, remover: null }; render(); }
      else if (acao === 'pr-env-pedir') { s.imp.remover = Number(a.dataset.id); render(); }
      else if (acao === 'pr-env-cancelar') { s.imp.remover = null; render(); }
      else if (acao === 'pr-env-remover') await removerEnvio(Number(a.dataset.id));
      else if (acao === 'pr-env-recalcular') await recalcularTudo();
    } catch (err) { falha(err); }
  });
})();
