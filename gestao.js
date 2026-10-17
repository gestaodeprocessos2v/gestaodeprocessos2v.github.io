/* Fila de Trabalho da Vara — Parte 2: aba Gestão (somente o gestor; o banco também confere isso por RLS). */
(function () {
  'use strict';
  const P = window.PAINEL;
  if (!P || !P.render) return;
  const { st, R, SETORES, NOME_SETOR, TIPOS, ROTULO_TIPO, PERFIS, DIA, esc, dataBR, dataHoraBR, toast, falha, todas, iso, ms, pessoas, nomeDe, opcoesPessoas, opcoesTipo, baixar } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const PERFIS_OUTROS = ['gestor', 'magistrado', 'visitante'];
  const GESTOR_ID = R.GESTOR_ID;
  const DIRETORIA = 'diretoria';   // destino da urgência do gestor: o diretor de secretaria
  const clonar = o => JSON.parse(JSON.stringify(o));
  const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Rascunho da configuração: pessoas (com e-mail, vindo de `acesso`) e outros acessos (sem fila).
  function prepararRascunho() {
    if (!st.rascunho) st.rascunho = st.config ? clonar(st.config) : { pessoas: [], setores: {}, regrasClasse: [] };
    if (st.rascOutros) return;
    const porPessoa = Object.fromEntries(st.acessos.filter(a => a.pessoa_id).map(a => [a.pessoa_id, a.email]));
    for (const p of st.rascunho.pessoas || []) if (p.email == null) p.email = porPessoa[p.id] || '';
    st.rascOutros = st.acessos.filter(a => !a.pessoa_id).map(a => ({ nome: a.nome, email: a.email, perfil: a.perfil }));
  }

  // Guarda o que o gestor digitou antes de redesenhar (os dados recarregam a qualquer momento).
  function capturarGestao() {
    if (!document.getElementById('urg-numero')) return;
    lerRascunho();
    st.novaUrgencia = Object.assign({}, st.novaUrgencia, { numero: $('#urg-numero').value, setor: $('#urg-setor').value, motivo: $('#urg-motivo').value });
    if ($('#urg-setor').dataset.desenhado === $('#urg-setor').value) st.novaUrgencia.responsavel = $('#urg-resp').value;
    st.novaPessoa = $('#cfg-nova-pessoa').value;
  }

  P.renderGestao = function () {
    const v = $('#v-gestao');
    if (st.perfil !== 'gestor') { v.innerHTML = ''; return; }
    capturarGestao();
    prepararRascunho();
    const foco = document.activeElement && document.activeElement.id;
    // Os campos de arquivo são recriados vazios a cada desenho; os que ainda têm arquivo lido são mantidos.
    const mi = st.metasImp, imp = st.importacao, ji = st.jdImp;
    const manter = [['imp-arquivo', imp && (imp.resultado || imp.erro)], ['jd-arquivo', ji && (ji.resumo || ji.erro)],['metas-arq-resumo', mi && (mi.resumo || mi.erroResumo)], ['metas-arq-pend', mi && (mi.pendentes || mi.erroPendentes)]]
      .map(([id, ativo]) => { const el = ativo && document.getElementById(id); return el && el.files && el.files.length ? el : null; }).filter(Boolean);
    v.innerHTML = `<div class="paineis">
      ${P.htmlGestorFila()}
      ${painelImportar()}
      ${P.painelJDGestao ? P.painelJDGestao() : ''}
      ${P.painelMetasGestao ? P.painelMetasGestao() : ''}
      ${painelUrgencia()}
      ${painelResumo()}
      ${painelAcessosNegados()}
      ${painelManutencao()}
      ${painelTarefas()}
      ${painelConfig()}
    </div>`;
    manter.forEach(el => { const novo = document.getElementById(el.id); if (novo) novo.replaceWith(el); });
    if (foco) { const el = document.getElementById(foco); if (el && el.tagName !== 'BUTTON') el.focus(); }
  };

  // ---------- importação ----------
  function painelImportar() {
    const imp = st.importacao || {};
    const destinoOpc = `<option value="">Pelas regras (setor da tarefa + divisão da vara)</option>${opcoesPessoas(imp.pessoaFixa || '', null)}`;
    let previa = '';
    if (imp.erro) previa = `<div class="aviso erro">${esc(imp.erro)}</div>`;
    else if (imp.resultado) {
      const r = imp.resultado;
      const conta = (its, tipo) => its.filter(i => R.tipoItem(i, st.mapaTarefas) === tipo).length;
      const linhas = Object.entries(r.porPessoa).sort((a, b) => b[1].length - a[1].length)
        .map(([p, its]) => `<tr><td>${esc(nomeDe(p))}</td><td class="n">${its.length}</td><td class="n">${conta(its, 'urgente')}</td><td class="n">${conta(its, 'prioritaria')}</td></tr>`).join('');
      const setores = SETORES.filter(([id]) => r.porSetor[id]).map(([id, n]) => `${n}: <b class="mono">${r.porSetor[id]}</b>`).join(' · ');
      const sem = r.semResponsavel.length ? `<div class="aviso erro"><b>${r.semResponsavel.length} sem responsável</b> e não serão gravados: ${r.semResponsavel.slice(0, 6).map(i => `${esc(i.n)} (${esc(i.motivo)})`).join('; ')}${r.semResponsavel.length > 6 ? '…' : ''}. Ajuste a configuração e leia o arquivo de novo.</div>` : '';
      previa = `<div class="previa">
        <div><b>${imp.lidos} linhas lidas</b> em “${esc(imp.arquivo)}”.</div>
        <div class="small">Por setor: ${setores || '—'}</div>
        ${!imp.pessoaFixa ? `<div class="small">Outros setores da vara (sem fila de servidor): <b class="mono">${(r.outros || []).length}</b> processos, guardados só para as Metas CNJ.</div>` : ''}
        <div class="small muted">Ignorados: ${r.ignorados.foraDaVara} em tarefas de outros setores${r.ignorados.semEtiqueta ? ` e ${r.ignorados.semEtiqueta} sem a etiqueta exigida pela tarefa` : ''}.${imp.semData ? ` ${imp.semData} sem data de chegada vão para o fim da fila.` : ''}</div>
        <div class="tabela-wrap"><table><thead><tr><th>Pessoa</th><th>Processos</th><th>Urgentes</th><th>Prioritários</th></tr></thead><tbody>${linhas || '<tr><td colspan="4">Nenhum processo para gravar.</td></tr>'}</tbody></table></div>
        ${sem}
        ${especiaisPrevia(imp)}
        <div class="linha-botoes">
          <button class="btn primario" data-acao="gravar-importacao" ${st.gravando || (!Object.keys(r.porPessoa).length && !temEspeciais(imp)) ? 'disabled' : ''}>${st.gravando ? 'Gravando…' : 'Gravar e substituir a lista'}</button>
          <button class="btn" data-acao="cancelar-importacao">Cancelar</button>
        </div>
      </div>`;
    }
    const semTabela = !st.tarefas.length ? `<div class="aviso erro">Cadastre a tabela de tarefas (painel “Tarefas do PJe”) antes de enviar o relatório: é ela que diz o setor de cada processo.</div>` : '';
    return `<section class="painel">
      <h2>Enviar relatório do PJe+R</h2>
      <p>Envie a lista completa de processos. O setor de cada processo vem da tarefa em que ele está, pela tabela de tarefas; processos de outros setores são ignorados nas filas dos servidores. As urgências e as prioritárias seguem o relatório: quem não está na lista nova sai da fila. Só as urgências incluídas aqui na Gestão e as enviadas entre pessoas ficam até serem concluídas. As filas do diretor e do gestor são escolhidas só por etiqueta, em qualquer tarefa, e são refeitas a cada envio.</p>
      ${semTabela}
      <label class="campo"><span>Distribuir</span><select id="imp-destino">${destinoOpc}</select></label>
      <label class="campo"><span>Arquivo CSV</span><input type="file" id="imp-arquivo" accept=".csv,text/csv,text/plain"></label>
      ${previa}
    </section>`;
  }

  const temEspeciais = imp => !!imp.especiais && (imp.especiais.diretor.length > 0 || imp.especiais.gestor.length > 0);
  function especiaisPrevia(imp) {
    const e = imp.especiais; if (!e || imp.pessoaFixa) return '';
    const diretores = pessoas().filter(p => p.tipo === 'diretor');
    const linhas = [];
    if (diretores.length) linhas.push(`Diretor de Secretaria: <b class="mono">${e.diretor.length}</b> processos, ${e.diretor.filter(i => i.u).length} urgentes (por etiqueta)`);
    linhas.push(`Gestor: <b class="mono">${e.gestor.length}</b> processos (etiqueta “${esc(st.config.etiquetaGestor == null ? R.ETIQUETA_GESTOR_PADRAO : st.config.etiquetaGestor)}”)`);
    return `<div class="small">${linhas.join(' · ')}</div>`;
  }

  async function lerArquivo(arquivo) {
    const buf = await arquivo.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('windows-1252').decode(buf); }
  }

  async function prepararImportacao() {
    const input = $('#imp-arquivo');
    const arquivo = input && input.files && input.files[0];
    const pessoaFixa = $('#imp-destino').value;
    st.importacao = { pessoaFixa };
    if (!arquivo) { render(); return; }
    try {
      if (!st.tarefas.length) throw new Error('A tabela de tarefas está vazia. Cadastre as tarefas antes de enviar o relatório.');
      const lido = R.lerCsv(await lerArquivo(arquivo));
      Object.assign(st.importacao, {
        arquivo: arquivo.name, lidos: lido.itens.length, semData: lido.semData,
        resultado: R.prepararLista(lido.itens, st.mapaTarefas, st.config, pessoaFixa || null),
        especiais: pessoaFixa ? null : R.prepararEspeciais(lido.itens, st.config),
      });
    } catch (e) {
      st.importacao.erro = e.message || 'Não consegui ler o arquivo.';
    }
    render();
  }

  const itemMin = it => { const o = {}; for (const k of ['n', 'c', 't', 'cg', 'ch', 's', 'sg', 'u', 'et']) if (it[k] != null) o[k] = it[k]; return o; };

  // As urgentes da lista seguem a lista: saem quando o processo sai do relatório novo. Só ficam até o servidor concluir
  // as urgências incluídas à mão (gestor) e as enviadas para outra pessoa. Aqui some o que antigas versões gravaram como "da lista".
  async function limparUrgenciasDaLista() {
    const { error } = await st.sb.from('urgencias').delete().eq('origem', 'lista');
    if (error) throw error;
  }

  async function gravarImportacao() {
    const imp = st.importacao; if (!imp || !imp.resultado || st.gravando) return;
    st.gravando = true; render();
    const sb = st.sb, agora = Date.now(), I = iso(agora);
    const fixa = imp.pessoaFixa || '';
    const porPessoa = imp.resultado.porPessoa;
    try {
      await P.carregar(); // anotações, conclusões e listas atuais: a regra dos processos anotados depende delas
      const resumo = clonar(st.resumo || {}); resumo.fixos = resumo.fixos || {};
      const fixos = resumo.fixos;
      const idsEspeciais = new Set([GESTOR_ID, ...pessoas().filter(p => p.tipo === 'diretor').map(p => p.id)]);
      const existentes = [...new Set(st.filas.map(r => r.pessoa))].filter(p => !idsEspeciais.has(p));
      // pessoas afetadas: na lista "para uma pessoa", só ela; nas demais, todas menos as que têm lista própria
      const alvo = new Set(fixa ? [fixa] : [...existentes, ...Object.keys(porPessoa)].filter(p => !fixos[p] && !idsEspeciais.has(p)));
      const gravar = Object.entries(porPessoa).filter(([p]) => (fixa || !fixos[p]) && !idsEspeciais.has(p));
      const doPessoa = (lista, p) => (st.filas.find(r => r.lista === lista && r.pessoa === p) || {}).itens || [];
      // Processo com anotação e não concluído não some quando sai do arquivo novo: fica (como "Saiu da lista") até ser concluído ou a anotação ser excluída.
      const anotados = (p, presentes) => R.guardarAnotados([...doPessoa('semanal', p), ...doPessoa('diaria', p)], presentes, st.notas[p], st.marcas[p]);
      const rows = gravar.map(([p, itens]) => {
        const vistos = new Map([...doPessoa('semanal', p), ...doPessoa('diaria', p)].map(i => [R.chaveItem(i), i.vistoEm]));
        const marcados = itens.map(it => R.tipoItem(it, st.mapaTarefas) !== 'normal' ? Object.assign({}, it, { vistoEm: vistos.get(R.chaveItem(it)) || agora }) : it);
        return { lista: 'semanal', pessoa: p, itens: marcados.concat(anotados(p, itens)), importado_em: I };
      });
      // quem não recebeu nada no arquivo novo mas tem processo anotado ainda ativo mantém só esses
      for (const p of alvo) {
        if (rows.some(r => r.pessoa === p)) continue;
        const sobra = anotados(p, []);
        if (sobra.length) rows.push({ lista: 'semanal', pessoa: p, itens: sobra, importado_em: I });
      }
      for (const row of rows) {
        const { error } = await sb.from('filas').upsert(row, { onConflict: 'lista,pessoa' });
        if (error) throw error;
      }
      const gravadas = new Set(rows.map(r => r.pessoa));
      const semNovo = [...alvo].filter(p => !gravadas.has(p));
      // a lista completa substitui tudo: some o que saiu do PJe (exceto os processos anotados, que já foram para a lista) e qualquer resíduo da antiga atualização diária
      const semNovoSem = semNovo.filter(p => !rows.some(r => r.pessoa === p));
      if (semNovoSem.length) { const { error } = await sb.from('filas').delete().eq('lista', 'semanal').in('pessoa', semNovoSem); if (error) throw error; }
      if (alvo.size) { const { error } = await sb.from('filas').delete().eq('lista', 'diaria').in('pessoa', [...alvo]); if (error) throw error; }
      // Filas do diretor e do gestor (por etiqueta): cada envio refaz a lista inteira e descarta resíduo da antiga atualização diária.
      if (imp.especiais && !fixa) {
        const dest = [[GESTOR_ID, imp.especiais.gestor], ...pessoas().filter(p => p.tipo === 'diretor').map(p => [p.id, imp.especiais.diretor])];
        for (const [pessoa, itens] of dest) {
          const vistos = new Map([...doPessoa('semanal', pessoa), ...doPessoa('diaria', pessoa)].map(i => [R.chaveItem(i), i.vistoEm]));
          const marcados = itens.map(it => Object.assign({}, it, { vistoEm: vistos.get(R.chaveItem(it)) || agora })).concat(anotados(pessoa, itens));
          const { error: e1 } = await sb.from('filas').upsert({ lista: 'semanal', pessoa, itens: marcados, importado_em: I }, { onConflict: 'lista,pessoa' });
          if (e1) throw e1;
          const { error: e2 } = await sb.from('filas').delete().eq('lista', 'diaria').eq('pessoa', pessoa);
          if (e2) throw e2;
        }
      }
      // Lista completa para todos: guarda também os processos de tarefas sem fila de servidor, só para a aba Pendentes das Metas CNJ.
      if (!fixa) {
        const { error: eo } = await sb.from('fora_vara').upsert({ id: 1, itens: imp.resultado.outros || [], importado_em: I, atualizado_por: st.email }, { onConflict: 'id' });
        if (eo) { console.error(eo); toast('A lista foi gravada, mas não consegui guardar os processos de outros setores (Metas CNJ).'); }
        else st.metas.foraEm = 0;
      }
      await limparUrgenciasDaLista();
      const total =gravar.reduce((s, [, x]) => s + x.length, 0);
      const info = { em: agora, total, porPessoa: Object.fromEntries(gravar.map(([p, x]) => [p, x.length])) };
      if (fixa) fixos[fixa] = { em: agora, total };
      else resumo.semanal = info;
      delete resumo.diaria;
      const { error } = await sb.from('config').upsert({ chave: 'resumo', valor: resumo, atualizado_em: I, atualizado_por: st.email }, { onConflict: 'chave' });
      if (error) throw error;
      toast('Lista gravada.');
      st.importacao = { pessoaFixa: imp.pessoaFixa };
      await P.carregar();
    } catch (e) { falha(e); }
    st.gravando = false; render();
  }

  // ---------- urgência manual ----------
  function painelUrgencia() {
    // só as incluídas à mão aqui; as que vêm das listas ficam nas filas, sem aparecer nesta seção
    const manuais = st.urgencias.filter(u => u.via === 'gestor');
    const abertas = manuais.filter(u => !u.concluidaEm).sort((a, b) => (a.criadaEm || 0) - (b.criadaEm || 0));
    const recentes = manuais.filter(u => u.concluidaEm).sort((a, b) => b.concluidaEm - a.concluidaEm).slice(0, 8);
    const origem = u => (u.via === 'envio' ? ` <span class="muted small">(enviada por ${esc(nomeDe(u.remetente))})</span>` : u.via === 'lista' ? ' <span class="muted small">(da lista)</span>' : '');
    const linha = u => `<tr><td class="mono">${esc(R.formatarCNJ(u.numero))}</td><td>${esc(nomeDe(u.responsavel))}${origem(u)}</td><td>${esc(u.motivo || '')}</td><td>${u.concluidaEm ? 'Concluída ' + dataBR(u.concluidaEm) : 'Aberta desde ' + dataBR(u.criadaEm)}</td>
      <td>${st.confirmarRemocao === u.id ? `<button class="btn perigo" data-acao="remover-urgencia" data-id="${esc(u.id)}">Confirmar</button>` : `<button class="btn" data-acao="pedir-remocao" data-id="${esc(u.id)}">Remover</button>`}</td></tr>`;
    const ur = st.novaUrgencia || {};
    const setorUrg = ur.setor || 'secretaria';
    const doSetor = pessoasDoDestino(setorUrg);
    const respOpc = doSetor.length
      ? `<option value="">Escolha</option>` + doSetor.map(id => `<option value="${esc(id)}"${id === ur.responsavel ? ' selected' : ''}>${esc(nomeDe(id))}</option>`).join('')
      : `<option value="">${setorUrg === DIRETORIA ? 'Cadastre o Diretor de Secretaria na configuração' : 'Nenhuma pessoa atende este setor — ajuste a configuração'}</option>`;
    return `<section class="painel">
      <h2>Incluir urgência</h2>
      <p>A urgência vai para o topo da fila do responsável (servidor ou Diretor de Secretaria) e fica lá até ele marcar como concluída.</p>
      <form id="form-urgencia" class="campos">
        <label class="campo"><span>Número do processo</span><input type="text" id="urg-numero" class="mono" inputmode="numeric" placeholder="0000000-00.0000.0.00.0000" value="${esc(ur.numero || '')}" required></label>
        <label class="campo"><span>Setor</span><select id="urg-setor" data-desenhado="${esc(setorUrg)}">${SETORES.map(([id, n]) => `<option value="${id}"${id === setorUrg ? ' selected' : ''}>${n}</option>`).join('')}<option value="${DIRETORIA}"${setorUrg === DIRETORIA ? ' selected' : ''}>Diretor de Secretaria</option></select></label>
        <label class="campo"><span>Responsável</span><select id="urg-resp" required>${respOpc}</select></label>
        <label class="campo"><span>Motivo</span><input type="text" id="urg-motivo" maxlength="300" placeholder="Ex.: e-mail da procuradoria, pedido do juiz" value="${esc(ur.motivo || '')}"></label>
        <div class="linha-botoes"><button class="btn primario" type="submit">Incluir urgência</button></div>
      </form>
      <h3>Abertas <span class="muted mono">${abertas.length}</span></h3>
      <div class="tabela-wrap"><table><thead><tr><th>Processo</th><th>Responsável</th><th>Motivo</th><th>Situação</th><th></th></tr></thead>
      <tbody>${abertas.map(linha).join('') || '<tr><td colspan="5" class="muted">Nenhuma urgência aberta.</td></tr>'}</tbody></table></div>
      ${recentes.length ? `<h3>Concluídas recentemente</h3><div class="tabela-wrap"><table><tbody>${recentes.map(linha).join('')}</tbody></table></div>` : ''}
    </section>`;
  }

  // Quem pode receber urgência em cada destino: pessoas do setor (pelas regras) ou o diretor de secretaria.
  const pessoasDoDestino = setor => setor === DIRETORIA ? pessoas().filter(p => p.tipo === 'diretor').map(p => p.id) : R.pessoasDoSetor(setor, st.config || {});

  async function aoIncluirUrgencia(ev) {
    ev.preventDefault();
    const numero = R.soDigitos($('#urg-numero').value);
    const responsavel = $('#urg-resp').value, setor = $('#urg-setor').value;
    if (numero.length !== 20) { toast('O número do processo deve ter 20 dígitos (padrão CNJ).'); return; }
    if (!responsavel) { toast('Escolha o responsável.'); return; }
    if (!pessoasDoDestino(setor).includes(responsavel)) { toast('Esse responsável não atende o setor escolhido.'); return; }
    try {
      const { error } = await st.sb.from('urgencias').insert({
        numero, responsavel, origem: 'gestor', motivo: $('#urg-motivo').value.trim() || null, item: setor === DIRETORIA ? {} : { s: setor }, criada_por: st.email,
      });
      if (error) { if (error.code === '23505') { toast('Esse processo já está como urgência aberta para essa pessoa.'); return; } throw error; }
      st.novaUrgencia = { setor }; toast('Urgência incluída para ' + nomeDe(responsavel) + '.');
      await P.carregar(); render();
    } catch (e) { falha(e); }
  }

  function sugerirResponsavel() {
    const numero = $('#urg-numero').value, setor = $('#urg-setor').value;
    const doSetor = pessoasDoDestino(setor);
    let responsavel = $('#urg-resp').value;
    if (!doSetor.includes(responsavel)) responsavel = doSetor.length === 1 ? doSetor[0] : '';
    st.novaUrgencia = { numero, setor, motivo: $('#urg-motivo').value, responsavel };
    if (R.soDigitos(numero).length >= 7 && setor !== DIRETORIA) {
      const r = R.atribuir({ n: numero }, setor, st.config || {});
      if (r.pessoa && doSetor.includes(r.pessoa)) st.novaUrgencia.responsavel = r.pessoa;
    }
    if ($('#urg-setor').dataset.desenhado !== setor) render();
    else $('#urg-resp').value = st.novaUrgencia.responsavel || '';
  }

  // ---------- resumo, acessos negados, limpeza ----------
  function painelResumo() {
    const resumo = st.resumo || {};
    const conta = (lista, p) => st.filas.filter(r => r.lista === lista && r.pessoa === p).reduce((s, r) => s + (r.itens || []).length, 0);
    const lista = [...pessoas(), { id: GESTOR_ID, nome: 'Gestor', tipo: 'gestor' }];
    const linhas = lista.map(p => `<tr><td>${esc(p.nome)}${p.tipo && p.tipo !== 'servidor' ? ` <span class="muted small">(${esc((ROTULO_TIPO[p.tipo] || (p.tipo === 'gestor' ? 'fila própria, por etiqueta' : p.tipo)).toLowerCase())})</span>` : ''}${(resumo.fixos || {})[p.id] ? ' <span class="muted small">(lista própria)</span>' : ''}</td>
      <td class="n">${conta('semanal', p.id)}</td>
      <td class="n">${P.filaDe(p.id).filter(l => l.tipo === 'urgente' && !l.concluido).length}</td>
      <td class="n">${st.devolucoes.filter(d => d.para === p.id && !d.concluidaEm).length}</td></tr>`).join('');
    const envios = [];
    if (resumo.semanal) envios.push(['Lista completa', resumo.semanal.em, resumo.semanal.total, '']);
    for (const [p, i] of Object.entries(resumo.fixos || {})) envios.push(['Para ' + nomeDe(p), i.em, i.total, p]);
    envios.sort((a, b) => (b[1] || 0) - (a[1] || 0));
    const trEnvio = e => `<tr><td>${esc(e[0])}</td><td>${dataHoraBR(e[1])}</td><td class="n">${e[2] || 0}</td><td>${e[3] ? `<button class="btn discreto" data-acao="liberar-fixo" data-p="${esc(e[3])}">Voltar às regras</button>` : ''}</td></tr>`;
    return `<section class="painel">
      <h2>Resumo por pessoa</h2>
      <div class="tabela-wrap"><table><thead><tr><th>Pessoa</th><th>Lista completa</th><th>Urgências abertas</th><th>Devoluções abertas</th></tr></thead><tbody>${linhas || '<tr><td colspan="4">Cadastre as pessoas na configuração.</td></tr>'}</tbody></table></div>
      <h3>Últimos envios</h3>
      <div class="tabela-wrap"><table><thead><tr><th>Lista</th><th>Enviada em</th><th>Processos</th><th></th></tr></thead><tbody>${envios.map(trEnvio).join('') || '<tr><td colspan="4" class="muted">Nenhum relatório enviado ainda.</td></tr>'}</tbody></table></div>
    </section>`;
  }

  function painelAcessosNegados() {
    const linhas = st.negados.slice(0, 50).map(n => `<tr><td>${esc(n.email)}</td><td class="mono">${dataHoraBR(n.em)}</td></tr>`).join('');
    return `<section class="painel">
      <h2>Tentativas de acesso não autorizado</h2>
      <p>E-mails que entraram com o Google sem estar cadastrados. Ficam guardados por 90 dias, com data e hora (sem IP). Para liberar alguém, cadastre o e-mail na Configuração.</p>
      <div class="tabela-wrap"><table><thead><tr><th>E-mail</th><th>Data e hora</th></tr></thead><tbody>${linhas || '<tr><td colspan="2" class="muted">Nenhuma tentativa registrada.</td></tr>'}</tbody></table></div>
      ${st.negados.length > 50 ? `<p class="small muted">Mostrando as 50 mais recentes de ${st.negados.length}.</p>` : ''}
    </section>`;
  }

  function painelManutencao() {
    return `<section class="painel">
      <h2>Limpeza</h2>
      <p>Urgências e devoluções concluídas há mais de 30 dias já não aparecem nas filas, e as marcas de concluído com mais de 90 dias não são mais usadas. Apague-as para manter o banco leve.</p>
      <div class="linha-botoes"><button class="btn" data-acao="limpar">Apagar registros antigos</button></div>
    </section>`;
  }

  async function limpar() {
    const sb = st.sb;
    const corte30 = iso(Date.now() - 30 * DIA), corte90 = iso(Date.now() - 90 * DIA);
    const a = await sb.from('urgencias').delete({ count: 'exact' }).lt('concluida_em', corte30);
    if (a.error) throw a.error;
    const b = await sb.from('devolucoes').delete({ count: 'exact' }).lt('concluida_em', corte30);
    if (b.error) throw b.error;
    const c = await sb.from('marcas').delete({ count: 'exact' }).lt('em', corte90);
    if (c.error) throw c.error;
    toast(`Apagados: ${(a.count || 0) + (b.count || 0)} urgências/devoluções e ${c.count || 0} marcas antigas.`);
    await P.carregar(); render();
  }

  // ---------- tarefas do PJe ----------
  function painelTarefas() {
    const lista = st.rascTarefas || [];
    const f = st.filtroTabela;
    const busca = R.normTexto(f.busca);
    const visiveis = lista.map((t, i) => [t, i]).filter(([t]) => {
      if (f.painel === '-' ? t.painel : f.painel && t.painel !== f.painel) return false;
      return !busca || R.normTexto(t.tarefa + ' ' + t.setor + ' ' + (t.etiqueta || '')).includes(busca);
    });
    const opcPainel = sel => `<option value=""${!sel ? ' selected' : ''}>Ignorar</option>` + SETORES.map(([id, n]) => `<option value="${id}"${sel === id ? ' selected' : ''}>${n}</option>`).join('');
    const ck = (campo, i, v, rot) => `<input type="checkbox" id="tf-${campo}-${i}" data-i="${i}" data-campo="${campo}"${v ? ' checked' : ''} aria-label="${rot}">`;
    const linhas = visiveis.map(([t, i]) => `<tr>
      <td><input type="text" id="tf-tarefa-${i}" data-i="${i}" data-campo="tarefa" value="${esc(t.tarefa)}" aria-label="Tarefa"></td>
      <td><input type="text" id="tf-setor-${i}" data-i="${i}" data-campo="setor" value="${esc(t.setor)}" aria-label="Setor responsável"></td>
      <td><select id="tf-painel-${i}" data-i="${i}" data-campo="painel" aria-label="Setor no painel">${opcPainel(t.painel)}</select></td>
      <td><input type="text" id="tf-etiqueta-${i}" data-i="${i}" data-campo="etiqueta" value="${esc(t.etiqueta || '')}" placeholder="—" aria-label="Etiqueta exigida"></td>
      <td class="ck">${ck('urgente', i, t.urgente, 'Urgente')}</td>
      <td><input type="text" id="tf-etiquetaUrgente-${i}" data-i="${i}" data-campo="etiquetaUrgente" value="${esc(t.etiquetaUrgente || '')}" placeholder="—" aria-label="Urgente se tiver a etiqueta"></td>
      <td class="ck">${ck('zerar', i, t.zerar, 'Zerar (prioritária)')}</td>
      <td class="ck">${ck('paralelo', i, t.paralelo, 'Fluxo paralelo')}</td>
      <td><button class="btn discreto" type="button" data-acao="tf-excluir" data-i="${i}" data-balao="Excluir tarefa" data-balao-dir="dir" aria-description="Excluir tarefa">Excluir</button></td>
    </tr>`).join('');
    const naVara = lista.filter(t => t.painel).length;
    return `<section class="painel largo">
      <h2>Tarefas do PJe</h2>
      <p>${lista.length} tarefas, ${naVara} nos seis setores da vara${st.tarefasEm ? ` · atualizada em ${dataHoraBR(st.tarefasEm)}` : ''}. “Setor no painel” decide onde o processo entra; “Etiqueta exigida” faz a tarefa só valer para processos com aquela etiqueta. Urgente vai para o topo (também quando o processo tem a etiqueta de “Urgente se etiqueta”); Zerar entra como prioritária.</p>
      <div class="filtros dentro">
        <input type="search" id="tf-busca" placeholder="Buscar tarefa, setor ou etiqueta" value="${esc(f.busca)}" aria-label="Buscar na tabela de tarefas">
        <select id="tf-filtro-painel" aria-label="Filtrar por setor no painel"><option value="">Todos os setores</option><option value="-"${f.painel === '-' ? ' selected' : ''}>Só ignoradas</option>${SETORES.map(([id, n]) => `<option value="${id}"${f.painel === id ? ' selected' : ''}>${n}</option>`).join('')}</select>
        <div class="direita">
          <span id="tf-estado" class="small ${st.tarefasAlteradas ? 'alterado' : 'muted'}">${st.tarefasAlteradas ? 'Alterações não salvas' : 'Tudo salvo'}</span>
          <button class="btn" type="button" data-acao="tf-incluir">Incluir tarefa</button>
          <button class="btn" type="button" data-acao="tf-baixar">Baixar CSV</button>
        </div>
      </div>
      <div class="tabela-wrap tabela-tarefas"><table>
        <thead><tr><th>Tarefa</th><th>Setor responsável</th><th>Setor no painel</th><th>Etiqueta exigida</th><th>Urgente</th><th>Urgente se etiqueta</th><th>Zerar</th><th>Fluxo paralelo</th><th></th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="9" class="muted">Nenhuma tarefa com esse filtro.</td></tr>'}</tbody>
      </table></div>
      <div class="linha-botoes">
        <button class="btn primario" type="button" data-acao="tf-salvar" ${st.tarefasAlteradas ? '' : 'disabled'}>Salvar tabela</button>
        <button class="btn" type="button" data-acao="tf-descartar" ${st.tarefasAlteradas ? '' : 'disabled'}>Descartar alterações</button>
      </div>
    </section>`;
  }

  function editarTarefa(el) {
    const t = (st.rascTarefas || [])[Number(el.dataset.i)];
    if (!t) return;
    const campo = el.dataset.campo;
    t[campo] = el.type === 'checkbox' ? el.checked : el.value;
    if (campo === 'setor' && !t.painelManual) t.painel = R.setorPainelDe(t.setor);
    if (campo === 'painel') t.painelManual = true;
    marcarTarefasAlteradas();
    if (campo === 'setor') { const sel = document.getElementById('tf-painel-' + el.dataset.i); if (sel) sel.value = t.painel || ''; }
  }

  function marcarTarefasAlteradas() {
    st.tarefasAlteradas = true;
    const e = $('#tf-estado'); if (e) { e.textContent = 'Alterações não salvas'; e.className = 'small alterado'; }
    for (const a of ['tf-salvar', 'tf-descartar']) { const b = document.querySelector(`[data-acao="${a}"]`); if (b) b.disabled = false; }
  }

  async function acaoTarefas(acao, alvo) {
    const lista = st.rascTarefas || (st.rascTarefas = []);
    if (acao === 'tf-incluir') {
      lista.unshift({ tarefa: '', setor: '', painel: '', etiqueta: '', etiquetaUrgente: '', urgente: false, zerar: false, paralelo: false });
      st.filtroTabela = { busca: '', painel: '' };
      marcarTarefasAlteradas(); render();
      const el = document.getElementById('tf-tarefa-0'); if (el) el.focus();
    } else if (acao === 'tf-excluir') {
      const t = lista[Number(alvo.dataset.i)];
      lista.splice(Number(alvo.dataset.i), 1);
      marcarTarefasAlteradas(); render();
      toast(`Tarefa “${(t && t.tarefa) || 'sem nome'}” excluída. Clique em Salvar tabela para confirmar ou em Descartar para desfazer.`);
    } else if (acao === 'tf-descartar') {
      st.rascTarefas = clonar(st.tarefas); st.tarefasAlteradas = false; render();
      toast('Alterações na tabela descartadas.');
    } else if (acao === 'tf-salvar') {
      const itens = lista.map(t => ({ tarefa: String(t.tarefa || '').trim(), setor: String(t.setor || '').trim(), painel: t.painel || '',
        etiqueta: String(t.etiqueta || '').trim(), etiquetaUrgente: String(t.etiquetaUrgente || '').trim(), urgente: !!t.urgente, zerar: !!t.zerar, paralelo: !!t.paralelo })).filter(t => t.tarefa);
      const vistos = new Set(), repetidas = [];
      for (const t of itens) { const k = R.normTexto(t.tarefa); if (vistos.has(k)) repetidas.push(t.tarefa); vistos.add(k); }
      if (repetidas.length) { toast('Tarefa repetida na tabela: ' + repetidas.slice(0, 3).join('; ') + '. Exclua uma das linhas antes de salvar.'); return; }
      const { error } = await st.sb.from('config').upsert({ chave: 'tarefas', valor: { itens }, atualizado_em: iso(Date.now()), atualizado_por: st.email }, { onConflict: 'chave' });
      if (error) throw error;
      st.tarefasAlteradas = false;
      await P.carregar(); render();
      toast('Tabela de tarefas salva.');
    } else if (acao === 'tf-baixar') {
      baixar('tarefas-pje-' + new Date().toISOString().slice(0, 10) + '.csv', R.tarefasParaCsv(lista));
    }
  }

  // ---------- configuração: pessoas (com e-mail e perfil), outros acessos, exceções e divisão por setor ----------
  function painelConfig() {
    const c = st.rascunho;
    const sel = (id, valor, vazio) => `<select id="${id}">${opcoesPessoasDe(c.pessoas, valor, vazio)}</select>`;
    const pessoasH = (c.pessoas || []).map((p, i) => `<div class="pessoa-cfg">
      <input type="text" id="cfg-p-nome-${i}" value="${esc(p.nome)}" aria-label="Nome">
      <select id="cfg-p-tipo-${i}" aria-label="Perfil">${opcoesTipo(p.tipo)}</select>
      <input type="text" id="cfg-p-email-${i}" value="${esc(p.email || '')}" aria-label="E-mail Google" inputmode="email" autocomplete="off" placeholder="E-mail Google (Gmail)">
      <button class="btn" type="button" data-acao="cfg-remover-pessoa" data-i="${i}">Remover</button></div>`).join('');
    const outros = st.rascOutros || [];
    const opcPerfil = sel => PERFIS_OUTROS.map(id => `<option value="${id}"${sel === id ? ' selected' : ''}>${PERFIS[id]}</option>`).join('');
    const outrosH = outros.map((o, i) => {
      const eu = o.email === st.email;
      return `<div class="acesso-cfg">
      <input type="text" id="cfg-o-nome-${i}" value="${esc(o.nome)}" aria-label="Nome">
      <select id="cfg-o-perfil-${i}" aria-label="Perfil" ${eu ? 'disabled' : ''}>${opcPerfil(o.perfil)}</select>
      <input type="text" id="cfg-o-email-${i}" value="${esc(o.email || '')}" aria-label="E-mail Google" inputmode="email" autocomplete="off" placeholder="E-mail Google (Gmail)" ${eu ? 'disabled' : ''}>
      <button class="btn" type="button" data-acao="cfg-remover-outro" data-i="${i}" ${eu ? 'disabled data-balao="Seu próprio acesso não pode ser removido" data-balao-dir="dir" aria-description="Seu próprio acesso não pode ser removido"' : ''}>Remover</button></div>`;
    }).join('');
    const setoresH = SETORES.map(([id, nome]) => {
      const s = (c.setores || {})[id] || { modo: 'fixo', responsavel: '' };
      const corpo = s.modo === 'digito'
        ? `<div class="digitos">${Array.from({ length: 10 }, (_, d) => `<label><b>Dígito ${d}</b>${sel(`cfg-s-${id}-${d}`, (s.faixas || [])[d] || '', '—')}</label>`).join('')}</div>`
        : `<label class="campo"><span>Responsável</span>${sel(`cfg-s-${id}-resp`, s.responsavel || '', 'Escolha')}</label>`;
      return `<div class="setor-cfg"><div class="linha-botoes"><h3>${nome}</h3>
        <select id="cfg-s-${id}-modo" aria-label="Forma de divisão de ${nome}"><option value="digito"${s.modo === 'digito' ? ' selected' : ''}>Dividir por dígito</option><option value="fixo"${s.modo !== 'digito' ? ' selected' : ''}>Um responsável</option></select></div>${corpo}</div>`;
    }).join('');
    const regrasH = (c.regrasClasse || []).map((r, i) => `<div class="regra">
      <select id="cfg-r-campo-${i}" aria-label="Verificar"><option value="classe"${r.campo !== 'etiqueta' ? ' selected' : ''}>Classe</option><option value="etiqueta"${r.campo === 'etiqueta' ? ' selected' : ''}>Etiqueta</option></select>
      <input type="text" id="cfg-r-padrao-${i}" value="${esc(r.padrao)}" aria-label="Siglas ou etiquetas" placeholder="Siglas ou nomes, separados por |">
      ${sel(`cfg-r-resp-${i}`, r.responsavel || '', 'Responsável')}
      <select id="cfg-r-setor-${i}" aria-label="Vale para"><option value="">Todos os setores</option>${SETORES.map(([id, n]) => `<option value="${id}"${(r.setores || [])[0] === id ? ' selected' : ''}>Só ${n}</option>`).join('')}</select>
      <button class="btn" type="button" data-acao="cfg-remover-regra" data-i="${i}">Remover</button></div>`).join('');
    const visoesH = (c.visoes || []).map((v, i) => `<div class="regra">
      <select id="cfg-v-tipo-${i}" aria-label="Filtrar por"><option value="setor"${v.tipo === 'setor' ? ' selected' : ''}>Setor</option><option value="classe"${v.tipo === 'classe' ? ' selected' : ''}>Só as classes</option><option value="semclasse"${v.tipo === 'semclasse' ? ' selected' : ''}>Todas menos as classes</option></select>
      ${v.tipo === 'setor'
        ? `<select id="cfg-v-valor-${i}" aria-label="Setor">${SETORES.map(([id, n]) => `<option value="${id}"${v.valor === id ? ' selected' : ''}>${n}</option>`).join('')}</select>`
        : `<input type="text" id="cfg-v-valor-${i}" value="${esc(v.valor || '')}" aria-label="Siglas das classes" placeholder="Siglas separadas por |">`}
      ${sel(`cfg-v-pessoa-${i}`, v.pessoa || '', 'Pessoa')}
      <input type="text" id="cfg-v-nome-${i}" value="${esc(v.nome || '')}" aria-label="Nome da visão" placeholder="Nome que aparece no filtro" maxlength="40">
      <button class="btn" type="button" data-acao="cfg-remover-visao" data-i="${i}">Remover</button></div>`).join('');
    const etiquetasH = (c.etiquetasFiltro || []).map((x, i) => `<div class="regra so-etiqueta">
      <input type="text" id="cfg-et-${i}" value="${esc(x)}" aria-label="Etiqueta" placeholder="# RPV - 01. Expedir">
      <button class="btn" type="button" data-acao="cfg-remover-etiqueta" data-i="${i}">Remover</button></div>`).join('');
    const etDirH = (c.etiquetasDiretor || []).map((x, i) => `<div class="regra dir-etiqueta">
      <input type="text" id="cfg-ed-${i}" value="${esc(x.e)}" aria-label="Etiqueta" placeholder="Etiqueta exatamente como no PJe">
      <label class="small"><input type="checkbox" id="cfg-edu-${i}"${x.u ? ' checked' : ''}> Urgente</label>
      <button class="btn" type="button" data-acao="cfg-remover-etdir" data-i="${i}">Remover</button></div>`).join('');
    return `<section class="painel largo">
      <h2>Configuração</h2>
      <p>As mudanças valem para todos assim que você salvar. Urgência e prioridade de cada tarefa ficam na tabela “Tarefas do PJe”. Quem não tiver e-mail cadastrado recebe processos, mas não consegue entrar no painel.</p>
      <h3>Pessoas com fila (servidores, estagiários e residentes)</h3>
      ${(c.pessoas || []).length ? '<div class="pessoa-cfg cab-cfg"><span>Nome</span><span>Perfil</span><span>E-mail Google</span><span></span></div>' : ''}
      ${pessoasH || '<p class="muted">Nenhuma pessoa cadastrada.</p>'}
      <div class="linha-botoes"><input type="text" id="cfg-nova-pessoa" placeholder="Nome da nova pessoa" aria-label="Nome da nova pessoa" value="${esc(st.novaPessoa || '')}">
        <select id="cfg-nova-tipo" aria-label="Perfil da nova pessoa">${opcoesTipo('servidor')}</select>
        <button class="btn" type="button" data-acao="cfg-add-pessoa">Adicionar pessoa</button></div>
      <h3>Outros acessos (sem fila própria)</h3>
      <p class="small muted">Gestor, Magistrado e Diretor de Secretaria veem todas as filas; Visitante vê só o painel geral, sem filtrar por servidor. Só o Gestor acessa esta aba.</p>
      ${outros.length ? '<div class="acesso-cfg cab-cfg"><span>Nome</span><span>Perfil</span><span>E-mail Google</span><span></span></div>' : ''}
      ${outrosH}
      <div class="linha-botoes"><button class="btn" type="button" data-acao="cfg-add-outro">Adicionar acesso</button></div>
      <h3>Visões por pessoa (filtros opcionais)</h3>
      <p class="small muted">Para quem trabalha em mais de um setor ou tipo de processo: a pessoa ganha um filtro na própria fila, ao lado da busca. Ele só muda o que aparece na tela; a distribuição continua igual. O painel sempre abre completo, sem filtro. A opção “Painel completo” existe automaticamente.</p>
      ${visoesH}
      <div class="linha-botoes"><button class="btn" type="button" data-acao="cfg-add-visao">Adicionar visão</button></div>
      <h3>Etiquetas para filtro (Pagamentos)</h3>
      <p class="small muted">Só as etiquetas listadas aqui são guardadas, e apenas nos processos de tarefas de Pagamentos. Elas viram o filtro “Etiqueta” na fila e no painel geral. Escreva exatamente como no PJe (ex.: # RPV - 01. Expedir). Depois de incluir ou mudar uma etiqueta, envie o CSV completo de novo para ela passar a valer.</p>
      ${etiquetasH}
      <div class="linha-botoes"><button class="btn" type="button" data-acao="cfg-add-etiqueta">Adicionar etiqueta</button></div>
      <h3>Fila do Diretor de Secretaria (por etiqueta)</h3>
      <p class="small muted">Entra na fila do diretor todo processo que tiver pelo menos uma destas etiquetas, em qualquer tarefa ou setor, uma vez só, com a tarefa de chegada mais antiga. Cada processo mostra apenas as etiquetas desta lista que ele tem. As marcadas como “Urgente” colocam o processo em Urgências. Os processos saem da fila quando deixam de ter a etiqueta no CSV novo. Depois de mudar a lista, envie o CSV de novo. Cadastre o diretor em “Pessoas com fila”, com o perfil Diretor de Secretaria.</p>
      ${etDirH}
      <div class="linha-botoes"><button class="btn" type="button" data-acao="cfg-add-etdir">Adicionar etiqueta</button></div>
      <h3>Fila do gestor (por etiqueta)</h3>
      <p class="small muted">A fila do gestor, no topo desta aba, mostra os processos com esta etiqueta e os que servidores e o diretor enviarem para o gestor. Deixe em branco para usar só os envios.</p>
      <div class="regra so-etiqueta"><input type="text" id="cfg-etg" value="${esc(c.etiquetaGestor == null ? R.ETIQUETA_GESTOR_PADRAO : c.etiquetaGestor)}" aria-label="Etiqueta da fila do gestor" placeholder="${esc(R.ETIQUETA_GESTOR_PADRAO)}"></div>
      <h3>Exceções por classe ou etiqueta</h3>
      <p class="small muted">Valem antes da divisão do setor, na ordem da lista (a primeira que casar decide). Classe: use a sigla do PJe+R (ex.: ACPCiv|ACIA); etiqueta: o texto completo (ex.: $ Ação civil pública).</p>
      ${regrasH}
      <div class="linha-botoes"><button class="btn" type="button" data-acao="cfg-add-regra">Adicionar exceção</button></div>
      <h3>Divisão por setor</h3>
      ${setoresH}
      <div class="linha-botoes">
        <button class="btn primario" type="button" data-acao="cfg-salvar" ${st.gravando ? 'disabled' : ''}>Salvar configuração</button>
        <button class="btn" type="button" data-acao="cfg-descartar">Descartar alterações</button>
      </div>
    </section>`;
  }

  function opcoesPessoasDe(lista, selecionado, vazio) {
    const salvo = st.config; st.config = Object.assign({}, st.config || {}, { pessoas: lista || [] });
    const h = opcoesPessoas(selecionado, vazio);
    st.config = salvo;
    return h;
  }

  // Lê os campos do formulário de configuração para o rascunho (antes de redesenhar).
  function lerRascunho() {
    const c = st.rascunho; if (!c) return;
    const val = id => { const el = document.getElementById(id); return el ? el.value : null; };
    (c.pessoas || []).forEach((p, i) => {
      const nome = val(`cfg-p-nome-${i}`); if (nome != null && nome.trim()) p.nome = nome.trim();
      const tipo = val(`cfg-p-tipo-${i}`); if (tipo) p.tipo = tipo;
      const email = val(`cfg-p-email-${i}`); if (email != null) p.email = email.trim();
    });
    (st.rascOutros || []).forEach((o, i) => {
      const nome = val(`cfg-o-nome-${i}`); if (nome != null) o.nome = nome.trim();
      const perfil = val(`cfg-o-perfil-${i}`); if (perfil) o.perfil = perfil;
      const email = val(`cfg-o-email-${i}`); if (email != null) o.email = email.trim();
    });
    (c.regrasClasse || []).forEach((r, i) => {
      const campo = val(`cfg-r-campo-${i}`); if (campo) r.campo = campo;
      const pad = val(`cfg-r-padrao-${i}`); if (pad != null) r.padrao = pad.trim();
      const resp = val(`cfg-r-resp-${i}`); if (resp != null) r.responsavel = resp;
      const s = val(`cfg-r-setor-${i}`); if (s != null) r.setores = s ? [s] : [];
    });
    (c.etiquetasDiretor || []).forEach((x, i) => { const e = val(`cfg-ed-${i}`); if (e != null) x.e = e.trim(); const u = document.getElementById(`cfg-edu-${i}`); if (u) x.u = u.checked; });
    const etg = val('cfg-etg'); if (etg != null) c.etiquetaGestor = etg.trim();
    (c.etiquetasFiltro || []).forEach((x, i) => { const v = val(`cfg-et-${i}`); if (v != null) c.etiquetasFiltro[i] = v.trim(); });
    (c.visoes || []).forEach((v, i) => {
      const tipo = val(`cfg-v-tipo-${i}`); if (tipo) v.tipo = tipo;
      const valor = val(`cfg-v-valor-${i}`); if (valor != null) v.valor = valor.trim();
      const pessoa = val(`cfg-v-pessoa-${i}`); if (pessoa != null) v.pessoa = pessoa;
      const nome = val(`cfg-v-nome-${i}`); if (nome != null) v.nome = nome.trim();
    });
    c.setores = c.setores || {};
    for (const [id] of SETORES) {
      const modo = val(`cfg-s-${id}-modo`); if (!modo) continue;
      const atual = c.setores[id] || {};
      if (atual.modo === 'digito' && document.getElementById(`cfg-s-${id}-0`)) atual.faixas = Array.from({ length: 10 }, (_, d) => val(`cfg-s-${id}-${d}`) || '');
      if (atual.modo !== 'digito' && document.getElementById(`cfg-s-${id}-resp`)) atual.responsavel = val(`cfg-s-${id}-resp`) || '';
      atual.modo = modo;
      if (modo === 'digito' && !Array.isArray(atual.faixas)) atual.faixas = Array(10).fill('');
      c.setores[id] = atual;
    }
  }

  // Salva a configuração e sincroniza os e-mails (tabela `acesso`): quem sai da lista perde o acesso.
  async function salvarConfiguracao() {
    const c = st.rascunho, outros = st.rascOutros || [];
    c.regrasClasse = (c.regrasClasse || []).filter(r => r.padrao && r.responsavel);
    c.visoes = (c.visoes || []).filter(v => v.pessoa && v.nome && v.valor);
    c.etiquetasFiltro = [...new Set((c.etiquetasFiltro || []).filter(Boolean))];
    const vistosEd = new Set();
    c.etiquetasDiretor = (c.etiquetasDiretor || []).filter(x => { const k = R.normTexto(x.e); if (!k || vistosEd.has(k)) return false; vistosEd.add(k); return true; }).map(x => ({ e: x.e, u: !!x.u }));
    if (c.etiquetaGestor == null) c.etiquetaGestor = R.ETIQUETA_GESTOR_PADRAO;
    const desejados = [];
    const vistos = new Set();
    const checa = (nome, email, rotulo) => {
      if (!email) return null;
      const e = email.toLowerCase();
      if (!EMAIL_OK.test(e)) throw new Error(`E-mail inválido para ${rotulo || 'uma pessoa'}: ${email}`);
      if (vistos.has(e)) throw new Error(`O e-mail ${e} está repetido.`);
      vistos.add(e);
      return e;
    };
    try {
      for (const p of c.pessoas || []) {
        if (!p.nome) throw new Error('Há uma pessoa sem nome.');
        const e = checa(p.nome, p.email, p.nome);
        if (e) desejados.push({ email: e, nome: p.nome, perfil: p.tipo || 'servidor', pessoa_id: p.id });
      }
      for (const o of outros) {
        if (!o.email && !o.nome) continue;
        if (!o.nome) throw new Error('Há um acesso sem nome.');
        if (!o.email) throw new Error(`Informe o e-mail de ${o.nome}.`);
        desejados.push({ email: checa(o.nome, o.email, o.nome), nome: o.nome, perfil: o.perfil, pessoa_id: null });
      }
    } catch (e) { toast(e.message); return; }
    const eu = desejados.find(d => d.email === st.email);
    if (!eu || eu.perfil !== 'gestor') { toast('Mantenha o seu próprio e-mail cadastrado como Gestor, senão você perde o acesso a esta aba.'); return; }
    const sb = st.sb;
    st.gravando = true; render();
    try {
      const emails = new Set(desejados.map(d => d.email));
      const sair = st.acessos.filter(a => !emails.has(a.email)).map(a => a.email);
      if (sair.length) { const { error } = await sb.from('acesso').delete().in('email', sair); if (error) throw error; }
      if (desejados.length) { const { error } = await sb.from('acesso').upsert(desejados, { onConflict: 'email' }); if (error) throw error; }
      const valor = clonar(c);
      for (const p of valor.pessoas || []) delete p.email;   // e-mails ficam só na tabela de acessos, visível ao gestor
      const { error } = await sb.from('config').upsert({ chave: 'geral', valor, atualizado_em: iso(Date.now()), atualizado_por: st.email }, { onConflict: 'chave' });
      if (error) throw error;
      st.rascunho = null; st.rascOutros = null;
      await P.carregar();
      toast('Configuração salva.');
    } catch (e) { falha(e); }
    st.gravando = false; render();
  }

  // ---------- eventos ----------
  async function aoClicarGestao(ev) {
    const alvo = ev.target.closest('[data-acao]');
    if (!alvo) return;
    const acao = alvo.dataset.acao;
    if (acao.startsWith('cfg-')) lerRascunho();
    const c = st.rascunho;
    try {
      if (acao.startsWith('tf-')) await acaoTarefas(acao, alvo);
      else if (acao === 'gravar-importacao') await gravarImportacao();
      else if (acao === 'cancelar-importacao') { st.importacao = null; render(); }
      else if (acao === 'pedir-remocao') { st.confirmarRemocao = Number(alvo.dataset.id); render(); }
      else if (acao === 'remover-urgencia') {
        const { error } = await st.sb.from('urgencias').delete().eq('id', Number(alvo.dataset.id));
        if (error) throw error;
        st.confirmarRemocao = null; toast('Urgência removida.'); await P.carregar(); render();
      }
      else if (acao === 'liberar-fixo') {
        const resumo = clonar(st.resumo || {}); if (resumo.fixos) delete resumo.fixos[alvo.dataset.p];
        const { error } = await st.sb.from('config').upsert({ chave: 'resumo', valor: resumo, atualizado_em: iso(Date.now()), atualizado_por: st.email }, { onConflict: 'chave' });
        if (error) throw error;
        toast('Na próxima lista completa, essa pessoa volta a receber pelas regras.'); await P.carregar(); render();
      }
      else if (acao === 'limpar') await limpar();
      else if (acao === 'cfg-add-pessoa') {
        const nome = $('#cfg-nova-pessoa').value.trim();
        if (!nome) { toast('Digite o nome da pessoa.'); return; }
        let id = R.slug(nome), n = 2;
        while ((c.pessoas || []).some(p => p.id === id)) id = R.slug(nome) + '-' + n++;
        c.pessoas = (c.pessoas || []).concat({ id, nome, tipo: $('#cfg-nova-tipo').value, email: '' });
        st.novaPessoa = ''; render();
      }
      else if (acao === 'cfg-remover-pessoa') { c.pessoas.splice(Number(alvo.dataset.i), 1); render(); }
      else if (acao === 'cfg-add-outro') { st.rascOutros = (st.rascOutros || []).concat({ nome: '', email: '', perfil: 'magistrado' }); render(); }
      else if (acao === 'cfg-remover-outro') { st.rascOutros.splice(Number(alvo.dataset.i), 1); render(); }
      else if (acao === 'cfg-add-regra') { c.regrasClasse = (c.regrasClasse || []).concat({ campo: 'classe', padrao: '', responsavel: '', setores: [] }); render(); }
      else if (acao === 'cfg-add-visao') { c.visoes = (c.visoes || []).concat({ pessoa: '', nome: '', tipo: 'setor', valor: 'triagem' }); render(); }
      else if (acao === 'cfg-add-etdir') { c.etiquetasDiretor = (c.etiquetasDiretor || []).concat({ e: '', u: false }); render(); }
      else if (acao === 'cfg-remover-etdir') { c.etiquetasDiretor.splice(Number(alvo.dataset.i), 1); render(); }
      else if (acao === 'cfg-add-etiqueta') { c.etiquetasFiltro = (c.etiquetasFiltro || []).concat(''); render(); }
      else if (acao === 'cfg-remover-etiqueta') { c.etiquetasFiltro.splice(Number(alvo.dataset.i), 1); render(); }
      else if (acao === 'cfg-remover-visao') { c.visoes.splice(Number(alvo.dataset.i), 1); render(); }
      else if (acao === 'cfg-remover-regra') { c.regrasClasse.splice(Number(alvo.dataset.i), 1); render(); }
      else if (acao === 'cfg-descartar') { st.rascunho = null; st.rascOutros = null; render(); toast('Alterações descartadas.'); }
      else if (acao === 'cfg-salvar') await salvarConfiguracao();
    } catch (e) { falha(e); }
  }

  const v = $('#v-gestao');
  v.addEventListener('click', aoClicarGestao);
  v.addEventListener('submit', e => { if (e.target.id === 'form-urgencia') aoIncluirUrgencia(e); else e.preventDefault(); });
  v.addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'imp-arquivo' || id === 'imp-destino') prepararImportacao();
    else if (e.target.dataset.campo && e.target.dataset.i != null) editarTarefa(e.target);
    else if (id === 'tf-filtro-painel') { st.filtroTabela.painel = e.target.value; render(); }
    else if (id === 'urg-setor') sugerirResponsavel();
    else if (id === 'urg-resp' || id === 'urg-motivo') st.novaUrgencia = Object.assign(st.novaUrgencia || {}, { responsavel: $('#urg-resp').value, motivo: $('#urg-motivo').value });
    else if (/^cfg-s-.*-modo$/.test(id)) { lerRascunho(); render(); }
    else if (/^cfg-v-tipo-\d+$/.test(id)) {
      lerRascunho();
      const v = st.rascunho.visoes[Number(id.split('-').pop())];
      if (v.tipo === 'setor' && !SETORES.some(([s]) => s === v.valor)) v.valor = 'triagem';
      else if (v.tipo !== 'setor' && SETORES.some(([s]) => s === v.valor)) v.valor = '';
      render();
    }
  });
  let tfBuscaTimer = null;
  v.addEventListener('input', e => {
    if (e.target.id === 'urg-numero') sugerirResponsavel();
    else if (e.target.id === 'tf-busca') { clearTimeout(tfBuscaTimer); tfBuscaTimer = setTimeout(() => { st.filtroTabela.busca = e.target.value; render(); }, 200); }
    else if (e.target.dataset.campo && e.target.type === 'text') editarTarefa(e.target);
  });
})();
