/* Fila de Trabalho da Vara — análises da IA.
   A análise do encaminhamento de um processo (<número>_Analise.md, feita pelo Claude a partir da cópia integral dos autos)
   aparece na linha dele: uma etiqueta com o caminho sugerido (balão com o motivo) que abre a análise inteira numa janela.
   As análises entram junto com a lista do PJe+R: na prévia da importação o painel lê a pasta das análises (permissão do
   Gestor, guardada no navegador, só leitura) e, ao gravar a lista, grava as dos processos que estão nas filas e apaga as dos
   que saíram. Leitura: todo perfil com acesso; gravação: só o Gestor (RLS, sql/analises_ia.sql). */
(function () {
  'use strict';
  const P = window.PAINEL;
  if (!P || !P.render) return;
  const { st, R, esc, toast, falha, todas } = P;
  const $ = sel => document.querySelector(sel);
  const render = () => P.render();
  const fmtCNJ = n => (n && n.length === 20 ? `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16)}` : n);
  const digitos = s => String(s == null ? '' : s).replace(/\D/g, '');
  const dataAnalise = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const SUPORTE = typeof window.showDirectoryPicker === 'function';

  // lista: { número com 20 dígitos: { caminho, motivo, tarefa, analisadoEm, hash } } (sem o texto, buscado ao abrir).
  const A = () => st.analises || (st.analises = { lista: {}, textos: {}, modal: null, pasta: null, permissao: 'desconhecida' });

  P.carregarAnalises = async function () {
    const a = A();
    try {
      const linhas = await todas((x, y) => st.sb.from('analises_ia').select('numero,caminho,motivo,tarefa,analisado_em,hash').order('numero').range(x, y));
      a.lista = Object.fromEntries(linhas.map(r => [r.numero, { caminho: r.caminho, motivo: r.motivo || '', tarefa: r.tarefa || '', analisadoEm: r.analisado_em || '', hash: r.hash }]));
    } catch (e) { console.error(e); }
  };

  // Etiqueta na linha da fila (todo perfil que vê o processo). Só leitura: não depende do "ver como".
  P.etiquetaAnalise = function (l) {
    const n = digitos(l.n), an = A().lista[n];
    if (!an) return '';
    const velha = R.analiseDesatualizada(an, l);
    const data = dataAnalise(an.analisadoEm);
    const balao = [velha, an.motivo ? `${an.caminho}: ${an.motivo}` : an.caminho, `Análise da IA${data ? ' de ' + data : ''}. Clique para ler a análise completa.`].filter(Boolean).join(' ');
    return `<div class="ia-linha"><button class="ia-etq${velha ? ' velha' : ''}" type="button" data-iaacao="abrir" data-n="${esc(n)}" data-velha="${esc(velha)}" data-balao="${esc(balao)}" aria-description="${esc(balao)}"><span class="ia-rot">IA</span><span class="ia-cam">${esc(an.caminho)}</span>${velha ? '<span class="ia-velha">desatualizada</span>' : ''}</button></div>`;
  };

  // ---------- janela ----------
  function renderModal() {
    const el = $('#modal-analise'); if (!el) return;
    const a = A(), s = a.modal;
    if (!s) { el.innerHTML = ''; return; }
    const t = a.textos[s.n];
    const corpo = t == null ? (s.erro ? '<p class="aviso erro">Não foi possível abrir a análise agora.</p>' : '<p>Carregando…</p>') : `<div class="ia-texto">${R.mdParaHtml(t)}</div>`;
    el.innerHTML = `<div class="modal-fundo" data-iaacao="fechar-fundo"><div class="modal em-modal" role="dialog" aria-modal="true" aria-labelledby="ia-modal-tit">
      <h2 id="ia-modal-tit">Análise da IA · <span class="mono">${esc(fmtCNJ(s.n))}</span></h2>
      <div class="corpo">
        ${s.velha ? `<div class="aviso novo"><b>Pode estar desatualizada.</b> ${esc(s.velha)} Confira no PJe.</div>` : ''}
        ${corpo}
        <div class="linha-botoes">
          <button class="btn primario" type="button" data-iaacao="copiar"${t == null ? ' disabled' : ''}>Copiar</button>
          <button class="btn" type="button" data-iaacao="baixar"${t == null ? ' disabled' : ''}>Baixar .md</button>
          <button class="btn" type="button" data-iaacao="fechar">Fechar</button>
        </div>
      </div></div></div>`;
    const foco = el.querySelector('[data-iaacao="copiar"]:not([disabled])') || el.querySelector('[data-iaacao="fechar"]');
    if (foco && !el.contains(document.activeElement)) foco.focus();
  }

  async function abrir(n, velha) {
    const a = A();
    a.modal = { n, velha: velha || '', erro: false }; renderModal();
    if (a.textos[n] == null) {
      const { data, error } = await st.sb.from('analises_ia').select('texto').eq('numero', n).maybeSingle();
      if (error || !data) { console.error(error); if (a.modal && a.modal.n === n) a.modal.erro = true; renderModal(); return; }
      a.textos[n] = data.texto;
    }
    renderModal();
  }

  function baixarMd(n) {
    const url = URL.createObjectURL(new Blob([A().textos[n]], { type: 'text/markdown;charset=utf-8' }));
    const el = document.createElement('a'); el.href = url; el.download = fmtCNJ(n) + '_Analise.md';
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------- pasta das análises (mesma técnica da pasta "entrada" do Extrair agora) ----------
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

  async function situacaoPasta() {
    const a = A();
    if (!SUPORTE) return 'sem-suporte';
    if (!a.pasta) a.pasta = await bdLer('pasta-analises');
    if (!a.pasta) return 'sem-pasta';
    try { return await a.pasta.queryPermission({ mode: 'read' }); }
    catch (e) { console.error(e); a.erroPasta = `${e.name || 'Erro'}: ${e.message || e}`; return 'sem-pasta'; }
  }

  async function atualizarSituacao() { A().situacao = await situacaoPasta(); }

  // Linha fixa no painel "Enviar relatório do PJe+R" (antes de escolher o arquivo): mostra se a pasta está liberada.
  P.linhaPastaAnalises = function () {
    if (st.perfil !== 'gestor') return '';
    const erro = A().erroPasta ? `<div class="aviso erro">Não consegui usar a pasta das análises: ${esc(A().erroPasta)}</div>` : '';
    return linhaPasta() + erro;
  };
  function linhaPasta() {
    const sit = A().situacao, b = (acao, txt) => `<button class="btn" type="button" data-iaacao="${acao}">${txt}</button>`;
    if (sit === 'granted') return `<div class="small muted ia-pasta">Análises da IA: pasta “${esc(A().pasta.name)}” liberada. As análises dos processos da lista entram ao gravar. ${b('escolher', 'Trocar pasta')}</div>`;
    if (sit === 'sem-pasta') return `<div class="small ia-pasta">Análises da IA: escolha a pasta <b>Análise</b> (em “_Processos (Download)”) para o painel incluir as análises nos processos da lista. ${b('escolher', 'Escolher a pasta das análises')}</div>`;
    if (sit === 'prompt' || sit === 'denied') return `<div class="small ia-pasta">Análises da IA: a pasta “${esc(A().pasta.name)}” precisa ser liberada de novo neste navegador. ${b('liberar', 'Liberar a pasta')} ${b('escolher', 'Escolher outra pasta')}</div>`;
    if (sit === 'sem-suporte') return '<div class="small muted ia-pasta">Análises da IA: este navegador não lê pastas do computador (use o Edge ou o Chrome).</div>';
    return '';
  }

  async function sha256(texto) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  // Números da lista nova (filas dos servidores, do diretor e do gestor). Na lista "para uma pessoa", as filas das outras continuam.
  function numerosDaImportacao(imp) {
    const s = new Set();
    const somar = itens => (itens || []).forEach(i => s.add(digitos(i.n)));
    Object.values(imp.resultado.porPessoa || {}).forEach(somar);
    if (imp.especiais) { somar(imp.especiais.gestor); somar(imp.especiais.diretor); }
    if (imp.pessoaFixa) for (const r of st.filas || []) if (r.pessoa !== imp.pessoaFixa) somar(r.itens);
    return s;
  }
  function numerosDasFilas() {
    const s = new Set();
    for (const r of st.filas || []) for (const i of r.itens || []) s.add(digitos(i.n));
    return s;
  }

  // Prévia: lê a pasta e cruza com a lista nova. Erros aqui nunca impedem a importação.
  P.prepararAnalises = async function (imp) {
    if (st.perfil !== 'gestor' || !imp || !imp.resultado) return;
    const sit = await situacaoPasta(); A().situacao = sit;
    if (sit !== 'granted') { imp.analises = { estado: sit }; return; }
    try {
      const naLista = numerosDaImportacao(imp), atuais = A().lista;
      const lidas = [], erros = [];
      for await (const h of A().pasta.values()) {
        if (h.kind !== 'file' || !/_Analise\.md$/i.test(h.name)) continue;
        const f = await h.getFile();
        let texto = '';
        try { texto = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer()); }
        catch (e) { erros.push({ arquivo: h.name, erro: 'não está em UTF-8' }); continue; }
        const an = R.lerAnalise(texto, h.name);
        if (an.erro) { if (!an.numero || naLista.has(an.numero)) erros.push({ arquivo: h.name, erro: an.erro }); continue; }
        an.hash = await sha256(an.texto);
        lidas.push(an);
      }
      const daLista = lidas.filter(x => naLista.has(x.numero));
      imp.analises = {
        estado: 'ok', lidas, erros, pasta: A().pasta.name,
        novas: daLista.filter(x => !atuais[x.numero]).length,
        atualizadas: daLista.filter(x => atuais[x.numero] && atuais[x.numero].hash !== x.hash).length,
        iguais: daLista.filter(x => atuais[x.numero] && atuais[x.numero].hash === x.hash).length,
        foraDaLista: lidas.length - daLista.length,
        saem: Object.keys(atuais).filter(n => !naLista.has(n)).length,
      };
    } catch (e) {
      console.error(e);
      imp.analises = { estado: 'erro', msg: e.message || String(e) };
    }
  };

  P.previaAnalises = function (imp) {
    const x = imp && imp.analises;
    if (st.perfil !== 'gestor' || !x) return '';
    const b = (acao, txt) => `<button class="btn" type="button" data-iaacao="${acao}">${txt}</button>`;
    if (x.estado === 'sem-suporte') return '<div class="small muted">Análises da IA: este navegador não lê pastas do computador (use o Edge ou o Chrome).</div>';
    if (x.estado === 'sem-pasta') return `<div class="small">Análises da IA: escolha a pasta <b>Análise</b> (em “_Processos (Download)”) para o painel incluir as análises nos processos da lista. ${b('escolher', 'Escolher a pasta das análises')}</div>`;
    if (x.estado === 'prompt' || x.estado === 'denied') return `<div class="small">Análises da IA: a pasta das análises precisa ser liberada de novo neste navegador. ${b('liberar', 'Liberar a pasta')} ${b('escolher', 'Escolher outra pasta')}</div>`;
    if (x.estado === 'erro') return `<div class="aviso erro">Não consegui ler a pasta das análises (${esc(x.msg)}). A lista pode ser gravada assim mesmo. ${b('escolher', 'Escolher a pasta de novo')}</div>`;
    const partes = [];
    if (x.novas) partes.push(`<b class="mono">${x.novas}</b> ${x.novas === 1 ? 'nova' : 'novas'}`);
    if (x.atualizadas) partes.push(`<b class="mono">${x.atualizadas}</b> ${x.atualizadas === 1 ? 'atualizada' : 'atualizadas'}`);
    if (x.iguais) partes.push(`<b class="mono">${x.iguais}</b> sem mudança`);
    if (x.saem) partes.push(`<b class="mono">${x.saem}</b> de processos fora da lista ${x.saem === 1 ? 'sai' : 'saem'} do painel`);
    const erros = x.erros.length ? `<div class="aviso erro"><b>${x.erros.length} ${x.erros.length === 1 ? 'análise não será gravada' : 'análises não serão gravadas'}</b>: ${x.erros.slice(0, 6).map(e => `${esc(e.arquivo)} (${esc(e.erro)})`).join('; ')}${x.erros.length > 6 ? '…' : ''}.</div>` : '';
    return `<div class="small">Análises da IA (pasta “${esc(x.pasta)}”): ${partes.length ? partes.join(' · ') : 'nenhuma para os processos desta lista'}. ${b('escolher', 'Trocar pasta')}</div>${erros}`;
  };

  // Depois de gravar a lista: grava as análises dos processos que estão nas filas e apaga as dos que saíram.
  P.gravarAnalises = async function (imp) {
    const x = imp && imp.analises;
    if (st.perfil !== 'gestor' || !x || x.estado !== 'ok') return;
    try {
      const nasFilas = numerosDasFilas(), atuais = A().lista;
      const gravar = x.lidas.filter(an => nasFilas.has(an.numero) && (!atuais[an.numero] || atuais[an.numero].hash !== an.hash))
        .map(an => ({ numero: an.numero, caminho: an.caminho, motivo: an.motivo || null, tarefa: an.tarefa || null, analisado_em: an.analisadoEm || null, texto: an.texto, hash: an.hash, arquivo: an.arquivo, gravado_em: new Date().toISOString() }));
      const apagar = Object.keys(atuais).filter(n => !nasFilas.has(n));
      for (let i = 0; i < gravar.length; i += 50) {
        const { error } = await st.sb.from('analises_ia').upsert(gravar.slice(i, i + 50), { onConflict: 'numero' });
        if (error) throw error;
      }
      for (let i = 0; i < apagar.length; i += 200) {
        const { error } = await st.sb.from('analises_ia').delete().in('numero', apagar.slice(i, i + 200));
        if (error) throw error;
      }
      for (const n of [...gravar.map(g => g.numero), ...apagar]) delete A().textos[n];
      await P.carregarAnalises();
      if (gravar.length || apagar.length) toast(`Análises da IA: ${gravar.length} ${gravar.length === 1 ? 'gravada' : 'gravadas'}${apagar.length ? `, ${apagar.length} ${apagar.length === 1 ? 'retirada' : 'retiradas'}` : ''}.`);
    } catch (e) {
      console.error(e);
      toast('A lista foi gravada, mas as análises da IA não. Envie a lista de novo para tentar outra vez.');
    }
  };

  async function escolherPasta() {
    const a = A();
    a.erroPasta = '';
    try { a.pasta = await window.showDirectoryPicker({ id: 'painel-analises', mode: 'read' }); }
    catch (e) {
      if (e && e.name === 'AbortError') return;   // o Gestor cancelou
      console.error(e); a.erroPasta = `${e.name || 'Erro'}: ${e.message || e}`; render(); return;
    }
    await bdGravar('pasta-analises', a.pasta);
    await atualizarSituacao();
    await P.prepararAnalises(st.importacao); render();
  }
  async function liberarPasta() {
    const a = A();
    if (!a.pasta) return escolherPasta();
    a.erroPasta = '';
    try { await a.pasta.requestPermission({ mode: 'read' }); }
    catch (e) { console.error(e); a.erroPasta = `${e.name || 'Erro'}: ${e.message || e}`; }
    await atualizarSituacao();
    await P.prepararAnalises(st.importacao); render();
  }

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-iaacao]'); if (!el) return;
    const acao = el.dataset.iaacao, a = A();
    try {
      if (acao === 'abrir') await abrir(el.dataset.n, el.dataset.velha);
      else if (acao === 'fechar' || (acao === 'fechar-fundo' && e.target === el)) { a.modal = null; renderModal(); }
      else if (acao === 'copiar' && a.modal) { await navigator.clipboard.writeText(a.textos[a.modal.n]); toast('Análise copiada.'); }
      else if (acao === 'baixar' && a.modal) baixarMd(a.modal.n);
      else if (acao === 'escolher') await escolherPasta();
      else if (acao === 'liberar') await liberarPasta();
    } catch (err) { falha(err); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.analises && st.analises.modal) { st.analises.modal = null; renderModal(); } });

  if (st.estado === 'ok') P.carregarAnalises().then(render);
  atualizarSituacao().then(() => { if (st.perfil === 'gestor') render(); });
})();
