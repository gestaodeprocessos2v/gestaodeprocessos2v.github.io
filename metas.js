/* Metas CNJ: leitura das duas planilhas baixadas do Portal BI do TRF5 (Resumo e Pendentes por Meta). Sem DOM; testável em Node.
   Lê o .xlsx direto no navegador (zip + XML), sem biblioteca externa. */
(function (root) {
  const semAcento = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const chave = s => semAcento(s).toLowerCase().replace(/[^a-z0-9]/g, '');

  const VARA = 'PB - 2ª Vara Federal';
  const INSTANCIAS = ['1º Grau', 'JEF'];

  // Metas do painel, na ordem de exibição. "res" = colunas do Resumo; "pend" = colunas de Pendentes por Meta.
  const METAS = [
    { id: 'm1', meta: 1, nome: 'Meta 1', titulo: 'Julgar mais processos que os distribuídos', res: 'Meta 1', pend: 'Meta 1' },
    { id: 'm2_antigos', meta: 2, nome: 'Meta 2 — Antigos', titulo: 'Julgar processos mais antigos (distribuídos há 15 anos)', res: 'Meta 2 (Antigos)', pend: 'Meta 2 (Antigos)' },
    { id: 'm2_1g2g', meta: 2, nome: 'Meta 2 — 1º e 2º graus', titulo: 'Julgar processos mais antigos (1º e 2º graus)', res: 'Meta 2 (1º Grau e 2º Grau)', pend: 'Meta 2 (1G 2G)' },
    { id: 'm2_jef', meta: 2, nome: 'Meta 2 — Juizados e Turmas', titulo: 'Julgar processos mais antigos (Juizados e Turmas)', res: 'Meta 2 (Juizados e turmas)', pend: 'Meta 2 (JEF TR TRU)' },
    { id: 'm3', meta: 3, nome: 'Meta 3', titulo: 'Estimular a conciliação', res: 'Meta 3', pend: 'Meta 3' },
    { id: 'm4_crimes', meta: 4, nome: 'Meta 4 — Crimes contra a Administração Pública', titulo: 'Priorizar crimes contra a Administração Pública', res: 'Meta 4 (Crimes contra Adm. Pública)', pend: 'Meta 4 (Crimes contra Adm. Pública)' },
    { id: 'm4_improb', meta: 4, nome: 'Meta 4 — Improbidade administrativa', titulo: 'Priorizar ações de improbidade administrativa', res: 'Meta 4 (Improbidade Adm.)', pend: 'Meta 4 (Improbidade Adm.)' },
    { id: 'm5', meta: 5, nome: 'Meta 5', titulo: 'Reduzir a taxa de congestionamento', res: 'Meta 5', pend: null },
    { id: 'm6', meta: 6, nome: 'Meta 6', titulo: 'Priorizar ações ambientais', res: 'Meta 6', pend: 'Meta 6' },
    { id: 'm7_ind', meta: 7, nome: 'Meta 7 — Indígenas', titulo: 'Priorizar processos de comunidades indígenas', res: 'Meta 7 (Indígenas)', pend: 'Meta 7 (Indígenas)' },
    { id: 'm7_quil', meta: 7, nome: 'Meta 7 — Quilombolas', titulo: 'Priorizar processos de comunidades quilombolas', res: 'Meta 7 (Quilombolas)', pend: 'Meta 7 (Quilombolas)' },
    { id: 'm7_rac', meta: 7, nome: 'Meta 7 — Racismo e injúria racial', titulo: 'Priorizar processos de racismo e injúria racial', res: 'Meta 7 (Racismo)', pend: 'Meta 7 (Racismo)' },
    { id: 'm10', meta: 10, nome: 'Meta 10', titulo: 'Promover os direitos da criança e do adolescente', res: 'Meta 10', pend: 'Meta 10' },
  ];
  const porRes = new Map(METAS.map(m => [chave(m.res), m]));
  const porPend = new Map(METAS.filter(m => m.pend).map(m => [chave(m.pend), m]));

  // ---------- .xlsx (zip + XML) ----------
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  async function inflar(dados) {
    const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }

  // Lê o diretório central do zip e devolve {nome: () => Promise<Uint8Array>}.
  function abrirZip(buffer) {
    const b = new Uint8Array(buffer);
    let fim = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { fim = i; break; }
    if (fim < 0) throw new Error('O arquivo não é uma planilha .xlsx válida.');
    const n = u16(b, fim + 10);
    let o = u32(b, fim + 16);
    const arq = {};
    for (let k = 0; k < n; k++) {
      if (u32(b, o) !== 0x02014b50) throw new Error('A planilha .xlsx está corrompida.');
      const metodo = u16(b, o + 10), tamC = u32(b, o + 20), nomeLen = u16(b, o + 28), extraLen = u16(b, o + 30), comLen = u16(b, o + 32), ini = u32(b, o + 42);
      const nome = new TextDecoder().decode(b.subarray(o + 46, o + 46 + nomeLen));
      arq[nome] = async () => {
        const dataIni = ini + 30 + u16(b, ini + 26) + u16(b, ini + 28);
        const dados = b.subarray(dataIni, dataIni + tamC);
        if (metodo === 0) return dados;
        if (metodo === 8) return inflar(dados);
        throw new Error('A planilha usa uma compressão que não consigo ler.');
      };
      o += 46 + nomeLen + extraLen + comLen;
    }
    return arq;
  }

  const texto = u8 => new TextDecoder('utf-8').decode(u8);
  const entidades = s => s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e];
  });
  const textoDe = xml => { let s = ''; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(xml))) s += m[1]; return entidades(s); };

  function colunaDe(ref) { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

  // Devolve as linhas da primeira planilha como arrays de células (texto ou número) e a data de criação do arquivo.
  async function lerXlsx(buffer) {
    const z = abrirZip(buffer);
    const nomes = Object.keys(z).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
    if (!nomes.length) throw new Error('Não encontrei nenhuma planilha dentro do arquivo.');
    const compartilhadas = [];
    if (z['xl/sharedStrings.xml']) {
      const xml = texto(await z['xl/sharedStrings.xml']());
      const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g; let m;
      while ((m = re.exec(xml))) compartilhadas.push(textoDe(m[1]));
    }
    const xml = texto(await z[nomes[0]]());
    const linhas = [];
    const reL = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g; let ml;
    while ((ml = reL.exec(xml))) {
      const cel = [];
      const reC = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let mc;
      while ((mc = reC.exec(ml[1]))) {
        const at = mc[1], corpo = mc[2] || '';
        const ref = (at.match(/\br="([A-Z]+\d+)"/) || [])[1];
        if (!ref) continue;
        const tipo = (at.match(/\bt="(\w+)"/) || [])[1];
        let v = null;
        if (tipo === 'inlineStr') v = textoDe(corpo);
        else {
          const mv = corpo.match(/<v>([\s\S]*?)<\/v>/);
          if (mv) v = tipo === 's' ? compartilhadas[parseInt(mv[1], 10)] : tipo === 'str' ? entidades(mv[1]) : tipo === 'b' ? mv[1] === '1' : Number(mv[1]);
        }
        cel[colunaDe(ref)] = v;
      }
      linhas.push(cel);
    }
    let criadoEm = null;
    if (z['docProps/core.xml']) {
      const m = texto(await z['docProps/core.xml']()).match(/<dcterms:created[^>]*>([^<]+)</);
      if (m) criadoEm = Date.parse(m[1]);
    }
    return { linhas, criadoEm: isNaN(criadoEm) ? null : criadoEm };
  }

  // ---------- cabeçalho ----------
  function colunas(cab) {
    const o = {};
    cab.forEach((h, i) => { if (h != null && String(h).trim()) o[chave(h)] = i; });
    return o;
  }
  const celula = (l, i) => (i == null || l[i] == null ? '' : l[i]);
  const txt = (l, i) => String(celula(l, i)).trim();

  // ---------- Resumo ----------
  // Linhas do Resumo: Totais | Instância | SJ | Serventia | Meta 1 | ... Valores são frações (1 = 100%); "-" = sem dados.
  function lerResumo(linhas) {
    if (!linhas.length) throw new Error('A planilha do Resumo está vazia.');
    const c = colunas(linhas[0]);
    const iInst = c.instancia, iServ = c.serventia;
    if (c.numeroprocesso != null) throw new Error('Este é o relatório "Pendentes por Meta". Aqui é preciso enviar o relatório "Resumo".');
    if (iInst == null || iServ == null) throw new Error('Isto não parece o relatório "Resumo" do Portal BI (faltam as colunas Instância e Serventia).');
    const colMetas = METAS.map(m => ({ m, i: c[chave(m.res)] })).filter(x => x.i != null);
    if (!colMetas.length) throw new Error('Não encontrei as colunas das metas (Meta 1, Meta 2…) no relatório do Resumo.');
    const valor = (l, i) => { const v = celula(l, i); return typeof v === 'number' && isFinite(v) ? v : null; };
    const leitura = l => { const o = {}; for (const { m, i } of colMetas) o[m.id] = valor(l, i); return o; };
    const dados = linhas.slice(1).filter(l => l && l.length);
    const serventias = [...new Set(dados.map(l => txt(l, iServ)).filter(Boolean))];
    if (!serventias.length) throw new Error('O relatório do Resumo não tem nenhuma linha por serventia. Filtre pela 2ª Vara no Portal BI antes de baixar.');
    if (serventias.length > 1 || chave(serventias[0]) !== chave(VARA)) {
      throw new Error(`O relatório do Resumo precisa estar filtrado só pela serventia “${VARA}”. Encontrei: ${serventias.slice(0, 4).join('; ')}${serventias.length > 4 ? '…' : ''}.`);
    }
    const instancias = {};
    for (const inst of INSTANCIAS) {
      const l = dados.find(x => txt(x, iInst) === inst && txt(x, iServ));
      if (l) instancias[inst] = leitura(l);
    }
    if (!Object.keys(instancias).length) throw new Error('Não encontrei as linhas de 1º Grau e JEF da 2ª Vara no relatório do Resumo.');
    const total = dados.find(x => !txt(x, iInst) && !txt(x, iServ));
    return { serventia: VARA, vara: total ? leitura(total) : null, instancias, metasLidas: colMetas.map(x => x.m.id) };
  }

  // ---------- Pendentes por Meta ----------
  const serialParaData = n => {
    if (typeof n !== 'number' || !isFinite(n)) return null;
    const d = new Date(Math.round((n - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  };

  function lerPendentes(linhas) {
    if (!linhas.length) throw new Error('A planilha de pendentes está vazia.');
    const c = colunas(linhas[0]);
    const iNum = c.numeroprocesso, iInst = c.instancia, iServ = c.serventia;
    if (iNum == null && c.totais != null) throw new Error('Este é o relatório "Resumo". Aqui é preciso enviar o relatório "Pendentes por Meta".');
    if (iNum == null || iInst == null) throw new Error('Isto não parece o relatório "Pendentes por Meta" do Portal BI (faltam as colunas Número Processo e Instância).');
    const colMetas = METAS.filter(m => m.pend).map(m => ({ m, i: c[chave(m.pend)] })).filter(x => x.i != null);
    if (!colMetas.length) throw new Error('Não encontrei as colunas das metas no relatório de pendentes.');
    const iClasse = c.classejudicialatual, iDist = c[chave('Data 1ª Distribuição')];
    const itens = [], porMeta = {}, porInstancia = {}, serventias = new Set();
    for (const { m } of colMetas) porMeta[m.id] = 0;
    for (const l of linhas.slice(1)) {
      if (!l || !txt(l, iNum)) continue;
      if (iServ != null && txt(l, iServ)) serventias.add(txt(l, iServ));
      const metas = colMetas.filter(({ i }) => String(celula(l, i)).trim().toUpperCase() === 'S').map(({ m }) => m.id);
      for (const id of metas) porMeta[id]++;
      const inst = txt(l, iInst);
      porInstancia[inst] = (porInstancia[inst] || 0) + 1;
      const it = { n: txt(l, iNum), i: inst, c: txt(l, iClasse), d: serialParaData(celula(l, iDist)), m: metas };
      itens.push(it);
    }
    if (!itens.length) throw new Error('O relatório de pendentes não tem nenhum processo.');
    const serv = [...serventias];
    if (serv.some(s => chave(s) !== chave(VARA))) {
      throw new Error(`O relatório de pendentes precisa estar filtrado só pela serventia “${VARA}”. Encontrei: ${serv.slice(0, 4).join('; ')}${serv.length > 4 ? '…' : ''}.`);
    }
    return { itens, total: itens.length, porMeta, porInstancia };
  }

  // ---------- conferência entre os arquivos e a carga do BI ----------
  const MIN = 60000;
  // cargaBi: instante (ms) da "Última Carga" mostrada no canto do Portal BI. Devolve avisos (não bloqueiam; o gestor decide).
  function conferir({ criadoResumo, criadoPendentes, cargaBi }) {
    const av = [];
    if (criadoResumo != null && criadoPendentes != null && Math.abs(criadoResumo - criadoPendentes) > 30 * MIN) {
      av.push('Os dois arquivos foram baixados com mais de 30 minutos de diferença. Se o Portal BI recarregou nesse intervalo, os números podem não bater; baixe os dois de novo.');
    }
    if (cargaBi != null) {
      for (const [nome, t] of [['Resumo', criadoResumo], ['Pendentes por Meta', criadoPendentes]]) {
        if (t != null && t < cargaBi) av.push(`O arquivo de ${nome} foi gerado antes da carga informada (${new Date(t).toLocaleString('pt-BR')}). Baixe de novo ou corrija a data da carga.`);
      }
    }
    return av;
  }

  // Situação visual de uma meta (fração do Resumo): cumprida a partir de 100%. Limite de "atenção" a confirmar com o gestor.
  const LIMITE_ATENCAO = 0.5;
  function situacao(v) {
    if (v == null) return 'sem';
    if (v >= 1) return 'ok';
    return v >= LIMITE_ATENCAO ? 'atencao' : 'baixo';
  }
  const pct = v => (v == null ? '—' : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');

  // ---------- cruzamento com as listas dos servidores ----------
  // filas: linhas {pessoa, itens:[{n, t, ch, fora}]} (lista semanal e diária); servidores: ids de quem conta (só perfil Servidor).
  // Devolve um Map: número só com dígitos -> {pessoa, tarefa, chegada (ms ou null)}. Mais de uma entrada: vale a de chegada mais antiga.
  const soDig = s => String(s == null ? '' : s).replace(/\D/g, '');
  function indexarListas(filas, servidores) {
    const ok = servidores instanceof Set ? servidores : new Set(servidores);
    const mapa = new Map();
    for (const r of filas || []) {
      if (!ok.has(r.pessoa)) continue;
      for (const it of r.itens || []) {
        if (it.fora) continue;
        const k = soDig(it.n); if (!k) continue;
        const ja = mapa.get(k), ch = it.ch == null ? null : it.ch;
        if (!ja || (ch != null && (ja.chegada == null || ch < ja.chegada))) mapa.set(k, { pessoa: r.pessoa, tarefa: it.t || '', chegada: ch });
      }
    }
    return mapa;
  }
  // Processos de tarefas sem fila de servidor (outros setores da vara): Map número -> {tarefa, chegada}; vale a chegada mais antiga.
  function indexarOutros(outros) {
    const mapa = new Map();
    for (const it of outros || []) {
      const k = soDig(it.n); if (!k) continue;
      const ja = mapa.get(k), ch = it.ch == null ? null : it.ch;
      if (!ja || (ch != null && (ja.chegada == null || ch < ja.chegada))) mapa.set(k, { tarefa: it.t || '', chegada: ch });
    }
    return mapa;
  }
  // Acrescenta a cada pendente o campo `lista`: {pessoa, tarefa, chegada} (servidor), {pessoa: null, outro: true, tarefa, chegada}
  // (tarefa de outro setor da vara, sem servidor) ou null (não localizado). O servidor sempre vence. Não altera os itens recebidos.
  function cruzarPendentes(itens, filas, servidores, outros) {
    const idx = indexarListas(filas, servidores), fora = indexarOutros(outros);
    return (itens || []).map(it => {
      const k = soDig(it.n), s = idx.get(k), o = s ? null : fora.get(k);
      return Object.assign({}, it, { lista: s || (o ? { pessoa: null, outro: true, tarefa: o.tarefa, chegada: o.chegada } : null) });
    });
  }

  root.Metas = { VARA, INSTANCIAS, METAS, lerXlsx, lerResumo, lerPendentes, conferir, situacao, pct, serialParaData, LIMITE_ATENCAO, indexarListas, indexarOutros, cruzarPendentes };
})(typeof window !== 'undefined' ? window : globalThis);
