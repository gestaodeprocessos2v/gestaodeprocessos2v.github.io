/* Fila de Trabalho da Vara: quadro de avisos "Regras da fila".
   Abre sozinho ao entrar no painel (todos os perfis, menos o Gestor), com as regras que valem para a pessoa, montadas pela
   configuração (quadro.js). Com "Não exibir de novo", só volta quando uma regra que afeta a pessoa mudar, e aí destaca o que é
   novo, o que mudou e o que deixou de valer. O que a pessoa viu fica em preferencias.quadro_visto / quadro_ocultar (cada um só
   lê e grava a própria linha, RLS em sql/preferencias.sql). O recado do Gestor fica em config, chave "recado" (todos leem, só o
   Gestor grava); vazio, não aparece nada. Botão "Regras da fila" na linha de atualização da Fila, do Geral e da Eventual. */
(function () {
  'use strict';
  const P = window.PAINEL, Q = window.Quadro;
  if (!P || !P.render || !Q) return;
  const { st, esc, toast, falha, iso } = P;
  const $ = sel => document.querySelector(sel);
  const ROTULO = Object.fromEntries(Q.SECOES);

  // Estado do quadro: visto/ocultar vêm do banco; aberto/todos são da tela.
  const E = () => st.quadro || (st.quadro = { visto: null, ocultar: false, lido: false, aberto: false, todos: false, recadoRasc: null });

  // Quem é a pessoa do quadro: no "Ver como" do Gestor, a pessoa vista; o Gestor fora dele vê as regras da vara.
  function alvo() {
    if (st.perfil === 'gestor') return st.verComo ? { pessoa: st.verComo, perfil: P.tipoDe(st.verComo) || 'servidor', proprio: false } : { pessoa: '', perfil: 'gestor', proprio: false };
    return { pessoa: st.pessoa, perfil: st.perfil, proprio: true };
  }
  const dados = () => ({ geral: st.config, tarefas: st.tarefas, etPri: st.etiquetasPrioridade, recado: st.recadoQuadro, resumo: st.resumo, nomes: P.nomes() });
  const itensDe = (todos) => { const a = alvo(); return Q.montarQuadro(dados(), todos ? '' : a.pessoa, a.perfil); };
  // Novidades contam só na visão da própria pessoa.
  function novidades() {
    const a = alvo(), q = E();
    if (!a.proprio || !st.config) return Q.compararQuadro([], null);
    return Q.compararQuadro(itensDe(false), q.visto);
  }

  async function lerPreferencias() {
    const q = E();
    try {
      const { data, error } = await st.sb.from('preferencias').select('quadro_visto,quadro_ocultar').eq('email', st.email).maybeSingle();
      if (error) throw error;
      q.visto = (data && data.quadro_visto) || null; q.ocultar = !!(data && data.quadro_ocultar);
    } catch (e) { console.warn('Não consegui ler o quadro de avisos da conta.', e); }
    q.lido = true;
  }

  async function gravarVisto() {
    const a = alvo(), q = E();
    if (!a.proprio || !st.config) return;
    q.visto = Q.fotografia(itensDe(false));
    try {
      const { error } = await st.sb.from('preferencias').upsert({ email: st.email, quadro_visto: q.visto, quadro_ocultar: q.ocultar, atualizado_em: iso(Date.now()) }, { onConflict: 'email' });
      if (error) throw error;
    } catch (e) { console.warn('Não consegui guardar o quadro de avisos na conta.', e); }
  }

  // Chamado depois do login (auto) e pelo botão.
  P.abrirQuadro = async function (auto) {
    if (!st.config) return;
    const q = E();
    if (auto) {
      if (st.perfil === 'gestor') return;
      if (!q.lido) await lerPreferencias();
      if (q.ocultar && novidades().total === 0) return;
    }
    q.aberto = true; q.todos = false;
    desenhar();
  };

  function fechar() {
    const q = E();
    if (!q.aberto) return;
    q.aberto = false; q.todos = false;
    desenhar();
    gravarVisto().then(() => P.render());
  }

  // ---------- botão na Fila ----------
  P.botaoQuadro = function () {
    if (!st.config) return '';
    const n = novidades().total;
    const balao = n ? (n === 1 ? '1 regra mudou desde a sua última leitura' : n + ' regras mudaram desde a sua última leitura') : 'Como os processos chegam à fila';
    return `<button type="button" class="btn discreto qd-botao" data-qdacao="abrir" data-balao="${esc(balao)}" aria-description="${esc(balao)}">Regras da fila${n ? ` <span class="qd-num">${n}</span>` : ''}</button>`;
  };

  // ---------- janela ----------
  const selo = (x, cmp) => cmp.novos.has(x.id) ? ' <span class="selo novo">Nova</span>' : cmp.alterados.has(x.id) ? ' <span class="selo novo">Alterada</span>' : '';
  const antes = (x, cmp) => cmp.alterados.has(x.id) ? `<span class="qd-antes">Antes: ${esc(cmp.alterados.get(x.id))}</span>` : '';
  const mudou = (x, cmp) => cmp.novos.has(x.id) || cmp.alterados.has(x.id);

  function cartao(secao, lista, cmp, geral) {
    const destaque = lista.some(x => mudou(x, cmp));
    let corpo = '';
    if (secao === 'urgente' || secao === 'prioritaria') {
      const grupos = new Map();
      for (const x of lista) if (!x.nota) { const g = x.grupo || ''; (grupos.get(g) || grupos.set(g, []).get(g)).push(x); }
      for (const [g, xs] of grupos) {
        if (xs[0].chip) {
          corpo += `<p class="qd-grupo"><span class="qd-rot">${esc(g)}:</span> ${xs.map(x => `<span class="qd-chip ${secao}${mudou(x, cmp) ? ' qd-mudou' : ''}"${x.texto !== x.chip ? ` data-balao="${esc(x.texto)}" aria-description="${esc(x.texto)}" tabindex="0" role="note"` : ''}>${esc(x.chip)}</span>${selo(x, cmp)}`).join(' ')}</p>`;
        } else corpo += `<ul class="qd-lista">${xs.map(x => `<li class="${mudou(x, cmp) ? 'qd-mudou' : ''}">${esc(x.texto)}${selo(x, cmp)}${antes(x, cmp)}</li>`).join('')}</ul>`;
      }
      for (const x of lista.filter(x => x.nota)) corpo += `<p class="qd-nota">${esc(x.texto)}</p>`;
    } else if (secao === 'recado') {
      corpo = `<p class="qd-recado">${esc(lista[0].texto)}${selo(lista[0], cmp)}</p>${antes(lista[0], cmp)}`;
    } else if (lista.length === 1) {
      corpo = `<p class="${mudou(lista[0], cmp) ? 'qd-mudou' : ''}">${esc(lista[0].texto)}${selo(lista[0], cmp)}${antes(lista[0], cmp)}</p>`;
    } else {
      corpo = `<ul class="qd-lista">${lista.map(x => `<li class="${mudou(x, cmp) ? 'qd-mudou' : ''}">${esc(x.texto)}${selo(x, cmp)}${antes(x, cmp)}</li>`).join('')}</ul>`;
    }
    return `<div class="qd-cartao qd-${secao}${destaque ? ' qd-destaque' : ''}"><h3>${esc(geral && secao === 'seus' ? 'Como os processos são divididos' : ROTULO[secao])}</h3>${corpo}</div>`;
  }

  function desenhar() {
    const el = $('#modal-quadro'); if (!el) return;
    const q = E();
    if (!q.aberto) { el.innerHTML = ''; return; }
    const a = alvo();
    const visaoGeral = q.todos || !a.pessoa || !['servidor', 'estagiario', 'residente', 'diretor', 'eventual'].includes(a.perfil);
    const itens = itensDe(q.todos);
    const cmp = q.todos || !a.proprio ? Q.compararQuadro([], null) : Q.compararQuadro(itens, q.visto);
    const porSecao = Q.SECOES.map(([s]) => [s, itens.filter(x => x.secao === s)]).filter(([, l]) => l.length);
    const titulo = visaoGeral ? 'Como a fila da vara é organizada' : a.proprio ? 'Como sua fila é montada' : 'Regras da fila de ' + P.nomeDe(a.pessoa);
    let corpo = '';
    if (cmp.total) {
      const data = q.visto && q.visto.data ? P.dataBR(q.visto.data) : '';
      corpo += `<div class="aviso novo qd-faixa"><b>${cmp.total === 1 ? '1 novidade' : cmp.total + ' novidades'}</b> desde a sua última leitura${data ? ' (' + data + ')' : ''}.</div>`;
      const com = porSecao.filter(([, l]) => l.some(x => mudou(x, cmp))), sem = porSecao.filter(([, l]) => !l.some(x => mudou(x, cmp)));
      corpo += com.map(([s, l]) => cartao(s, l, cmp, visaoGeral)).join('');
      if (cmp.removidos.length) corpo += `<div class="qd-cartao qd-removidas"><h3>Deixou de valer</h3><ul class="qd-lista">${cmp.removidos.map(r => `<li><span class="qd-rot">${esc(ROTULO[Q.secaoDoId(r.id)] || '')}:</span> <s>${esc(r.texto)}</s></li>`).join('')}</ul></div>`;
      if (sem.length) corpo += `<details class="qd-demais"><summary>Ver as outras regras (sem mudança)</summary>${sem.map(([s, l]) => cartao(s, l, cmp, visaoGeral)).join('')}</details>`;
    } else corpo += porSecao.map(([s, l]) => cartao(s, l, cmp, visaoGeral)).join('');
    const podeTodos = !visaoGeral || q.todos;
    const alternar = podeTodos ? `<button type="button" class="btn discreto" data-qdacao="todos">${q.todos ? 'Voltar às suas regras' : 'Ver regras de todos os setores'}</button>` : '<span></span>';
    const caixa = a.proprio ? `<label class="qd-ocultar"><input type="checkbox" id="qd-ocultar"${q.ocultar ? ' checked' : ''}> Não exibir de novo até uma regra mudar</label>` : '';
    el.innerHTML = `<div class="modal-fundo" data-qdacao="fechar-fundo"><div class="modal qd-modal" role="dialog" aria-modal="true" aria-labelledby="qd-tit">
      <h2 id="qd-tit">${esc(titulo)}<button type="button" class="qd-x" data-qdacao="fechar" aria-label="Fechar">×</button></h2>
      <div class="corpo qd-corpo">${corpo}</div>
      <div class="qd-rodape">${alternar}<div class="qd-rodape-dir">${caixa}<button type="button" class="btn primario" data-qdacao="fechar">Entendi</button></div></div>
    </div></div>`;
    const b = el.querySelector('.qd-rodape .btn.primario');
    if (b && !el.contains(document.activeElement)) b.focus();
  }

  // ---------- recado (aba Gestão) ----------
  P.painelQuadroGestao = function () {
    const q = E();
    const atual = st.recadoQuadro || '';
    const rasc = q.recadoRasc == null ? atual : q.recadoRasc;
    const alterado = rasc.trim() !== atual.trim();
    return `<section class="painel largo" id="painel-recado-quadro">
      <h2>Recado no quadro de avisos</h2>
      <p>O quadro “Regras da fila” abre para todos ao entrar no painel e explica, a cada pessoa, as regras que valem para a fila dela (tiradas da configuração, da tabela de tarefas e do cadastro de prioridade ou urgência). Este recado aparece no topo do quadro, para todos. Em branco, o quadro não mostra recado nenhum. Recado novo ou alterado faz o quadro voltar para quem marcou “Não exibir de novo”.</p>
      <textarea id="qd-recado" rows="3" maxlength="600" placeholder="Ex.: a partir de segunda, mutirão de Execução Fiscal" aria-label="Recado no quadro de avisos">${esc(rasc)}</textarea>
      <div class="linha-botoes">
        <button class="btn primario" type="button" data-qdacao="recado-salvar"${alterado && !st.gravando ? '' : ' disabled'}>Salvar recado</button>
        ${atual ? '<button class="btn" type="button" data-qdacao="recado-apagar">Apagar recado</button>' : ''}
        <button class="btn" type="button" data-qdacao="abrir">Ver o quadro</button>
        <span id="qd-recado-estado" class="small ${alterado ? 'alterado' : 'muted'}">${alterado ? 'Alterações não salvas' : 'Tudo salvo'}</span>
      </div>
    </section>`;
  };

  async function salvarRecado(texto) {
    if (st.gravando) return;
    st.gravando = true;
    try {
      const { error } = await st.sb.from('config').upsert({ chave: 'recado', valor: { texto }, atualizado_em: iso(Date.now()), atualizado_por: st.email }, { onConflict: 'chave' });
      if (error) throw error;
      st.recadoQuadro = texto; E().recadoRasc = null;
      toast(texto ? 'Recado salvo. Ele aparece no quadro de avisos.' : 'Recado apagado.');
    } catch (e) { falha(e); }
    st.gravando = false; P.render();
  }

  // ---------- eventos ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-qdacao]'); if (!b) return;
    const acao = b.dataset.qdacao, q = E();
    if (acao === 'abrir') P.abrirQuadro(false);
    else if (acao === 'fechar') fechar();
    else if (acao === 'fechar-fundo' && e.target === b) fechar();
    else if (acao === 'todos') { q.todos = !q.todos; desenhar(); }
    else if (acao === 'recado-salvar') salvarRecado(String(($('#qd-recado') || {}).value || '').trim());
    else if (acao === 'recado-apagar') salvarRecado('');
  });
  document.addEventListener('change', e => { if (e.target.id === 'qd-ocultar') E().ocultar = e.target.checked; });
  document.addEventListener('input', e => {
    if (e.target.id !== 'qd-recado') return;
    const q = E(); q.recadoRasc = e.target.value;
    const alterado = q.recadoRasc.trim() !== (st.recadoQuadro || '').trim();
    const s = $('#qd-recado-estado'); if (s) { s.textContent = alterado ? 'Alterações não salvas' : 'Tudo salvo'; s.className = 'small ' + (alterado ? 'alterado' : 'muted'); }
    const bt = document.querySelector('[data-qdacao="recado-salvar"]'); if (bt) bt.disabled = !alterado;
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && E().aberto) fechar(); });

  // O login pode terminar antes de este arquivo carregar (sessão já guardada e dados rápidos): abre aqui e redesenha a Fila com o botão.
  if (st.estado === 'ok' && !st.quadro) { P.abrirQuadro(true); P.render(); }
})();
