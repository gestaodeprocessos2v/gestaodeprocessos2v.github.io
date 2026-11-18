/* Fila de Trabalho da Vara — análises da IA.
   A análise do encaminhamento de um processo (<número>_Analise.md, feita pelo Claude a partir da cópia integral dos autos)
   aparece na linha dele: uma etiqueta com o caminho sugerido (balão com o motivo) que abre a análise inteira numa janela.
   As análises entram de dois jeitos, sempre lidas da pasta das análises (permissão do Gestor, guardada no navegador, só leitura):
   - junto com a lista do PJe+R: ao gravar a lista, grava as dos processos que estão nas filas e apaga as dos que saíram;
   - pelo painel "Enviar análises da IA" da Gestão, a qualquer momento: grava as novas e as alteradas dos processos das filas,
     sem apagar nada (lá também ficam o resumo do que está gravado, a Triagem inicial sem análise e "Retirar uma análise").
   Leitura: todo perfil com acesso; gravação: só o Gestor (RLS, sql/analises_ia.sql). */
(function () {
  'use strict';
  const P = window.PAINEL;
  if (!P || !P.render) return;
  const { st, R, esc, toast, falha, todas, dataHoraBR, numeroHTML } = P;
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
      const linhas = await todas((x, y) => st.sb.from('analises_ia').select('numero,caminho,motivo,tarefa,analisado_em,hash,gravado_em').order('numero').range(x, y));
      a.lista = Object.fromEntries(linhas.map(r => [r.numero, { caminho: r.caminho, motivo: r.motivo || '', tarefa: r.tarefa || '', analisadoEm: r.analisado_em || '', hash: r.hash, gravadoEm: Date.parse(r.gravado_em) || null }]));
      a.ultimaGravacao = linhas.reduce((m, r) => Math.max(m, Date.parse(r.gravado_em) || 0), 0) || null;
      a.carregada = true;
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

  // Linha da pasta no painel "Enviar análises da IA": mostra se a pasta está liberada (a mesma pasta serve ao envio do PJe+R).
  function linhaPasta() {
    const sit = A().situacao, b = (acao, txt) => `<button class="btn" type="button" data-iaacao="${acao}">${txt}</button>`;
    if (sit === 'granted') return `<div class="small muted ia-pasta">Pasta “${esc(A().pasta.name)}” liberada. Ela também é lida no envio do relatório do PJe+R. ${b('escolher', 'Trocar pasta')}</div>`;
    if (sit === 'sem-pasta') return `<div class="small ia-pasta">Escolha a pasta <b>Análise</b> (em “_Processos (Download)”). ${b('escolher', 'Escolher a pasta das análises')}</div>`;
    if (sit === 'prompt' || sit === 'denied') return `<div class="small ia-pasta">A pasta “${esc(A().pasta.name)}” precisa ser liberada de novo neste navegador. ${b('liberar', 'Liberar a pasta')} ${b('escolher', 'Escolher outra pasta')}</div>`;
    if (sit === 'sem-suporte') return '<div class="small muted ia-pasta">Este navegador não lê pastas do computador (use o Edge ou o Chrome).</div>';
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
  // Processos das filas atuais: número (20 dígitos) → item (o primeiro achado; o setor e a tarefa são os mesmos em todas).
  function itensDasFilas() {
    const m = new Map();
    for (const r of st.filas || []) for (const i of r.itens || []) { const n = digitos(i.n); if (!m.has(n) || (!m.get(n).s && i.s)) m.set(n, i); }
    return m;
  }
  const numerosDasFilas = () => new Set(itensDasFilas().keys());

  // Lê os <número>_Analise.md da pasta. erros: { arquivo, numero, erro } (numero '' quando o nome não traz o número).
  async function lerPasta() {
    const lidas = [], erros = [];
    for await (const h of A().pasta.values()) {
      if (h.kind !== 'file' || !/_Analise\.md$/i.test(h.name)) continue;
      const f = await h.getFile();
      let texto = '';
      try { texto = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer()); }
      catch (e) { erros.push({ arquivo: h.name, numero: (digitos(h.name).match(/^\d{20}/) || [''])[0], erro: 'não está em UTF-8' }); continue; }
      const an = R.lerAnalise(texto, h.name);
      if (an.erro) { erros.push({ arquivo: h.name, numero: an.numero, erro: an.erro }); continue; }
      an.hash = await sha256(an.texto);
      lidas.push(an);
    }
    return { lidas, erros };
  }

  const linhaBanco = an => ({ numero: an.numero, caminho: an.caminho, motivo: an.motivo || null, tarefa: an.tarefa || null, analisado_em: an.analisadoEm || null, texto: an.texto, hash: an.hash, arquivo: an.arquivo, gravado_em: new Date().toISOString() });

  // Prévia: lê a pasta e cruza com a lista nova. Erros aqui nunca impedem a importação.
  P.prepararAnalises = async function (imp) {
    if (st.perfil !== 'gestor' || !imp || !imp.resultado) return;
    const sit = await situacaoPasta(); A().situacao = sit;
    if (sit !== 'granted') { imp.analises = { estado: sit }; return; }
    try {
      const naLista = numerosDaImportacao(imp), atuais = A().lista;
      const lido = await lerPasta(), lidas = lido.lidas;
      const erros = lido.erros.filter(e => !e.numero || naLista.has(e.numero));
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
      const gravar = x.lidas.filter(an => nasFilas.has(an.numero) && (!atuais[an.numero] || atuais[an.numero].hash !== an.hash)).map(linhaBanco);
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

  // ---------- painel "Enviar análises da IA" (Gestão) ----------
  // Estado: A().envio = { estado: 'lendo' | 'ok' | 'erro', itens (R.classificarAnalises), erros, pasta, em, msg } ou null;
  // A().gravando; A().retirar = número em confirmação; A().retirarNum = o que foi digitado no campo.
  const SIT_TEXTO = { nova: 'Nova', substitui: 'Substitui a atual', igual: 'Sem mudança', fora: 'Fora das filas' };
  const diasDesde = ch => (ch == null ? null : Math.max(0, Math.floor((Date.now() - Number(ch)) / 86400000)));
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  async function verificarPasta() {
    const a = A();
    a.envio = { estado: 'lendo' }; render();
    a.situacao = await situacaoPasta();
    if (a.situacao !== 'granted') { a.envio = null; render(); return; }
    try {
      const filas = itensDasFilas(), { lidas, erros } = await lerPasta();
      a.envio = {
        estado: 'ok', pasta: a.pasta.name, em: Date.now(),
        itens: R.classificarAnalises(lidas, filas, a.lista),
        erros: erros.filter(e => !e.numero || filas.has(e.numero)),
      };
    } catch (e) { console.error(e); a.envio = { estado: 'erro', msg: e.message || String(e) }; }
    render();
  }

  async function gravarEnvio() {
    const a = A(), x = a.envio;
    if (!x || x.estado !== 'ok' || a.gravando) return;
    const gravar = x.itens.filter(i => i.sit === 'nova' || i.sit === 'substitui').map(i => linhaBanco(i.an));
    if (!gravar.length) return;
    a.gravando = true; render();
    try {
      for (let i = 0; i < gravar.length; i += 50) {
        const { error } = await st.sb.from('analises_ia').upsert(gravar.slice(i, i + 50), { onConflict: 'numero' });
        if (error) throw error;
      }
      for (const g of gravar) delete a.textos[g.numero];
      await P.carregarAnalises();
      a.envio = null;
      toast(`Análises da IA: ${plural(gravar.length, 'gravada', 'gravadas')}.`);
    } catch (e) { falha(e); }
    finally { a.gravando = false; render(); }
  }

  async function retirarAnalise(n) {
    const a = A();
    if (a.gravando) return;
    a.gravando = true; render();
    try {
      const { error } = await st.sb.from('analises_ia').delete().eq('numero', n);
      if (error) throw error;
      delete a.textos[n];
      await P.carregarAnalises();
      a.retirar = null; a.retirarNum = '';
      toast(`Análise do ${fmtCNJ(n)} retirada do painel.`);
    } catch (e) { falha(e); }
    finally { a.gravando = false; render(); }
  }

  function previaEnvio() {
    const a = A(), x = a.envio;
    if (!x) return '';
    if (x.estado === 'lendo') return '<p class="small muted">Lendo a pasta…</p>';
    if (x.estado === 'erro') return `<div class="aviso erro">Não consegui ler a pasta das análises (${esc(x.msg)}). ${'<button class="btn" type="button" data-iaacao="escolher">Escolher a pasta de novo</button>'}</div>`;
    const conta = s => x.itens.filter(i => i.sit === s).length;
    const nNova = conta('nova'), nSubst = conta('substitui'), nIgual = conta('igual'), nFora = conta('fora');
    const gravaveis = x.itens.filter(i => i.sit === 'nova' || i.sit === 'substitui')
      .sort((p, q) => (p.sit === q.sit ? p.an.numero.localeCompare(q.an.numero) : p.sit === 'nova' ? -1 : 1));
    const avisos = i => [i.maisAntiga && 'mais antiga que a do painel', i.velha && 'já desatualizada: ' + i.velha.replace(/\.$/, '').toLowerCase()].filter(Boolean);
    const nVelhas = gravaveis.filter(i => i.velha).length, nAntigas = gravaveis.filter(i => i.maisAntiga).length;
    const linhas = gravaveis.map(i => `<tr><td class="mono">${numeroHTML(fmtCNJ(i.an.numero))}</td><td>${esc(i.an.caminho)}</td><td>${SIT_TEXTO[i.sit]}${avisos(i).length ? `<div class="small muted">${esc(avisos(i).join('; '))}</div>` : ''}</td></tr>`).join('');
    const erros = x.erros.length ? `<div class="aviso erro"><b>${plural(x.erros.length, 'análise não será gravada', 'análises não serão gravadas')}</b>: ${x.erros.slice(0, 6).map(e => `${esc(e.arquivo)} (${esc(e.erro)})`).join('; ')}${x.erros.length > 6 ? '…' : ''}.</div>` : '';
    return `<div class="previa">
      <div><b>Pasta “${esc(x.pasta)}”</b> lida às ${esc(dataHoraBR(x.em).split(' ').pop())}.</div>
      <div class="small"><b class="mono">${nNova}</b> ${nNova === 1 ? 'nova' : 'novas'} (processo ainda sem análise no painel) · <b class="mono">${nSubst}</b> para substituir a análise que está no painel · <b class="mono">${nIgual}</b> sem mudança${nFora ? ` · <b class="mono">${nFora}</b> de processos fora das filas (não entram)` : ''}.</div>
      ${nAntigas ? `<div class="aviso novo"><b>${plural(nAntigas, 'análise é mais antiga', 'análises são mais antigas')}</b> que a que está no painel (pela data “Analisado em”). Gravar substitui a mais nova.</div>` : ''}
      ${nVelhas ? `<div class="small muted">${plural(nVelhas, 'análise já entra marcada', 'análises já entram marcadas')} como desatualizada: o processo mudou de tarefa ou chegou à tarefa depois da análise.</div>` : ''}
      ${gravaveis.length ? `<div class="tabela-wrap"><table><thead><tr><th>Processo</th><th>Caminho sugerido</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table></div>` : '<p class="small muted">Nada novo para gravar.</p>'}
      ${erros}
      <div class="linha-botoes">
        <button class="btn primario" type="button" data-iaacao="gravar"${a.gravando || !gravaveis.length ? ' disabled' : ''}>${a.gravando ? 'Gravando…' : `Gravar ${gravaveis.length === 1 ? 'a análise' : gravaveis.length + ' análises'}`}</button>
        <button class="btn" type="button" data-iaacao="cancelar-envio">${gravaveis.length ? 'Cancelar' : 'Fechar'}</button>
      </div>
    </div>`;
  }

  function botaoRetirar(n) {
    const a = A();
    if (a.retirar === n) return `<button class="btn perigo" type="button" data-iaacao="retirar-ok" data-n="${esc(n)}"${a.gravando ? ' disabled' : ''}>Confirmar</button> <button class="btn discreto" type="button" data-iaacao="retirar-nao">Cancelar</button>`;
    return `<button class="btn discreto" type="button" data-iaacao="retirar" data-n="${esc(n)}">Retirar</button>`;
  }

  // Análises gravadas, cada uma com o item atual da fila (para saber se está desatualizada).
  function gravadas() {
    const filas = itensDasFilas();
    return Object.entries(A().lista).map(([n, an]) => ({ n, an, item: filas.get(n), velha: filas.has(n) ? R.analiseDesatualizada(an, filas.get(n)) : '' }));
  }

  function semAnaliseNaTriagem() {
    const lista = A().lista;
    return [...itensDasFilas()].filter(([n, i]) => i.s === 'triagem' && !lista[n]).map(([n, i]) => ({ n, i }))
      .sort((p, q) => (p.i.ch == null) - (q.i.ch == null) || (p.i.ch || 0) - (q.i.ch || 0));
  }

  function planilhaVelhas() {
    const ls = gravadas().filter(g => g.velha);
    P.baixarPlanilha({
      arquivo: 'analises-desatualizadas', titulo: 'Análises da IA desatualizadas', aba: 'Desatualizadas', fonte: 'Análises gravadas no painel',
      colunas: [{ t: 'Número do processo', largura: 27 }, { t: 'Caminho sugerido', largura: 50 }, { t: 'Analisado em', largura: 14 }, { t: 'Tarefa da análise', largura: 40 }, { t: 'Tarefa atual', largura: 40 }, { t: 'Motivo', largura: 50 }],
      linhas: ls.map(g => [fmtCNJ(g.n), g.an.caminho, dataAnalise(g.an.analisadoEm), g.an.tarefa || '', (g.item && g.item.t) || '', g.velha]),
    });
  }

  // Conclusão no painel depois da gravação da análise: a marca mais recente (não desfeita) do processo, em qualquer fila,
  // com data posterior à gravação. Devolve { em, pessoa } ou null.
  function concluidoDepois(n, desde) {
    if (!desde || !P.marcasVigentesTodas) return null;
    let achou = null;
    for (const [pessoa, marcas] of Object.entries(P.marcasVigentesTodas())) {
      for (const [chave, m] of Object.entries(marcas || {})) {
        if (chave.split('|')[0] !== n || !m || m.desfeito || !m.em || m.em <= desde) continue;
        if (!achou || m.em > achou.em) achou = { em: m.em, pessoa };
      }
    }
    return achou;
  }

  function planilhaGravadas() {
    const ls = gravadas().sort((p, q) => p.n.localeCompare(q.n));
    const mudou = g => (!g.item ? 'Saiu das filas' : g.an.tarefa && g.item.t && R.normTexto(g.an.tarefa) !== R.normTexto(g.item.t) ? 'Sim' : 'Não');
    P.baixarPlanilha({
      arquivo: 'analises-gravadas', titulo: 'Análises da IA gravadas no painel', aba: 'Análises', fonte: 'Análises gravadas no painel e filas atuais',
      colunas: [{ t: 'Número do processo', largura: 27 }, { t: 'Caminho sugerido', largura: 50 }, { t: 'Analisado em', largura: 14 }, { t: 'Gravada no painel em', largura: 18 },
        { t: 'Tarefa da análise', largura: 40 }, { t: 'Tarefa atual', largura: 40 }, { t: 'Mudou de tarefa', largura: 16 },
        { t: 'Concluído no painel depois da gravação', largura: 20 }, { t: 'Concluído em', largura: 18 }, { t: 'Fila em que foi concluído', largura: 28 }, { t: 'Etiqueta na fila', largura: 50 }],
      linhas: ls.map(g => {
        const c = concluidoDepois(g.n, g.an.gravadoEm);
        return [fmtCNJ(g.n), g.an.caminho, dataAnalise(g.an.analisadoEm), g.an.gravadoEm ? dataHoraBR(g.an.gravadoEm) : '', g.an.tarefa || '', (g.item && g.item.t) || '', mudou(g),
          c ? 'Sim' : 'Não', c ? dataHoraBR(c.em) : '', c ? P.nomeDe(c.pessoa) : '', !g.item ? 'Não aparece (fora das filas)' : g.velha ? 'Desatualizada: ' + g.velha : 'Em dia'];
      }),
    });
  }

  function planilhaTriagem() {
    const ls = semAnaliseNaTriagem();
    P.baixarPlanilha({
      arquivo: 'triagem-sem-analise', titulo: 'Triagem inicial sem análise da IA', aba: 'Sem análise', fonte: 'Filas do painel',
      colunas: [{ t: 'Número do processo', largura: 27 }, { t: 'Classe', largura: 14 }, { t: 'Tarefa', largura: 48 }, { t: 'Data de chegada', tipo: 'data', largura: 15 }, { t: 'Dias na tarefa', tipo: 'numero', largura: 14 }],
      linhas: ls.map(({ i }) => [i.n, i.c || '', i.t || '', i.ch, diasDesde(i.ch)]),
    });
  }

  P.painelAnalisesGestao = function () {
    if (st.perfil !== 'gestor') return '';
    const a = A(), sit = a.situacao;
    const erroPasta = a.erroPasta ? `<div class="aviso erro">Não consegui usar a pasta das análises: ${esc(a.erroPasta)}</div>` : '';
    const lendo = a.envio && a.envio.estado === 'lendo';
    const verificar = sit === 'granted' && !(a.envio && a.envio.estado === 'ok')
      ? `<div class="linha-botoes"><button class="btn primario" type="button" data-iaacao="verificar"${lendo ? ' disabled' : ''}>${lendo ? 'Verificando…' : 'Verificar a pasta'}</button></div>` : '';

    const gs = gravadas(), velhas = gs.filter(g => g.velha), foraFilas = gs.filter(g => !g.item).length;
    const MAX = 10;
    const trVelha = g => `<tr><td class="mono">${numeroHTML(fmtCNJ(g.n))}</td><td>${esc(g.an.caminho)}<div class="small muted">${esc(g.velha)}</div></td><td>${botaoRetirar(g.n)}</td></tr>`;
    const resumo = !a.carregada ? '<p class="small muted">Carregando…</p>' : `
      <p class="small"><b class="mono">${gs.length}</b> ${gs.length === 1 ? 'análise gravada' : 'análises gravadas'}${gs.length ? ` · <b class="mono">${velhas.length}</b> ${velhas.length === 1 ? 'desatualizada' : 'desatualizadas'}` : ''}${foraFilas ? ` · <b class="mono">${foraFilas}</b> de processos que saíram das filas (saem no próximo envio do PJe+R)` : ''}${a.ultimaGravacao ? ` · última gravação em ${esc(dataHoraBR(a.ultimaGravacao))}` : ''}.</p>
      ${gs.length ? `<div class="linha-botoes"><button class="btn" type="button" data-iaacao="planilha-gravadas" data-balao="Baixa em .xlsx todas as análises gravadas, dizendo se o processo mudou de tarefa ou foi concluído no painel depois da gravação" aria-description="Baixa em .xlsx todas as análises gravadas, dizendo se o processo mudou de tarefa ou foi concluído no painel depois da gravação">Baixar planilha das análises gravadas</button></div>` : ''}
      ${velhas.length ? `<div class="tabela-wrap"><table><thead><tr><th>Processo</th><th>Caminho sugerido</th><th></th></tr></thead><tbody>${velhas.slice(0, MAX).map(trVelha).join('')}${velhas.length > MAX ? `<tr><td colspan="3" class="muted small">… e mais ${velhas.length - MAX} na planilha.</td></tr>` : ''}</tbody></table></div>
      <div class="linha-botoes"><button class="btn" type="button" data-iaacao="planilha-velhas" data-balao="Baixa em .xlsx as análises desatualizadas" aria-description="Baixa em .xlsx as análises desatualizadas">Baixar planilha das desatualizadas</button></div>` : ''}`;

    const tri = semAnaliseNaTriagem();
    const triagem = `<p class="small"><b class="mono">${tri.length}</b> ${tri.length === 1 ? 'processo da Triagem inicial está' : 'processos da Triagem inicial estão'} sem análise.</p>
      ${tri.length ? `<div class="linha-botoes"><button class="btn" type="button" data-iaacao="planilha-triagem" data-balao="Baixa em .xlsx os processos da Triagem inicial sem análise, do mais antigo na tarefa ao mais novo" aria-description="Baixa em .xlsx os processos da Triagem inicial sem análise, do mais antigo na tarefa ao mais novo">Baixar planilha</button></div>` : ''}`;

    const nDig = digitos(a.retirarNum), achada = nDig.length === 20 && a.lista[nDig];
    const retirar = `<label class="campo"><span>Número do processo</span><input id="ia-retirar-num" type="text" inputmode="numeric" autocomplete="off" value="${esc(a.retirarNum || '')}" placeholder="0000000-00.0000.4.05.8200"></label>
      ${nDig.length === 20 ? (achada ? `<div class="small">${esc(achada.caminho)}</div><div class="linha-botoes">${botaoRetirar(nDig)}</div>` : '<div class="small muted">Este processo não tem análise no painel.</div>') : ''}
      ${a.retirar ? '<div class="small muted">O arquivo .md continua na pasta: se ficar lá, a análise volta no próximo envio. Para não voltar, apague ou mova o arquivo.</div>' : ''}`;

    return `<section class="painel" id="painel-analises">
      <h2>Enviar análises da IA</h2>
      <p>As análises do encaminhamento (arquivos “número_Analise.md”) aparecem na linha do processo na fila. Aqui elas entram a qualquer momento, sem esperar o relatório do PJe+R, mas só as de processos que estão nas filas. Este envio não apaga nada: as análises de processos que saíram das filas são retiradas no envio do PJe+R.</p>
      ${linhaPasta()}
      ${erroPasta}
      ${verificar}
      ${previaEnvio()}
      <h3>Análises no painel</h3>
      ${resumo}
      <h3>Triagem inicial sem análise</h3>
      ${triagem}
      <h3>Retirar uma análise</h3>
      ${retirar}
    </section>`;
  };

  document.addEventListener('input', e => {
    if (e.target.id !== 'ia-retirar-num') return;
    // Redesenha só quando o número completo (20 dígitos) aparece, muda ou deixa de estar completo.
    const a = A(), antes = digitos(a.retirarNum), depois = digitos(e.target.value);
    a.retirarNum = e.target.value;
    if (antes !== depois && (antes.length === 20 || depois.length === 20)) { a.retirar = null; render(); }
  });

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
      else if (acao === 'escolher') { a.envio = null; await escolherPasta(); }
      else if (acao === 'liberar') { a.envio = null; await liberarPasta(); }
      else if (acao === 'verificar') await verificarPasta();
      else if (acao === 'gravar') await gravarEnvio();
      else if (acao === 'cancelar-envio') { a.envio = null; render(); }
      else if (acao === 'retirar') { a.retirar = el.dataset.n; render(); }
      else if (acao === 'retirar-nao') { a.retirar = null; render(); }
      else if (acao === 'retirar-ok') await retirarAnalise(el.dataset.n);
      else if (acao === 'planilha-velhas') planilhaVelhas();
      else if (acao === 'planilha-triagem') planilhaTriagem();
      else if (acao === 'planilha-gravadas') planilhaGravadas();
    } catch (err) { falha(err); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.analises && st.analises.modal) { st.analises.modal = null; renderModal(); } });

  if (st.estado === 'ok') P.carregarAnalises().then(render);
  atualizarSituacao().then(() => { if (st.perfil === 'gestor') render(); });
})();
