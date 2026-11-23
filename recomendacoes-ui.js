/* Fila de Trabalho da Vara — recomendações da juíza (JS = Substituta, JT = Titular).
   A juíza gera um arquivo de recomendações com vários processos (sem formato fixo). Uma rotina de IA, no computador do Gestor,
   lê esse arquivo e grava um <número>_Recomendacao.md por processo em "Análise JS" ou "Análise JT" (pastas separadas das
   análises do Gestor, dentro de "_Processos (Download)"). Este arquivo:
   - o quadro "Recomendações da juíza" em Rotinas com IA: o Gestor escolhe JS ou JT e o arquivo; o painel salva o arquivo em
     <pasta>\Recebidos (permissão de escrita do Gestor, guardada no navegador) e abre o atalho painel://extrair?alvo=ia-recomendacoes;
     depois lê a pasta, mostra a prévia e grava (cada envio substitui o que havia daquela magistrada);
   - a etiqueta JS/JT na linha do processo, para todo perfil que vê a fila (leitura aberta; gravação só do Gestor, RLS em
     sql/analises_juiza.sql). Não mexe nas análises da IA do Gestor (analises-ui.js, tabela analises_ia). */
(function () {
  'use strict';
  const P = window.PAINEL;
  if (!P || !P.render) return;
  const { st, R, esc, toast, falha, todas, dataHoraBR, numeroHTML } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const fmtCNJ = n => (n && n.length === 20 ? `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16)}` : n);
  const digitos = s => String(s == null ? '' : s).replace(/\D/g, '');
  const dataBR = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const SUPORTE = typeof window.showDirectoryPicker === 'function';
  const ALVO = 'ia-recomendacoes';
  const NOME = { JS: 'Substituta', JT: 'Titular' };
  const PASTA = { JS: 'Análise JS', JT: 'Análise JT' };
  const MAX_ARQUIVO = 300000;
  const INTERVALO = 3000, ESPERA_MAX = 4 * 3600 * 1000;
  const RW = { mode: 'readwrite' };
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  // lista: { número com 20 dígitos: [{ magistrada, resumo, semLeitura, dataArquivo, hash, gravadoEm }] } (sem o texto, buscado ao abrir).
  const Z = () => st.juiza || (st.juiza = { lista: {}, textos: {}, modal: null, carregada: false, ultimaGravacao: null,
    mag: 'JS', arquivo: null, pasta: null, permissao: 'desconhecida', entrada: null, status: null, pedido: 0, envio: null, gravando: false, enviando: false, msg: '', erroPasta: '', timer: 0 });

  P.carregarRecomendacoes = async function () {
    const z = Z();
    try {
      const linhas = await todas((x, y) => st.sb.from('analises_juiza').select('numero,magistrada,resumo,sem_leitura,data_arquivo,hash,gravado_em').order('numero').range(x, y));
      const lista = {};
      for (const r of linhas) (lista[r.numero] || (lista[r.numero] = [])).push({ magistrada: r.magistrada, resumo: r.resumo, semLeitura: !!r.sem_leitura, dataArquivo: r.data_arquivo || '', hash: r.hash, gravadoEm: Date.parse(r.gravado_em) || null });
      for (const v of Object.values(lista)) v.sort((a, b) => a.magistrada.localeCompare(b.magistrada));
      z.lista = lista;
      z.ultimaGravacao = linhas.reduce((m, r) => Math.max(m, Date.parse(r.gravado_em) || 0), 0) || null;
      z.carregada = true;
    } catch (e) { console.error(e); }
  };

  // Etiquetas na linha da fila (todo perfil que vê o processo). Só leitura: não depende do "ver como".
  P.etiquetaRecomendacao = function (l) {
    const n = digitos(l.n), recs = Z().lista[n];
    if (!recs || !recs.length) return '';
    const botoes = recs.map(rec => {
      const velha = R.recomendacaoDesatualizada(rec, l), data = dataBR(rec.dataArquivo);
      const balao = [velha, `Recomendação da juíza ${NOME[rec.magistrada]} (${rec.magistrada})${data ? ' de ' + data : ''}: ${rec.resumo}.${rec.semLeitura ? ' Alerta sem leitura dos autos.' : ''} Clique para ler.`].filter(Boolean).join(' ');
      return `<button class="jz-etq${velha ? ' velha' : rec.semLeitura ? ' sem-leitura' : ''}" type="button" data-jzacao="abrir" data-n="${esc(n)}" data-m="${esc(rec.magistrada)}" data-velha="${esc(velha)}" data-balao="${esc(balao)}" aria-description="${esc(balao)}"><span class="jz-rot">${esc(rec.magistrada)}</span><span class="jz-cam">${esc(rec.resumo)}</span>${velha ? '<span class="jz-aviso">desatualizada</span>' : rec.semLeitura ? '<span class="jz-aviso">sem leitura dos autos</span>' : ''}</button>`;
    }).join('');
    return `<div class="jz-linha">${botoes}</div>`;
  };

  // ---------- janela ----------
  const chaveTexto = (n, m) => `${n}|${m}`;
  function renderModal() {
    const el = $('#modal-juiza'); if (!el) return;
    const z = Z(), s = z.modal;
    if (!s) { el.innerHTML = ''; return; }
    const t = z.textos[chaveTexto(s.n, s.m)];
    const corpo = t == null ? (s.erro ? '<p class="aviso erro">Não foi possível abrir a recomendação agora.</p>' : '<p>Carregando…</p>') : `<div class="ia-texto">${R.mdParaHtml(t)}</div>`;
    el.innerHTML = `<div class="modal-fundo" data-jzacao="fechar-fundo"><div class="modal em-modal" role="dialog" aria-modal="true" aria-labelledby="jz-modal-tit">
      <h2 id="jz-modal-tit">Recomendação da juíza (${esc(s.m)}) · <span class="mono">${esc(fmtCNJ(s.n))}</span></h2>
      <div class="corpo">
        ${s.velha ? `<div class="aviso novo"><b>Pode estar desatualizada.</b> ${esc(s.velha)} Confira no PJe.</div>` : ''}
        ${corpo}
        <div class="linha-botoes">
          <button class="btn primario" type="button" data-jzacao="copiar"${t == null ? ' disabled' : ''}>Copiar</button>
          <button class="btn" type="button" data-jzacao="fechar">Fechar</button>
        </div>
      </div></div></div>`;
    const foco = el.querySelector('[data-jzacao="copiar"]:not([disabled])') || el.querySelector('[data-jzacao="fechar"]');
    if (foco && !el.contains(document.activeElement)) foco.focus();
  }

  async function abrir(n, m, velha) {
    const z = Z(), k = chaveTexto(n, m);
    z.modal = { n, m, velha: velha || '', erro: false }; renderModal();
    if (z.textos[k] == null) {
      const { data, error } = await st.sb.from('analises_juiza').select('texto').eq('numero', n).eq('magistrada', m).maybeSingle();
      if (error || !data) { console.error(error); if (z.modal && z.modal.n === n && z.modal.m === m) z.modal.erro = true; renderModal(); return; }
      z.textos[k] = data.texto;
    }
    renderModal();
  }

  // ---------- pastas (mesma técnica das outras rotinas: handle guardado no IndexedDB painel-automacao) ----------
  function bd() {
    return new Promise((ok, err) => {
      const r = indexedDB.open('painel-automacao', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => err(r.error);
    });
  }
  async function bdLer(chave) { try { const d = await bd(); return await new Promise((ok, err) => { const q = d.transaction('kv').objectStore('kv').get(chave); q.onsuccess = () => ok(q.result); q.onerror = () => err(q.error); }); } catch (e) { return null; } }
  async function bdGravar(chave, valor) {
    try {
      try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* só um pedido de proteção */ }
      const d = await bd();
      await new Promise((ok, err) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(valor, chave); t.oncomplete = ok; t.onerror = () => err(t.error); t.onabort = () => err(t.error); });
      d.close();
      return (await bdLer(chave)) ? '' : 'o navegador não manteve a pasta guardada';
    } catch (e) { return (e && (e.message || e.name)) || 'erro desconhecido'; }
  }

  async function situacaoPasta() {
    const z = Z();
    if (!SUPORTE) return 'sem-suporte';
    if (!z.pasta) z.pasta = await bdLer('pasta-processos');
    if (!z.pasta) return 'sem-pasta';
    try { return await z.pasta.queryPermission(RW); } catch (e) { console.error(e); z.erroPasta = `${e.name || 'Erro'}: ${e.message || e}`; return 'sem-pasta'; }
  }
  async function atualizarSituacao() { Z().permissao = await situacaoPasta(); }

  async function escolherPasta() {
    const z = Z();
    z.erroPasta = '';
    try { z.pasta = await window.showDirectoryPicker({ id: 'painel-processos', mode: 'readwrite' }); }
    catch (e) {
      if (e && e.name === 'AbortError') return;   // o Gestor cancelou
      console.error(e); z.erroPasta = `${e.name || 'Erro'}: ${e.message || e}`; render(); return;
    }
    const falhaGuarda = await bdGravar('pasta-processos', z.pasta);
    if (falhaGuarda) z.erroPasta = `a pasta foi aceita, mas o navegador não conseguiu guardá-la (${falhaGuarda}); ela vale só até fechar esta aba`;
    await atualizarSituacao();
    render();
  }
  async function liberarPasta() {
    const z = Z();
    if (!z.pasta) return escolherPasta();
    z.erroPasta = '';
    try { await z.pasta.requestPermission(RW); } catch (e) { console.error(e); z.erroPasta = `${e.name || 'Erro'}: ${e.message || e}`; }
    await atualizarSituacao(); render();
  }
  // A pasta escolhida tem de ser "_Processos (Download)": é dentro dela que ficam "Análise JS" e "Análise JT".
  async function pastaDaMagistrada(m, criar) {
    try { return await Z().pasta.getDirectoryHandle(PASTA[m], { create: !!criar }); }
    catch (e) {
      if (e && e.name === 'NotFoundError') throw new Error(`A pasta escolhida (“${Z().pasta.name}”) não tem a pasta “${PASTA[m]}”. Escolha “_Processos (Download)”.`);
      throw e;
    }
  }

  // ---------- andamento da rotina (status.json na pasta de entrada, a mesma dos botões "Extrair agora") ----------
  async function lerStatus() {
    const z = Z();
    try {
      if (!z.entrada) z.entrada = await bdLer('pasta');
      if (!z.entrada || (await z.entrada.queryPermission({ mode: 'read' })) !== 'granted') return null;
      const dir = await z.entrada.getDirectoryHandle(ALVO);
      return JSON.parse(await (await (await dir.getFileHandle('status.json')).getFile()).text());
    } catch (e) { return null; }
  }
  const andando = () => { const z = Z(); return !!z.pedido || (z.status && z.status.estado === 'em_andamento'); };
  function acompanhar() {
    const z = Z();
    if (z.timer || !andando()) return;
    z.timer = setInterval(async () => {
      const z2 = Z();
      if (!andando() || st.area !== 'rotinas') { clearInterval(z2.timer); z2.timer = 0; return; }
      const novo = await lerStatus();
      if (JSON.stringify(novo) !== JSON.stringify(z2.status)) { z2.status = novo; render(); }
      if (z2.pedido && novo && Date.parse(novo.atualizado_em) >= z2.pedido - 5000 && novo.estado !== 'em_andamento') { z2.pedido = 0; render(); }
      if (z2.pedido && Date.now() - z2.pedido > ESPERA_MAX) { z2.pedido = 0; z2.msg = 'A rotina não respondeu. Confira o computador em que ela foi pedida.'; render(); }
    }, INTERVALO);
  }

  // ---------- enviar o arquivo e pedir a rotina ----------
  async function lerArquivoEscolhido(arquivo) {
    const z = Z();
    z.msg = ''; z.envio = null;
    if (!arquivo) { z.arquivo = null; render(); return; }
    if (arquivo.size > MAX_ARQUIVO) { z.arquivo = null; z.msg = 'O arquivo tem mais de 300 KB. Confira se é o arquivo certo.'; render(); return; }
    const buf = await arquivo.arrayBuffer();
    let texto;
    try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { texto = new TextDecoder('windows-1252').decode(buf); }
    texto = texto.replace(/^﻿/, '');
    if (!texto.trim()) { z.arquivo = null; z.msg = 'O arquivo está vazio.'; render(); return; }
    z.arquivo = { nome: arquivo.name, texto }; render();
  }

  const carimbo = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`; };
  const nomeSeguro = nome => String(nome || 'recomendacoes.txt').replace(/[^\w .()-]/g, '_').replace(/\.[^.]*$/, '').slice(0, 80) + '.txt';
  const enderecoRotina = m => `painel://extrair?alvo=${ALVO}&magistrada=${m}`;

  async function enviar() {
    const z = Z();
    if (z.enviando || !z.arquivo || !z.pasta) return;
    z.enviando = true; z.msg = ''; z.erroPasta = ''; render();
    try {
      // primeiro passo, ainda dentro do clique: a permissão de escrita só pode ser pedida por um gesto do Gestor
      if ((await z.pasta.queryPermission(RW)) !== 'granted' && (await z.pasta.requestPermission(RW)) !== 'granted') throw new Error('Sem permissão de escrita na pasta. Clique em “Liberar a pasta”.');
      const dir = await pastaDaMagistrada(z.mag, false);
      const recebidos = await dir.getDirectoryHandle('Recebidos', { create: true });
      const nome = `${carimbo()}_${nomeSeguro(z.arquivo.nome)}`;
      const w = await (await recebidos.getFileHandle(nome, { create: true })).createWritable();
      await w.write(z.arquivo.texto); await w.close();
      z.pedido = Date.now(); z.status = null; z.envio = null;
      z.msg = `Arquivo salvo em “${PASTA[z.mag]}\\Recebidos”. Pedido enviado: aguardando a rotina começar (se o Edge perguntar, permita abrir o aplicativo do painel).`;
      const a = document.createElement('a'); a.href = enderecoRotina(z.mag); document.body.appendChild(a); a.click(); a.remove();
      acompanhar();
    } catch (e) { console.error(e); z.msg = (e && e.message) || 'Não consegui salvar o arquivo na pasta.'; }
    finally { z.enviando = false; render(); }
  }

  // ---------- ler a pasta da magistrada, prévia e gravação ----------
  async function sha256(texto) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function numerosDasFilas() {
    const m = new Map();
    for (const r of st.filas || []) for (const i of r.itens || []) { const n = digitos(i.n); if (!m.has(n) || (!m.get(n).s && i.s)) m.set(n, i); }
    return m;
  }
  async function lerPasta(m) {
    const lidas = [], erros = [];
    const dir = await pastaDaMagistrada(m, false);
    for await (const h of dir.values()) {
      if (h.kind !== 'file' || !/_Recomendacao\.md$/i.test(h.name)) continue;
      const f = await h.getFile();
      let texto = '';
      try { texto = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer()); }
      catch (e) { erros.push({ arquivo: h.name, numero: (digitos(h.name).match(/^\d{20}/) || [''])[0], erro: 'não está em UTF-8' }); continue; }
      const rec = R.lerRecomendacao(texto, h.name);
      if (rec.erro) { erros.push({ arquivo: h.name, numero: rec.numero, erro: rec.erro }); continue; }
      if (rec.magistrada !== m) { erros.push({ arquivo: h.name, numero: rec.numero, erro: `é da ${rec.magistrada}, mas está na pasta da ${m}` }); continue; }
      rec.hash = await sha256(rec.texto);
      lidas.push(rec);
    }
    return { lidas, erros };
  }

  async function verificar() {
    const z = Z(), m = z.mag;
    z.envio = { estado: 'lendo', m }; render();
    z.permissao = await situacaoPasta();
    if (z.permissao !== 'granted') { z.envio = null; render(); return; }
    try {
      const filas = numerosDasFilas(), { lidas, erros } = await lerPasta(m);
      const atuais = Object.entries(z.lista).filter(([, v]) => v.some(r => r.magistrada === m)).map(([n, v]) => [n, v.find(r => r.magistrada === m)]);
      const gravadas = Object.fromEntries(atuais);
      const itens = lidas.map(rec => {
        const item = filas.get(rec.numero), atual = gravadas[rec.numero];
        const sit = !item ? 'fora' : !atual ? 'nova' : atual.hash === rec.hash ? 'igual' : 'substitui';
        return { rec, sit, velha: item ? R.recomendacaoDesatualizada({ dataArquivo: rec.dataArquivo }, item) : '' };
      }).sort((a, b) => a.rec.numero.localeCompare(b.rec.numero));
      const entram = new Set(itens.filter(i => i.sit !== 'fora').map(i => i.rec.numero));
      z.envio = { estado: 'ok', m, pasta: PASTA[m], em: Date.now(), itens, erros: erros.filter(e => !e.numero || filas.has(e.numero)), saem: atuais.filter(([n]) => !entram.has(n)).length };
    } catch (e) { console.error(e); z.envio = { estado: 'erro', m, msg: e.message || String(e) }; }
    render();
  }

  async function gravar() {
    const z = Z(), x = z.envio;
    if (!x || x.estado !== 'ok' || z.gravando) return;
    const entram = x.itens.filter(i => i.sit !== 'fora');
    if (!entram.length) return;
    z.gravando = true; render();
    try {
      const itens = entram.map(({ rec }) => ({ numero: rec.numero, resumo: rec.resumo, sem_leitura: rec.semLeitura, texto: rec.texto, data_arquivo: rec.dataArquivo || null, hash: rec.hash, arquivo: rec.arquivo }));
      const { error } = await st.sb.rpc('substituir_analises_juiza', { p_magistrada: x.m, p_itens: itens });
      if (error) throw error;
      for (const k of Object.keys(z.textos)) if (k.endsWith('|' + x.m)) delete z.textos[k];
      await P.carregarRecomendacoes();
      z.envio = null;
      toast(`Recomendações da juíza (${x.m}): ${plural(itens.length, 'gravada', 'gravadas')}.`);
    } catch (e) { falha(e); }
    finally { z.gravando = false; render(); }
  }

  // ---------- quadro em Rotinas com IA ----------
  const SIT_TEXTO = { nova: 'Nova', substitui: 'Substitui a atual', igual: 'Sem mudança', fora: 'Fora das filas' };
  const hora = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  const balao = t => `data-balao="${esc(t)}" aria-description="${esc(t)}"`;

  function linhaPasta() {
    const z = Z(), sit = z.permissao, b = (acao, txt) => `<button class="btn" type="button" data-jzacao="${acao}">${txt}</button>`;
    if (sit === 'granted') return `<div class="small muted ia-pasta">Pasta “${esc(z.pasta.name)}” liberada para leitura e gravação. ${b('escolher', 'Trocar pasta')}</div>`;
    if (sit === 'sem-pasta') return `<div class="aviso novo">Escolha a pasta <b>_Processos (Download)</b> (a que tem “Análise JS” e “Análise JT”). O painel grava nela o arquivo da juíza e lê o resultado; não grava mais nada. ${b('escolher', 'Escolher a pasta')}</div>`;
    if (sit === 'prompt' || sit === 'denied') return `<div class="aviso novo">A pasta “${esc(z.pasta.name)}” precisa ser liberada de novo neste navegador, com permissão para gravar. ${b('liberar', 'Liberar a pasta')} ${b('escolher', 'Escolher outra pasta')}</div>`;
    if (sit === 'sem-suporte') return '<div class="aviso erro">Este navegador não lê nem grava pastas do computador (use o Edge ou o Chrome).</div>';
    return '';
  }

  function andamento() {
    const z = Z(), s = z.status, ped = z.pedido;
    if (z.msg) return `<p class="small" role="status">${esc(z.msg)}</p>`;
    if (ped && (!s || Date.parse(s.atualizado_em) < ped - 5000)) return '<p class="small" role="status">Pedido enviado. Aguardando a rotina começar… (se o Edge perguntar, permita abrir o aplicativo do painel.)</p>';
    if (!s) return '';
    const itens = Array.isArray(s.processos) ? s.processos.filter(x => x && /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(String(x.numero || ''))) : [];
    const tabela = itens.length ? `<div class="tabela-wrap"><table><thead><tr><th>Processo</th><th>Situação</th></tr></thead><tbody>
      ${itens.map(x => `<tr><td class="mono">${esc(x.numero)}</td><td>${esc(x.situacao || '')}${x.erro ? `<div class="small muted">${esc(x.erro)}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '';
    const estado = { em_andamento: 'Em andamento', concluido: 'Concluída', erro: 'Não terminou', cancelado: 'Cancelada' }[s.estado] || s.estado || '';
    return `<p class="small" role="status"><b>${esc(estado)}</b> · ${esc(hora(s.atualizado_em))}${s.mensagem ? ' — ' + esc(s.mensagem) : ''}</p>${tabela}`;
  }

  function previa() {
    const z = Z(), x = z.envio;
    if (!x) return '';
    if (x.estado === 'lendo') return '<p class="small muted">Lendo a pasta…</p>';
    if (x.estado === 'erro') return `<div class="aviso erro">Não consegui ler a pasta (${esc(x.msg)}).</div>`;
    const conta = s => x.itens.filter(i => i.sit === s).length;
    const entram = x.itens.filter(i => i.sit !== 'fora');
    const nFora = conta('fora'), nVelhas = entram.filter(i => i.velha).length;
    const linhas = x.itens.map(i => `<tr><td class="mono">${numeroHTML(fmtCNJ(i.rec.numero))}</td><td>${esc(i.rec.resumo)}${i.rec.semLeitura ? '<div class="small muted">sem leitura dos autos</div>' : ''}</td><td>${SIT_TEXTO[i.sit]}${i.velha ? `<div class="small muted">${esc(i.velha)}</div>` : ''}</td></tr>`).join('');
    const erros = x.erros.length ? `<div class="aviso erro"><b>${plural(x.erros.length, 'arquivo não será gravado', 'arquivos não serão gravados')}</b>: ${x.erros.slice(0, 6).map(e => `${esc(e.arquivo)} (${esc(e.erro)})`).join('; ')}${x.erros.length > 6 ? '…' : ''}.</div>` : '';
    return `<div class="previa">
      <div><b>Pasta “${esc(x.pasta)}”</b> lida às ${esc(dataHoraBR(x.em).split(' ').pop())}.</div>
      <div class="small"><b class="mono">${conta('nova')}</b> ${conta('nova') === 1 ? 'nova' : 'novas'} · <b class="mono">${conta('substitui')}</b> para substituir · <b class="mono">${conta('igual')}</b> sem mudança${nFora ? ` · <b class="mono">${nFora}</b> de processos fora das filas (não entram)` : ''}.</div>
      <div class="aviso novo"><b>Gravar substitui tudo o que há da ${esc(x.m)} no painel</b> pelas ${plural(entram.length, 'recomendação desta pasta', 'recomendações desta pasta')}${x.saem ? `; ${plural(x.saem, 'processo sai', 'processos saem')} do painel` : ''}.</div>
      ${nVelhas ? `<div class="small muted">${plural(nVelhas, 'recomendação já entra marcada', 'recomendações já entram marcadas')} como desatualizada: o processo chegou à tarefa depois do arquivo da juíza.</div>` : ''}
      ${x.itens.length ? `<div class="tabela-wrap"><table><thead><tr><th>Processo</th><th>Recomendação</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table></div>` : '<p class="small muted">A pasta não tem nenhum arquivo “_Recomendacao.md”.</p>'}
      ${erros}
      <div class="linha-botoes">
        <button class="btn primario" type="button" data-jzacao="gravar"${z.gravando || !entram.length ? ' disabled' : ''}>${z.gravando ? 'Gravando…' : `Gravar ${entram.length === 1 ? 'a recomendação' : entram.length + ' recomendações'}`}</button>
        <button class="btn" type="button" data-jzacao="cancelar-envio">${entram.length ? 'Cancelar' : 'Fechar'}</button>
      </div>
    </div>`;
  }

  P.painelRecomendacoesGestao = function () {
    if (st.perfil !== 'gestor') return '';
    const z = Z(), pronta = z.permissao === 'granted';
    const lendo = z.envio && z.envio.estado === 'lendo';
    const gravadas = Object.values(z.lista).flat();
    const nJS = gravadas.filter(r => r.magistrada === 'JS').length, nJT = gravadas.filter(r => r.magistrada === 'JT').length;
    const resumo = !z.carregada ? '<p class="small muted">Carregando…</p>' : `<p class="small"><b class="mono">${nJS}</b> da JS (Substituta) · <b class="mono">${nJT}</b> da JT (Titular)${z.ultimaGravacao ? ` · última gravação em ${esc(dataHoraBR(z.ultimaGravacao))}` : ''}.</p>`;
    const radio = m => `<label><input type="radio" name="jz-mag" value="${m}"${z.mag === m ? ' checked' : ''}> ${m} (${NOME[m]})</label>`;
    const ir = !z.pedido && !z.enviando && z.arquivo && pronta;
    const fallback = z.pedido ? `<p class="small muted">Se o Edge não perguntou nada, <a href="${esc(enderecoRotina(z.mag))}" data-jzacao="relancar">peça a rotina de novo</a>.</p>` : '';
    return `<section class="painel" id="painel-recomendacoes">
      <h2>Recomendações da juíza</h2>
      <p>Envie o arquivo de recomendações que a juíza gerou (um .txt com vários processos). A IA, neste computador, lê o arquivo e grava uma recomendação por processo na pasta da magistrada (“Análise JS” ou “Análise JT”); depois você confere e grava no painel. A recomendação aparece na linha do processo, para quem tem o processo na fila. Cada envio substitui o que havia daquela magistrada. É uma sugestão da IA a partir do arquivo: não substitui a leitura do documento citado.</p>
      <p class="small muted">As análises da IA do Gestor não são afetadas por este quadro.</p>
      ${linhaPasta()}
      ${z.erroPasta ? `<div class="aviso erro">${esc(z.erroPasta)}</div>` : ''}
      <div class="jz-mag" role="radiogroup" aria-label="Magistrada">${radio('JS')}${radio('JT')}</div>
      <label class="campo"><span>Arquivo da juíza (.txt)</span><input id="jz-arquivo" type="file" accept=".txt,text/plain"></label>
      ${z.arquivo ? `<p class="small">Arquivo escolhido: <b>${esc(z.arquivo.nome)}</b> (${z.arquivo.texto.length.toLocaleString('pt-BR')} caracteres).</p>` : ''}
      <div class="linha-botoes">
        <button class="btn primario" type="button" data-jzacao="enviar"${ir ? '' : ' disabled'} ${balao('Salva o arquivo na pasta da magistrada e pede à IA, neste computador, para ler. O login e o Claude continuam seus.')}>${z.enviando ? 'Enviando…' : z.pedido ? 'Em andamento…' : 'Enviar e processar'}</button>
        ${pronta ? `<button class="btn" type="button" data-jzacao="verificar"${lendo ? ' disabled' : ''} ${balao('Lê os arquivos já gerados na pasta da magistrada escolhida e mostra o que será gravado')}>${lendo ? 'Verificando…' : 'Verificar a pasta'}</button>` : ''}
      </div>
      ${andamento()}
      ${fallback}
      ${previa()}
      <h3>Recomendações no painel</h3>
      ${resumo}
    </section>`;
  };

  // ---------- eventos ----------
  document.addEventListener('change', e => {
    if (e.target.id === 'jz-arquivo') lerArquivoEscolhido(e.target.files && e.target.files[0]);
    else if (e.target.name === 'jz-mag') { const z = Z(); z.mag = e.target.value === 'JT' ? 'JT' : 'JS'; z.envio = null; render(); }
  });
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-jzacao]'); if (!el) return;
    const acao = el.dataset.jzacao, z = Z();
    try {
      if (acao === 'abrir') await abrir(el.dataset.n, el.dataset.m, el.dataset.velha);
      else if (acao === 'fechar' || (acao === 'fechar-fundo' && e.target === el)) { z.modal = null; renderModal(); }
      else if (acao === 'copiar' && z.modal) { await navigator.clipboard.writeText(z.textos[chaveTexto(z.modal.n, z.modal.m)]); toast('Recomendação copiada.'); }
      else if (acao === 'escolher') { z.envio = null; await escolherPasta(); }
      else if (acao === 'liberar') { z.envio = null; await liberarPasta(); }
      else if (acao === 'enviar') await enviar();
      else if (acao === 'verificar') await verificar();
      else if (acao === 'gravar') await gravar();
      else if (acao === 'cancelar-envio') { z.envio = null; render(); }
      else if (acao === 'relancar') { z.pedido = Date.now(); z.status = null; z.msg = ''; setTimeout(() => { render(); acompanhar(); }, 0); }   // o link painel:// segue o caminho normal
    } catch (err) { falha(err); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.juiza && st.juiza.modal) { st.juiza.modal = null; renderModal(); } });

  if (st.estado === 'ok') P.carregarRecomendacoes().then(render);
  atualizarSituacao().then(() => { if (st.perfil === 'gestor') render(); });
})();
