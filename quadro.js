/* Fila de Trabalho da Vara: quadro de avisos "Regras da fila" (lógica pura, sem DOM; testável em Node).
   O quadro é montado a partir da configuração que o Gestor edita (config geral, tabela de tarefas, prioridade e urgência,
   recado), só com as regras que valem para a pessoa. Cada regra vira um item com id estável e um texto de comparação ("cmp")
   que não usa nomes de pessoas (renomear alguém não conta como mudança de regra). O que a pessoa viu fica guardado
   (preferencias.quadro_visto) e a comparação aponta o que é novo, o que mudou e o que deixou de valer. */
(function (raiz) {
  'use strict';

  const SETORES = [
    ['secretaria', 'Secretaria'], ['triagem', 'Triagem inicial'], ['comunicacao', 'Comunicação'],
    ['pagamentos', 'Pagamentos'], ['pericia', 'Perícia'], ['audiencia', 'Audiência'],
  ];
  const NOME_SETOR = Object.fromEntries(SETORES);
  const SETORES_EVENTUAL = ['comunicacao', 'pagamentos'];
  const COM_FILA = ['servidor', 'estagiario', 'residente', 'diretor', 'eventual'];

  // Seções do quadro, na ordem em que aparecem.
  const SECOES = [
    ['recado', 'Recado do Gestor'],
    ['seus', 'Quais processos são seus'],
    ['ordem', 'O que aparece primeiro'],
    ['urgente', 'Contam como urgentes'],
    ['prioritaria', 'Contam como prioritárias'],
    ['tempo', 'Regras de tempo'],
  ];

  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const alternativas = s => String(s || '').split('|').map(x => x.trim()).filter(Boolean);
  const aspas = s => '“' + s + '”';
  const listaE = xs => xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' e ' + xs[xs.length - 1];
  const nomeSetor = id => NOME_SETOR[id] || id;
  const dias = n => n + (n === 1 ? ' dia' : ' dias');

  // Algarismos [0, 1, 2, 4] -> "0 a 2 e 4".
  function faixasTexto(ds) {
    const ord = [...new Set(ds)].sort((a, b) => a - b), partes = [];
    for (let i = 0; i < ord.length; i++) {
      let j = i;
      while (j + 1 < ord.length && ord[j + 1] === ord[j] + 1) j++;
      if (j - i >= 2) partes.push(ord[i] + ' a ' + ord[j]);
      else for (let k = i; k <= j; k++) partes.push(String(ord[k]));
      i = j;
    }
    return listaE(partes);
  }

  // Setores em que a pessoa recebe processos pela divisão (algarismo ou responsável fixo).
  function setoresDaPessoa(geral, pessoa) {
    const out = [];
    for (const [id] of SETORES) {
      const s = ((geral && geral.setores) || {})[id];
      if (!s) continue;
      if (s.modo === 'fixo' ? s.responsavel === pessoa : (s.faixas || []).includes(pessoa)) out.push(id);
    }
    return out;
  }

  // Texto do alcance de uma exceção: "em Pagamentos", "nas tarefas X", ou nada (todos os setores, todas as tarefas).
  function alcance(r) {
    const p = [];
    if (r.setores && r.setores.length) p.push('em ' + listaE(r.setores.map(nomeSetor)));
    const t = alternativas(r.tarefas);
    if (t.length) p.push((t.length === 1 ? 'na tarefa ' : 'nas tarefas ') + listaE(t.map(aspas)));
    return p.length ? ' (' + p.join(', ') + ')' : '';
  }
  const quemCasa = r => (r.campo === 'etiqueta' ? (alternativas(r.padrao).length > 1 ? 'Etiquetas ' : 'Etiqueta ') : (alternativas(r.padrao).length > 1 ? 'Classes ' : 'Classe ')) + listaE(alternativas(r.padrao).map(aspas));

  // Itens do quadro. dados: { geral, tarefas, etPri, recado, resumo, nomes }; pessoa: id da pessoa (ou '' para a visão
  // de toda a vara); perfil: perfil de quem vê (ou o tipo da pessoa no "Ver como").
  function montarQuadro(dados, pessoa, perfil) {
    const d = dados || {};
    const geral = d.geral || {}, tarefas = d.tarefas || [], etPri = d.etPri || [], nomes = d.nomes || {};
    const todos = !pessoa || !COM_FILA.includes(perfil);
    const itens = [];
    const add = (secao, id, texto, cmp, extra) => itens.push(Object.assign({ secao, id, texto, cmp: cmp == null ? texto : cmp }, extra || {}));

    const recado = String(d.recado || '').trim();
    if (recado) add('recado', 'recado', recado);

    // Setores que interessam: os da pessoa (para servidor eventual, Comunicação e Pagamentos); na visão geral, todos.
    let setores = todos ? SETORES.map(s => s[0]) : setoresDaPessoa(geral, pessoa);
    if (!todos && perfil === 'eventual') setores = [...new Set([...setores, ...SETORES_EVENTUAL])];

    // ---- Quais processos são seus ----
    if (!todos) {
      if (perfil === 'eventual') {
        add('seus', 'eventual', 'Você vê os processos de Comunicação e Pagamentos de todos os servidores (aba Eventual) e pode receber urgências desses setores.');
      }
      for (const id of setoresDaPessoa(geral, pessoa)) {
        const s = geral.setores[id];
        if (s.modo === 'fixo') add('seus', 'setor:' + id, 'Todos os processos das tarefas de ' + nomeSetor(id) + '.', 'fixo:' + id);
        else {
          const ds = (s.faixas || []).map((p, i) => (p === pessoa ? i : -1)).filter(i => i >= 0);
          add('seus', 'setor:' + id, 'Processos das tarefas de ' + nomeSetor(id) + ' cujo 7º algarismo do número é ' + faixasTexto(ds) + '.', 'digito:' + id + ':' + ds.join(','));
        }
      }
      const fixo = ((d.resumo && d.resumo.fixos) || {})[pessoa];
      if (fixo) add('seus', 'fixa', 'O Gestor envia uma lista do PJe só para você: todos os processos dela entram na sua fila, e as exceções por classe ou etiqueta não valem nela.');
      if (perfil === 'diretor') {
        const ets = (geral.etiquetasDiretor || []).filter(x => x && x.e);
        for (const x of ets) add('seus', 'dir:' + norm(x.e), 'Processos com a etiqueta ' + aspas(x.e) + ', em qualquer tarefa' + (x.u ? ' (entram como urgentes).' : '.'), 'dir:' + norm(x.e) + ':' + (x.u ? 'u' : ''));
      }
      // Exceções por classe ou etiqueta que trazem processos para a pessoa ou levam processos dos setores dela.
      (geral.regrasClasse || []).forEach(r => {
        if (!r || !r.padrao || !(r.responsavel || r.setorDestino)) return;
        const id = 'exc:' + (r.campo === 'etiqueta' ? 'etiqueta' : 'classe') + ':' + norm(r.padrao) + ':' + (r.setores || []).join(',') + ':' + norm(r.tarefas);
        const vale = !(r.setores && r.setores.length) || r.setores.some(s => setores.includes(s));
        const base = quemCasa(r) + alcance(r);
        let texto = null, cmp = null;
        if (r.responsavel === pessoa) texto = base + ': vêm para a sua fila, mesmo fora da divisão por algarismo.';
        else if (r.setorDestino && setores.includes(r.setorDestino) && !(r.setores || []).includes(r.setorDestino)) texto = base + ': vão para o setor ' + nomeSetor(r.setorDestino) + ' e seguem a divisão dele.';
        else if (vale && r.setorDestino) texto = base + ': saem do seu setor e vão para ' + nomeSetor(r.setorDestino) + '.';
        else if (r.responsavel && (r.setores || []).some(s => setores.includes(s))) {   // só quando a exceção cita o setor (as de "todos os setores" poluiriam o quadro de todos)
          texto = base + ': vão para ' + (nomes[r.responsavel] || 'outra pessoa') + ', fora da divisão por algarismo.';
          cmp = base + ': vão para #' + r.responsavel;   // sem o nome: renomear a pessoa não é mudança de regra
        }
        if (texto) add('seus', id, texto, cmp);
      });
      if (!itens.some(x => x.secao === 'seus')) add('seus', 'nenhuma', 'No momento nenhuma regra de distribuição aponta para você. Os processos chegam por envio de urgência ou de devolução.');
    } else {
      add('seus', 'divisao', 'Cada setor é dividido entre os servidores pelo 7º algarismo do número do processo, ou tem um responsável fixo. Exceções por classe ou etiqueta valem antes da divisão (a primeira que casar decide).');
    }

    // ---- O que aparece primeiro (fixo no código) ----
    add('ordem', 'ordem', 'Urgências, depois Devolvidos, depois Prioritárias e por fim Na fila. Em cada grupo, primeiro os processos com anotação; depois, do mais antigo para o mais novo, pela chegada na tarefa.');

    // ---- Urgentes e prioritárias: classes e etiquetas cadastradas e tarefas marcadas ----
    const doSetor = x => !x.st || setores.includes(x.st);
    const ondeSetor = x => (x.st ? ' (só em ' + nomeSetor(x.st) + ')' : '');
    for (const x of etPri) {
      if (!x || !x.e || !doSetor(x)) continue;
      const sec = x.t === 'urgente' ? 'urgente' : 'prioritaria';
      if (x.k === 'classe') {
        const rot = x.s && x.d ? x.s + ' · ' + x.d : (x.d || x.s || x.e);
        add(sec, sec + ':classe:' + (x.cod != null ? x.cod : norm(x.s || x.e)) + ':' + (x.st || ''), rot + ondeSetor(x), sec + ':classe:' + (x.cod != null ? x.cod : norm(x.s || x.e)) + ':' + (x.st || ''), { grupo: 'Classes', chip: x.s || x.d || x.e });
      } else {
        for (const e of alternativas(x.e)) add(sec, sec + ':etiqueta:' + norm(e) + ':' + (x.st || ''), e + ondeSetor(x), null, { grupo: 'Etiquetas', chip: e });
      }
    }
    for (const t of tarefas) {
      if (!t || !t.tarefa || !t.painel || !setores.includes(t.painel)) continue;
      const onde = todos ? ' (' + nomeSetor(t.painel) + ')' : '';
      if (t.urgente) add('urgente', 'urgente:tarefa:' + norm(t.tarefa), t.tarefa + onde, null, { grupo: 'Tarefas', chip: t.tarefa });
      else if (t.zerar) add('prioritaria', 'prioritaria:tarefa:' + norm(t.tarefa), t.tarefa + onde, null, { grupo: 'Tarefas', chip: t.tarefa });
      if (!t.urgente && t.etiquetaUrgente) {
        const ets = alternativas(t.etiquetaUrgente);
        add('urgente', 'urgente:tarefa-etiqueta:' + norm(t.tarefa), 'Na tarefa ' + aspas(t.tarefa) + ', quando tiver ' + (ets.length > 1 ? 'uma das etiquetas ' : 'a etiqueta ') + listaE(ets.map(aspas)) + onde, null, { grupo: 'Tarefas com etiqueta' });
      }
    }
    // Urgência pela Inspeção Integrada do BI (fixa no código; decisão do Alberto, 24/11/2026). Texto em inspecao.js (REGRA_URGENCIA).
    const regraInsp = raiz.Inspecao && raiz.Inspecao.REGRA_URGENCIA;
    if (regraInsp) add('urgente', 'urgente:inspecao', regraInsp, 'urgente:inspecao:alto-medio-20-20', { grupo: 'Inspeção Integrada (BI)' });
    if (itens.some(x => x.secao === 'urgente') && itens.some(x => x.secao === 'prioritaria')) add('prioritaria', 'urgente-vence', 'Se um processo é urgente e prioritário ao mesmo tempo, vale a urgência.', null, { nota: true });

    // ---- Regras de tempo ----
    for (const t of tarefas) {
      const n = Math.floor(Number(t && t.aposDias)) || 0;
      if (!t || !t.tarefa || !t.painel || n <= 0 || !setores.includes(t.painel)) continue;
      add('tempo', 'tempo:' + norm(t.tarefa), 'Processos na tarefa ' + aspas(t.tarefa) + ' há mais de ' + dias(n) + ' entram na fila' + (todos || setores.length > 1 ? ' de ' + nomeSetor(t.painel) : ' do seu setor') + '. Antes disso, não aparecem.', 'tempo:' + norm(t.tarefa) + ':' + n + ':' + t.painel);
    }
    const ru = Number(geral.retornoUrgente) || 15, rd = Number(geral.retornoDemais) || 30;
    add('tempo', 'retorno', 'Processo concluído que continua na mesma tarefa volta para a fila depois de ' + dias(ru) + ' (urgentes) ou ' + dias(rd) + ' (demais).', 'retorno:' + ru + ':' + rd);

    return itens;
  }

  // O que a pessoa viu: { data, itens: { id: [cmp, texto] } }.
  function fotografia(itens, agora) {
    const o = {};
    for (const x of itens || []) o[x.id] = [x.cmp, x.texto];
    return { data: agora == null ? Date.now() : agora, itens: o };
  }

  // Compara o quadro de hoje com o que a pessoa viu. Sem nada guardado (primeira vez), não há novidade.
  // Devolve { novos: Set(id), alterados: Map(id -> texto anterior), removidos: [{ id, texto }], total }.
  function compararQuadro(itens, visto) {
    const r = { novos: new Set(), alterados: new Map(), removidos: [], total: 0 };
    const antes = visto && visto.itens;
    if (!antes) return r;
    const atuais = new Set();
    for (const x of itens || []) {
      atuais.add(x.id);
      const v = antes[x.id];
      if (!v) r.novos.add(x.id);
      else if (v[0] !== x.cmp) r.alterados.set(x.id, v[1]);
    }
    for (const [id, v] of Object.entries(antes)) if (!atuais.has(id)) r.removidos.push({ id, texto: v[1] });
    r.total = r.novos.size + r.alterados.size + r.removidos.length;
    return r;
  }

  // Seção de um id (para agrupar o que deixou de valer).
  const secaoDoId = id => {
    const p = String(id).split(':')[0];
    return SECOES.some(s => s[0] === p) ? p : ({ setor: 'seus', fixa: 'seus', dir: 'seus', exc: 'seus', eventual: 'seus', nenhuma: 'seus', divisao: 'seus', retorno: 'tempo', 'urgente-vence': 'prioritaria' })[p] || 'seus';
  };

  const api = { SECOES, montarQuadro, compararQuadro, fotografia, secaoDoId, faixasTexto, setoresDaPessoa };
  raiz.Quadro = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
