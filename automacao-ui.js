/* Fila de Trabalho da Vara — botões "Extrair agora" na aba Gestão.
   O botão abre o atalho painel:// do Windows, que inicia no computador do Gestor o script de extração (Edge do painel + Playwright).
   O script grava o arquivo numa pasta "entrada" do OneDrive; aqui o painel lê essa pasta (File System Access API, com a
   permissão dada pelo Gestor) e entrega o arquivo à prévia que já existe, como se ele o tivesse escolhido no campo de arquivo.
   Nada grava sozinho: o Gestor confere a prévia e grava. O painel não guarda senha nem chave, e não faz nenhuma chamada nova de rede. */
(function () {
  'use strict';
  const P = window.PAINEL;
  if (!P) return;

  // alvo -> campo de arquivo da Gestão que recebe o arquivo. Cada alvo só entra aqui quando o script dele existe.
  const ALVOS = {
    pjer: { rotulo: 'PJe+R', input: '#imp-arquivo', arquivo: /^[\w .+()-]{1,120}\.csv$/i },
  };
  const SUPORTE = typeof window.showDirectoryPicker === 'function';
  const ESPERA_MAX = 12 * 60 * 1000, INTERVALO = 3000;

  const S = { pasta: null, permissao: 'desconhecida', aguardando: {}, status: {}, carregado: {}, msg: {}, timers: {}, erroPasta: '' };

  // ---------- guarda do acesso à pasta (IndexedDB) ----------
  function bd() {
    return new Promise((ok, err) => {
      const r = indexedDB.open('painel-automacao', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => err(r.error);
    });
  }
  async function bdLer(chave) { try { const d = await bd(); return await new Promise((ok, err) => { const q = d.transaction('kv').objectStore('kv').get(chave); q.onsuccess = () => ok(q.result); q.onerror = () => err(q.error); }); } catch (e) { return null; } }
  async function bdGravar(chave, valor) { try { const d = await bd(); await new Promise((ok, err) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(valor, chave); t.oncomplete = ok; t.onerror = () => err(t.error); }); } catch (e) { /* sem guardar: pede a pasta de novo na próxima vez */ } }

  async function permissaoAtual() {
    if (!S.pasta) return 'sem';
    try { return await S.pasta.queryPermission({ mode: 'read' }); } catch (e) { return 'sem'; }
  }
  async function iniciar() {
    if (!SUPORTE) return;
    S.pasta = await bdLer('pasta');
    S.permissao = await permissaoAtual();
    await lerTodosStatus();
    montar();
  }

  // ---------- leitura da pasta ----------
  const liberada = () => S.pasta && S.permissao === 'granted';
  async function lerStatus(alvo) {
    if (!liberada()) return null;
    try {
      const dir = await S.pasta.getDirectoryHandle(alvo);
      const f = await (await dir.getFileHandle('status.json')).getFile();
      return JSON.parse(await f.text());
    } catch (e) { return null; }
  }
  async function lerTodosStatus() { for (const a of Object.keys(ALVOS)) S.status[a] = await lerStatus(a); }

  async function entregar(alvo, status) {
    const cfg = ALVOS[alvo], input = document.querySelector(cfg.input);
    if (!input) throw new Error('O campo de arquivo não está na tela.');
    if (!cfg.arquivo.test(status.arquivo || '')) throw new Error('Nome de arquivo inesperado no status da extração.');
    const dir = await S.pasta.getDirectoryHandle(alvo);
    const arquivo = await (await dir.getFileHandle(status.arquivo)).getFile();
    const dt = new DataTransfer(); dt.items.add(arquivo);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));   // o painel trata como um arquivo escolhido à mão (prévia)
    S.carregado[alvo] = status.gerado_em;
  }

  // ---------- acompanhamento da extração ----------
  function parar(alvo) { clearInterval(S.timers[alvo]); delete S.timers[alvo]; delete S.aguardando[alvo]; }
  function acompanhar(alvo) {
    S.aguardando[alvo] = Date.now();
    clearInterval(S.timers[alvo]);
    S.msg[alvo] = liberada() ? 'Aguardando a extração… (se o Edge perguntar, permita abrir o aplicativo do painel.)' : 'Extração pedida. Escolha a pasta de entrada para o painel receber o arquivo.';
    S.timers[alvo] = setInterval(async () => {
      if (Date.now() - S.aguardando[alvo] > ESPERA_MAX) { S.msg[alvo] = 'A extração demorou demais. Confira a janela do Edge do painel.'; parar(alvo); montar(); return; }
      if (!liberada()) return;
      const st = await lerStatus(alvo);
      if (!st) return;
      S.status[alvo] = st;
      const pedido = S.aguardando[alvo];
      const recente = st.gerado_em && Date.parse(st.gerado_em) >= pedido - 5000;
      try {
        if (st.estado === 'concluido' && recente) { await entregar(alvo, st); S.msg[alvo] = ''; parar(alvo); }
        else if (st.estado === 'erro' || st.estado === 'cancelado') { if (Date.parse(st.atualizado_em) >= pedido - 5000) { S.msg[alvo] = st.mensagem || 'A extração não terminou.'; parar(alvo); } }
        else if (st.estado === 'em_andamento') S.msg[alvo] = (st.mensagem || 'Extraindo') + '…';
      } catch (e) { S.msg[alvo] = e.message || 'Não consegui carregar o arquivo.'; parar(alvo); }
      montar();
    }, INTERVALO);
  }

  // ---------- barra de botões ----------
  const hora = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  function resumo(alvo) {
    if (S.msg[alvo]) return S.msg[alvo];
    if (!SUPORTE) return 'Este navegador não deixa o painel ler a pasta de entrada; use o Edge ou o Chrome. O envio manual continua valendo.';
    if (S.erroPasta) return S.erroPasta;
    if (!S.pasta) return 'Escolha a pasta de entrada (a pasta “entrada” dentro da pasta “extrator”) para o painel receber o arquivo.';
    if (!liberada()) return 'Libere o acesso à pasta de entrada para o painel receber o arquivo.';
    const st = S.status[alvo];
    if (st && st.estado === 'concluido') return `Última extração: ${hora(st.gerado_em)}${st.linhas ? ` — ${Number(st.linhas).toLocaleString('pt-BR')} processos` : ''}${st.atualizado_em_pje ? ` (dados do PJe de ${hora(st.atualizado_em_pje)})` : ''}.`;
    return '';
  }
  function botao(texto, aut, balao, extra) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn' + (extra ? ' ' + extra : ''); b.textContent = texto; b.dataset.aut = aut;
    if (balao) b.dataset.balao = balao;
    return b;
  }
  function criarBarra(alvo) {
    const cfg = ALVOS[alvo], div = document.createElement('div');
    div.className = 'automacao'; div.dataset.alvo = alvo;
    const a = document.createElement('a');
    a.className = 'btn primario'; a.href = `painel://extrair?alvo=${alvo}`; a.textContent = 'Extrair agora'; a.dataset.aut = 'extrair';
    a.dataset.balao = `Abre o Edge do painel e baixa o relatório do ${cfg.rotulo} sozinho, sem você entrar no sistema (o login continua seu). Precisa do atalho instalado neste computador.`;
    div.append(a);
    if (SUPORTE) {
      const rot = !S.pasta ? 'Escolher pasta de entrada' : liberada() ? 'Trocar pasta' : 'Liberar pasta';
      div.append(botao(rot, !S.pasta || liberada() ? 'pasta' : 'liberar', 'A pasta onde o script grava os arquivos extraídos (extrator/entrada, no OneDrive). O painel só lê essa pasta.'));
      const st = S.status[alvo];
      if (liberada() && st && st.estado === 'concluido' && S.carregado[alvo] !== st.gerado_em) div.append(botao('Carregar a última extração', 'carregar', 'Põe o último arquivo extraído na prévia abaixo.'));
    }
    const m = document.createElement('span');
    m.className = 'automacao-msg small muted'; m.setAttribute('role', 'status'); m.textContent = resumo(alvo);
    div.append(m);
    return div;
  }
  function montar() {
    for (const alvo of Object.keys(ALVOS)) {
      const input = document.querySelector(ALVOS[alvo].input);
      const campo = input && input.closest('.campo');
      if (!campo) continue;
      const atual = campo.previousElementSibling && campo.previousElementSibling.classList.contains('automacao') ? campo.previousElementSibling : null;
      const nova = criarBarra(alvo);
      if (atual) { if (atual.innerHTML !== nova.innerHTML) atual.replaceWith(nova); }   // só troca se mudou (evita laço com o observador)
      else campo.before(nova);
    }
  }

  // ---------- eventos ----------
  document.addEventListener('click', async e => {
    const el = e.target.closest && e.target.closest('[data-aut]');
    if (!el) return;
    const alvo = el.closest('.automacao') && el.closest('.automacao').dataset.alvo;
    if (!alvo) return;
    const aut = el.dataset.aut;
    if (aut === 'extrair') { acompanhar(alvo); montar(); return; }   // o link painel:// segue seu caminho normal
    try {
      if (aut === 'pasta') {
        S.erroPasta = '';
        const h = await window.showDirectoryPicker({ id: 'painel-entrada', mode: 'read' });
        S.pasta = h; S.permissao = 'granted'; await bdGravar('pasta', h);
        if (h.name.toLowerCase() !== 'entrada') S.erroPasta = 'Você escolheu a pasta “' + h.name + '”. O esperado é a pasta “entrada” dentro de “extrator”.';
        await lerTodosStatus();
      } else if (aut === 'liberar') {
        S.permissao = await S.pasta.requestPermission({ mode: 'read' });
        await lerTodosStatus();
      } else if (aut === 'carregar') {
        const st = await lerStatus(alvo); S.status[alvo] = st;
        if (!st || st.estado !== 'concluido') S.msg[alvo] = 'Ainda não há extração concluída.';
        else { await entregar(alvo, st); S.msg[alvo] = ''; }
      }
    } catch (err) {
      if (err && err.name !== 'AbortError') { S.msg[alvo] = (err && err.message) || 'Não consegui acessar a pasta.'; }
    }
    montar();
  });

  let adiar = 0;
  new MutationObserver(() => { clearTimeout(adiar); adiar = setTimeout(montar, 120); }).observe(document.body, { childList: true, subtree: true });
  iniciar();
})();
