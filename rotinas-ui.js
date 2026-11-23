/* Fila de Trabalho da Vara — área "Rotinas com IA" (só o Gestor).
   Cada botão abre o atalho painel:// do Windows, que roda no computador do Gestor uma rotina da lista fixa do extrator
   (os autos são baixados do PJe só com leitura e o Claude escreve a análise em "_Processos (Download)\Análise").
   O andamento vem do status.json de cada rotina, na mesma pasta de entrada dos botões "Extrair agora" (permissão do Gestor,
   só leitura, guardada no navegador). O resultado entra no painel pelo "Enviar análises da IA" (analises-ui.js), que fica
   logo abaixo: nada grava sozinho. O painel não envia nada novo pela rede; o endereço só leva o nome da rotina e o número. */
(function () {
  'use strict';
  const P = window.PAINEL;
  if (!P || !P.render) return;
  const { st, esc } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const SUPORTE = typeof window.showDirectoryPicker === 'function';
  const INTERVALO = 3000, ESPERA_MAX = 4 * 3600 * 1000;
  const podeVer = () => st.perfil === 'gestor';

  // numero: 'opcional' | 'obrigatorio' | 'nao'. O extrator confere de novo a lista e o formato do número.
  const ROTINAS = [
    { alvo: 'ia-analise-inicial', titulo: 'Análise inicial', numero: 'opcional',
      texto: 'Faz a triagem de processos novos: competência, inicial, urgência e encaminhamento sugerido (skill de análise inicial). Com o número, analisa esse processo. Sem o número, analisa até 3 processos da Triagem inicial da última lista do PJe+R que ainda não têm análise, começando pelos de liminar pendente.' },
    { alvo: 'ia-ler-autos', titulo: 'Ler autos e sugerir', numero: 'obrigatorio',
      texto: 'Lê a cópia integral dos autos de um processo e sugere o encaminhamento (arquivar, minutar, cumprir etc.), com a base de cada ponto.' },
    { alvo: 'ia-ping', titulo: 'Testar as rotinas', numero: 'nao', botao: 'Testar',
      texto: 'Confere, neste computador, se o atalho do painel e o Claude estão funcionando. Leva alguns segundos e não acessa nenhum sistema.' },
  ];
  const ESTADO = { em_andamento: 'Em andamento', concluido: 'Concluída', erro: 'Não terminou', cancelado: 'Cancelada' };
  const CNJ = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
  const fmtCNJ = d => `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
  // Número digitado (com ou sem pontuação) → formato CNJ, ou '' se não tiver os 20 dígitos.
  const numeroDe = s => { const d = String(s || '').replace(/\D/g, ''); return d.length === 20 ? fmtCNJ(d) : ''; };

  const S = { pasta: null, permissao: 'sem', status: {}, numeros: {}, pedidos: {}, msg: {}, timer: 0, erroPasta: '' };

  // ---------- pasta de entrada (a mesma dos botões "Extrair agora": IndexedDB painel-automacao, chave "pasta") ----------
  function bd() {
    return new Promise((ok, err) => {
      const r = indexedDB.open('painel-automacao', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => err(r.error);
    });
  }
  async function bdLer(chave) { try { const d = await bd(); return await new Promise((ok, err) => { const q = d.transaction('kv').objectStore('kv').get(chave); q.onsuccess = () => ok(q.result); q.onerror = () => err(q.error); }); } catch (e) { return null; } }
  async function bdGravar(chave, valor) { try { const d = await bd(); await new Promise((ok, err) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(valor, chave); t.oncomplete = ok; t.onerror = () => err(t.error); }); } catch (e) { /* sem guardar: pede a pasta de novo */ } }
  async function permissao() {
    if (!S.pasta) return 'sem';
    try { return await S.pasta.queryPermission({ mode: 'read' }); } catch (e) { return 'sem'; }
  }
  const liberada = () => S.pasta && S.permissao === 'granted';
  async function lerStatus(alvo) {
    if (!liberada()) return null;
    try {
      const dir = await S.pasta.getDirectoryHandle(alvo);
      return JSON.parse(await (await (await dir.getFileHandle('status.json')).getFile()).text());
    } catch (e) { return null; }
  }
  async function lerTodos() {
    let mudou = false;
    for (const r of ROTINAS) {
      const novo = await lerStatus(r.alvo);
      if (JSON.stringify(novo) !== JSON.stringify(S.status[r.alvo])) { S.status[r.alvo] = novo; mudou = true; }
      const ped = S.pedidos[r.alvo];
      if (ped && novo && Date.parse(novo.atualizado_em) >= ped - 5000 && novo.estado !== 'em_andamento') delete S.pedidos[r.alvo];
      if (ped && Date.now() - ped > ESPERA_MAX) { delete S.pedidos[r.alvo]; S.msg[r.alvo] = 'A rotina não respondeu. Confira o computador em que ela foi pedida.'; mudou = true; }
    }
    return mudou;
  }

  // Consulta a pasta enquanto a área está aberta e há rotina pedida ou em andamento.
  function precisaAcompanhar() {
    return st.area === 'rotinas' && liberada() && ROTINAS.some(r => S.pedidos[r.alvo] || (S.status[r.alvo] && S.status[r.alvo].estado === 'em_andamento'));
  }
  function acompanhar() {
    if (S.timer || !precisaAcompanhar()) return;
    S.timer = setInterval(async () => {
      if (!precisaAcompanhar()) { clearInterval(S.timer); S.timer = 0; return; }
      if (await lerTodos()) render();
    }, INTERVALO);
  }

  // ---------- tela ----------
  const hora = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  const balao = t => `data-balao="${esc(t)}" aria-description="${esc(t)}"`;

  function linhaPasta() {
    if (!SUPORTE) return '<div class="aviso erro">Este navegador não deixa o painel ler a pasta de entrada. Use o Edge do painel.</div>';
    if (liberada()) return `<div class="linha-botoes"><span class="small muted">Pasta de entrada: “${esc(S.pasta.name)}”.</span><button class="btn discreto" type="button" data-rot="pasta" ${balao('A pasta onde o extrator grava o andamento (extrator/entrada, no OneDrive). O painel só lê essa pasta.')}>Trocar pasta</button></div>`;
    const rot = S.pasta ? 'Liberar pasta' : 'Escolher pasta de entrada';
    return `<div class="aviso novo">Para ver o andamento das rotinas, ${S.pasta ? 'libere o acesso à' : 'escolha a'} pasta “entrada”, dentro da pasta “extrator” (a mesma dos botões “Extrair agora”).
      <div class="linha-botoes"><button class="btn" type="button" data-rot="${S.pasta ? 'liberar' : 'pasta'}">${rot}</button></div></div>
      ${S.erroPasta ? `<div class="aviso erro">${esc(S.erroPasta)}</div>` : ''}`;
  }

  function endereco(r) {
    const n = numeroDe(S.numeros[r.alvo]);
    if (r.numero === 'obrigatorio' && !n) return '';
    return `painel://extrair?alvo=${r.alvo}` + (r.numero !== 'nao' && n ? `&processo=${n}` : '');
  }

  function situacao(r) {
    const s = S.status[r.alvo], ped = S.pedidos[r.alvo];
    if (S.msg[r.alvo]) return `<p class="small" role="status">${esc(S.msg[r.alvo])}</p>`;
    if (ped && (!s || Date.parse(s.atualizado_em) < ped - 5000)) {
      return `<p class="small" role="status">Pedido enviado. Aguardando a rotina começar… (se o Edge perguntar, permita abrir o aplicativo do painel.)${liberada() ? '' : ' Escolha a pasta de entrada para acompanhar.'}</p>`;
    }
    if (!s) return liberada() ? '<p class="small muted">Ainda não foi executada neste computador.</p>' : '';
    const itens = Array.isArray(s.processos) ? s.processos.filter(x => x && CNJ.test(String(x.numero || ''))) : [];
    const tabela = itens.length ? `<div class="tabela-wrap"><table><thead><tr><th>Processo</th><th>Situação</th><th>Caminho sugerido</th></tr></thead><tbody>
      ${itens.map(x => `<tr><td class="mono">${esc(x.numero)}</td><td>${esc(x.situacao || '')}${x.erro ? `<div class="small muted">${esc(x.erro)}</div>` : ''}</td><td>${esc(x.caminho || '')}</td></tr>`).join('')}
      </tbody></table></div>` : '';
    return `<p class="small" role="status"><b>${esc(ESTADO[s.estado] || s.estado || '')}</b> · ${esc(hora(s.atualizado_em))}${s.mensagem ? ' — ' + esc(s.mensagem) : ''}</p>${tabela}`;
  }

  function cartao(r) {
    const s = S.status[r.alvo], rodando = !!S.pedidos[r.alvo] || (s && s.estado === 'em_andamento');
    const href = endereco(r);
    const rotBotao = r.botao || 'Executar';
    const btn = href && !rodando
      ? `<a class="btn primario" href="${esc(href)}" data-rot="executar" data-alvo="${r.alvo}" ${balao('Roda a rotina neste computador (atalho do painel). O login no PJe continua seu, no Edge do painel.')}>${rotBotao}</a>`
      : `<button class="btn primario" type="button" disabled>${rodando ? 'Em andamento…' : rotBotao}</button>`;
    // sem campo de número, um espaço vazio no lugar: as caixas e os botões dos cartões ficam na mesma linha (subgrid em estilo.css)
    const campo = r.numero === 'nao' ? '<div class="rot-sem-campo" aria-hidden="true"></div>' : `<label class="campo"><span>Número do processo${r.numero === 'opcional' ? ' (opcional)' : ''}</span>
      <input id="rot-num-${r.alvo}" data-alvo="${r.alvo}" class="rot-num" type="text" inputmode="numeric" autocomplete="off" value="${esc(S.numeros[r.alvo] || '')}" placeholder="0000000-00.0000.4.05.8200"></label>`;
    return `<section class="painel" data-rotina="${r.alvo}">
      <h2>${esc(r.titulo)}</h2>
      <p>${esc(r.texto)}</p>
      ${campo}
      <div class="automacao">${btn}</div>
      <div class="rot-situacao">${situacao(r)}</div>
    </section>`;
  }

  function tela() {
    return `<div class="rotinas">
      <section class="painel">
        <h2>Como funciona</h2>
        <p>Cada rotina roda <b>no computador em que você clicar</b>, pelo atalho do painel: baixa os autos do PJe só com leitura (no Edge do painel, com o seu login) e o Claude escreve a análise na pasta das análises. O Claude não tem acesso ao PJe nem à internet nessa etapa e nunca etiqueta, movimenta, minuta ou assina.</p>
        <p>O resultado é <b>sugestão</b>: confira e grave em “Enviar análises da IA”, no fim desta página. A análise então aparece na linha do processo na fila.</p>
        ${linhaPasta()}
      </section>
      <div class="rotinas-grade">${ROTINAS.map(cartao).join('')}</div>
      ${P.painelRecomendacoesGestao ? P.painelRecomendacoesGestao() : ''}
      ${P.painelAnalisesGestao ? P.painelAnalisesGestao() : ''}
    </div>`;
  }

  let ultimoHtml = '';
  P.renderRotinas = function () {
    const tl = $('#v-rotinas');
    if (!podeVer()) { tl.innerHTML = '<div class="vazio"><h2>Rotinas com IA</h2><p>Esta área é restrita ao gestor.</p></div>'; ultimoHtml = ''; return; }
    const h = tela();
    if (h === ultimoHtml && tl.innerHTML) return;
    // Redesenhar não pode tirar o cursor do campo do número.
    const foco = document.activeElement && tl.contains(document.activeElement) ? document.activeElement.id : '';
    const pos = foco && document.activeElement.selectionStart;
    ultimoHtml = h; tl.innerHTML = h;
    if (foco) { const el = document.getElementById(foco); if (el) { el.focus(); if (el.setSelectionRange && pos != null) el.setSelectionRange(pos, pos); } }
    acompanhar();
  };

  // ---------- eventos ----------
  const v = $('#v-rotinas');
  if (!v) return;
  v.addEventListener('input', e => {
    if (!e.target.classList.contains('rot-num')) return;
    const alvo = e.target.dataset.alvo, antes = numeroDe(S.numeros[alvo]);
    S.numeros[alvo] = e.target.value;
    if (numeroDe(e.target.value) !== antes) render();   // só quando o número completo aparece, muda ou deixa de estar completo
  });
  v.addEventListener('click', async e => {
    const el = e.target.closest('[data-rot]'); if (!el) return;
    const acao = el.dataset.rot;
    if (acao === 'executar') {   // o link painel:// segue o caminho normal; aqui só começa o acompanhamento
      const alvo = el.dataset.alvo;
      S.pedidos[alvo] = Date.now(); delete S.msg[alvo];
      setTimeout(() => { render(); acompanhar(); }, 0);
      return;
    }
    try {
      if (acao === 'pasta') {
        S.erroPasta = '';
        const h = await window.showDirectoryPicker({ id: 'painel-entrada', mode: 'read' });
        S.pasta = h; S.permissao = 'granted'; await bdGravar('pasta', h);
        if (h.name.toLowerCase() !== 'entrada') S.erroPasta = 'Você escolheu a pasta “' + h.name + '”. O esperado é a pasta “entrada” dentro de “extrator”.';
      } else if (acao === 'liberar') {
        S.permissao = await S.pasta.requestPermission({ mode: 'read' });
      }
      await lerTodos();
    } catch (err) {
      if (err && err.name !== 'AbortError') S.erroPasta = (err && err.message) || 'Não consegui acessar a pasta.';
    }
    render(); acompanhar();
  });

  // Ao abrir a área, lê a pasta guardada e o último status de cada rotina.
  let lidoNaAbertura = false;
  async function iniciar() {
    if (!SUPORTE) return;
    S.pasta = await bdLer('pasta');
    S.permissao = await permissao();
    await lerTodos();
    if (st.area === 'rotinas') render();
  }
  const verArea = () => {
    if (st.area === 'rotinas' && !lidoNaAbertura) { lidoNaAbertura = true; iniciar(); }
    else if (st.area !== 'rotinas') lidoNaAbertura = false;
  };
  new MutationObserver(verArea).observe(v, { attributes: true, attributeFilter: ['hidden'] });
})();
