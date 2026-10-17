/* Produtividade da Vara: regras de leitura e contagem do relatório "Atividades por Usuário" do Portal BI. Sem DOM; testável em Node.
   Contagem igual à do BI (conferida em 17/10/2026: 12.249 = 4.656 + 168 + 7.425):
   - Tarefa e Retificação: soma da coluna "Total Atividades" (as linhas podem valer mais de 1);
   - Documento Minutado: o BI conta documentos distintos por processo + segundo (o mesmo documento vem repetido, com 1 ms de diferença);
     por pessoa, o documento é identificado por pessoa + processo + segundo.
   Só entram as pessoas da lista da equipe (os demais usuários do relatório são descartados na leitura). */
(function (root) {
  const semAcento = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const chaveCab = s => semAcento(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const normTexto = s => semAcento(s).toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const txt = v => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
  const pad = (n, t = 2) => String(n).padStart(t, '0');

  const ATIV_DOC = 'Documento Minutado', ATIV_TAREFA = 'Tarefa', ATIV_RETIF = 'Retificação';
  const ATIVIDADES = [ATIV_DOC, ATIV_RETIF, ATIV_TAREFA];
  const CABECALHOS = ['usuario', 'numeroprocesso', 'atividade', 'tipoatividade', 'dataatividade', 'totalatividades'];
  const NOMES_CAB = { usuario: 'Usuário', numeroprocesso: 'Número Processo', atividade: 'Atividade', tipoatividade: 'Tipo Atividade', dataatividade: 'Data Atividade', totalatividades: 'Total Atividades' };

  // Número serial do Excel (com fração do dia) -> milissegundos desde 1970 tratando o horário como "relógio de parede" (sem fuso).
  const serialParaMs = n => (typeof n === 'number' && isFinite(n) && n > 0 ? Math.round((n - 25569) * 86400000) : null);
  // "dd/mm/aaaa hh:mm:ss" (texto, como a macro aceitava) -> ms
  function textoParaMs(s) {
    const m = txt(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?)?$/);
    if (!m) return null;
    return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +((m[7] || '0') + '00').slice(0, 3));
  }
  const paraMs = v => (typeof v === 'number' ? serialParaMs(v) : textoParaMs(v));
  const iso = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`; };
  const dia = ms => iso(ms).slice(0, 10);

  const atividadeCanonica = a => {
    const k = chaveCab(a);
    if (k === 'documentominutado') return ATIV_DOC;
    if (k === 'tarefa') return ATIV_TAREFA;
    if (k === 'retificacao') return ATIV_RETIF;
    return txt(a);
  };

  // ---------- lista da equipe (xlsx: Servidor, Perfil, Grupo) ----------
  function lerEquipe(linhas) {
    const l = linhas || [];
    let h = -1, iNome = -1, iPerfil = -1, iGrupo = -1;
    for (let i = 0; i < Math.min(l.length, 12) && h < 0; i++) {
      const cab = (l[i] || []).map(chaveCab);
      const n = cab.findIndex(c => c === 'servidor' || c === 'nome' || c === 'usuario');
      if (n >= 0) { h = i; iNome = n; iPerfil = cab.indexOf('perfil'); iGrupo = cab.indexOf('grupo'); }
    }
    if (h < 0) throw new Error('Não encontrei a coluna “Servidor” na lista. Ela deve ter as colunas Servidor, Perfil e Grupo.');
    const pessoas = [], vistos = new Set();
    for (let i = h + 1; i < l.length; i++) {
      const r = l[i] || [], nome = txt(r[iNome]);
      if (!nome || vistos.has(normTexto(nome))) continue;
      vistos.add(normTexto(nome));
      pessoas.push({ nome_bi: nome, perfil: iPerfil >= 0 ? txt(r[iPerfil]) : '', grupo: iGrupo >= 0 ? txt(r[iGrupo]) : '', ordem: pessoas.length + 1, ativo: true });
    }
    if (!pessoas.length) throw new Error('A lista não tem nenhuma pessoa abaixo do cabeçalho.');
    return pessoas;
  }

  // ---------- relatório do BI ----------
  // linhas: matriz da primeira aba (Metas.lerXlsx). equipe: [{nome_bi, ativo}]. Devolve os eventos já tratados.
  function lerRelatorio(linhas, equipe) {
    const l = linhas || [];
    let h = -1, col = null;
    for (let i = 0; i < Math.min(l.length, 8) && h < 0; i++) {
      const cab = (l[i] || []).map(chaveCab);
      if (CABECALHOS.every(c => cab.includes(c))) { h = i; col = Object.fromEntries(CABECALHOS.map(c => [c, cab.indexOf(c)])); }
    }
    if (h < 0) {
      const cab0 = new Set(l.slice(0, 8).flatMap(r => (r || []).map(chaveCab)));
      const faltam = CABECALHOS.filter(c => !cab0.has(c)).map(c => NOMES_CAB[c]);
      throw new Error(`Cabeçalhos esperados não encontrados no arquivo${faltam.length ? ` (faltam: ${faltam.join(', ')})` : ''}. O relatório precisa ter Usuário, Número Processo, Atividade, Tipo Atividade, Data Atividade e Total Atividades.`);
    }
    const porNome = new Map();
    for (const p of equipe || []) if (p && p.ativo !== false && txt(p.nome_bi)) porNome.set(normTexto(p.nome_bi), txt(p.nome_bi));
    if (!porNome.size) throw new Error('A lista da equipe está vazia. Cadastre as pessoas na Gestão antes de enviar o relatório.');

    const docs = new Map(), outros = new Map();
    // Total da vara pela regra do BI, com TODOS os usuários do arquivo (não só a equipe): serve de conferência e substitui a célula "Totais" quando ela não vem.
    const docsVara = new Set(), somaVara = { [ATIV_TAREFA]: 0, [ATIV_RETIF]: 0 };
    let lidas = 0, daLista = 0, invalidas = 0, totalBi = null, ini = null, fim = null;
    for (let i = h + 1; i < l.length; i++) {
      const r = l[i] || [];
      const primeira = txt(r[0]);
      if (normTexto(primeira) === 'totais') { const v = Number(r[col.totalatividades]); if (isFinite(v)) totalBi = v; continue; }
      const nome = txt(r[col.usuario]), proc = txt(r[col.numeroprocesso]);
      if (!nome && !proc) continue;
      lidas++;
      const ms = paraMs(r[col.dataatividade]);
      if (ms == null) { invalidas++; continue; }
      if (ini == null || ms < ini) ini = ms;
      if (fim == null || ms > fim) fim = ms;
      const ativVara = atividadeCanonica(r[col.atividade]);
      if (ativVara === ATIV_DOC) docsVara.add(`${proc}|${Math.floor(ms / 1000)}`);
      else if (ativVara in somaVara) { const t = Number(r[col.totalatividades]); somaVara[ativVara] += isFinite(t) ? t : 0; }
      const pessoa = porNome.get(normTexto(nome));
      if (!pessoa) continue;                                   // fora da lista: descartado sem aviso
      daLista++;
      const atividade = atividadeCanonica(r[col.atividade]), tipo = txt(r[col.tipoatividade]);   // o tipo só entra na chave (não é guardado)
      const chavePessoa = normTexto(pessoa);
      if (atividade === ATIV_DOC) {
        const seg = Math.floor(ms / 1000) * 1000, chave = `${chavePessoa}|${proc}|doc|${iso(seg).slice(0, 19)}`;
        const ja = docs.get(chave);
        if (!ja || ms < ja.ms) docs.set(chave, { chave, pessoa, processo: proc, atividade, ocorreu_em: iso(seg), total: 1, ms });
      } else {
        const tot = Number(r[col.totalatividades]), total = isFinite(tot) && tot > 0 ? Math.round(tot) : 1;
        const chave = `${chavePessoa}|${proc}|${normTexto(atividade)}|${normTexto(tipo)}|${iso(ms)}`;   // formato já usado nos registros guardados: não mudar
        const ja = outros.get(chave);
        if (ja) ja.total += total;
        else outros.set(chave, { chave, pessoa, processo: proc, atividade, ocorreu_em: iso(ms), total, ms });
      }
    }
    const eventos = [...docs.values(), ...outros.values()].sort((a, b) => a.ms - b.ms).map(({ ms, ...e }) => e);
    const totalCalculado = lidas - invalidas > 0 ? docsVara.size + somaVara[ATIV_TAREFA] + somaVara[ATIV_RETIF] : null;
    const totalCelula = totalBi;
    return {
      eventos, lidas, daLista, invalidas,
      totalBi: totalCelula != null ? totalCelula : totalCalculado,        // a célula "Totais", quando vem; senão, o cálculo pela regra do BI
      totalOrigem: totalCelula != null ? 'celula' : totalCalculado != null ? 'calculado' : null,
      totalCelula, totalCalculado,
      periodoIni: ini == null ? null : dia(ini), periodoFim: fim == null ? null : dia(fim),
    };
  }

  // Contagem do BI para um conjunto de linhas (todos os usuários; usado para conferir com a célula "Totais").
  function contagemBI(linhas) {
    const l = linhas || [];
    let col = null, h = -1;
    for (let i = 0; i < Math.min(l.length, 8) && h < 0; i++) {
      const cab = (l[i] || []).map(chaveCab);
      if (CABECALHOS.every(c => cab.includes(c))) { h = i; col = Object.fromEntries(CABECALHOS.map(c => [c, cab.indexOf(c)])); }
    }
    if (h < 0) throw new Error('Cabeçalhos não encontrados.');
    const docs = new Set(); const por = { [ATIV_DOC]: 0, [ATIV_TAREFA]: 0, [ATIV_RETIF]: 0 };
    for (let i = h + 1; i < l.length; i++) {
      const r = l[i] || [];
      if (normTexto(txt(r[0])) === 'totais' || (!txt(r[col.usuario]) && !txt(r[col.numeroprocesso]))) continue;
      const ms = paraMs(r[col.dataatividade]); if (ms == null) continue;
      const a = atividadeCanonica(r[col.atividade]);
      if (a === ATIV_DOC) docs.add(`${txt(r[col.numeroprocesso])}|${Math.floor(ms / 1000)}`);
      else if (a in por) { const t = Number(r[col.totalatividades]); por[a] += isFinite(t) ? t : 0; }
    }
    por[ATIV_DOC] = docs.size;
    return { porAtividade: por, total: por[ATIV_DOC] + por[ATIV_TAREFA] + por[ATIV_RETIF] };
  }

  // ---------- datas (texto "AAAA-MM-DD", sempre em UTC para não sofrer com fuso e horário de verão) ----------
  const DIA_MS = 86400000;
  const dMs = d => { const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const msD = ms => new Date(ms).toISOString().slice(0, 10);
  const somarDias = (d, n) => msD(dMs(d) + n * DIA_MS);
  const diasEntre = (a, b) => Math.round((dMs(b) - dMs(a)) / DIA_MS);           // b - a
  const inicioSemana = d => { const w = new Date(dMs(d)).getUTCDay(); return somarDias(d, -((w + 6) % 7)); }; // segunda-feira
  const inicioMes = d => d.slice(0, 7) + '-01';
  const fimMes = d => { const x = new Date(dMs(inicioMes(d))); return msD(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)); };
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  // Granularidades: 'dia', 'semana' (segunda a domingo) e 'mes' (mês civil).
  const inicioBucket = (d, g) => (g === 'mes' ? inicioMes(d) : g === 'semana' ? inicioSemana(d) : d);
  const fimBucket = (ini, g) => (g === 'mes' ? fimMes(ini) : g === 'semana' ? somarDias(ini, 6) : ini);
  const proximoBucket = (ini, g) => somarDias(fimBucket(ini, g), 1);
  function rotuloBucket(ini, g) {
    if (g === 'mes') return `${MESES[+ini.slice(5, 7) - 1]}/${ini.slice(0, 4)}`;
    return `${ini.slice(8, 10)}/${ini.slice(5, 7)}`;
  }

  // Períodos escolhidos no filtro, a partir do último dia com dados (os dados do BI chegam com atraso, então "hoje" seria enganoso).
  function periodoPreset(preset, fim, primeiro) {
    if (!fim) return { ini: null, fim: null };
    if (preset === 'mes') return { ini: inicioMes(fim), fim };
    if (preset === 'mesAnterior') { const fa = somarDias(inicioMes(fim), -1); return { ini: inicioMes(fa), fim: fa }; }
    if (preset === '90') return { ini: somarDias(fim, -89), fim };
    if (preset === 'ano') return { ini: fim.slice(0, 4) + '-01-01', fim };
    if (preset === 'anoAnterior') { const a = +fim.slice(0, 4) - 1; return { ini: `${a}-01-01`, fim: `${a}-12-31` }; }
    if (preset === 'tudo') return { ini: primeiro || fim, fim };
    return { ini: somarDias(fim, -29), fim };                                   // '30' (padrão)
  }
  const periodoAnterior = (ini, fim) => { const n = diasEntre(ini, fim) + 1; return { ini: somarDias(ini, -n), fim: somarDias(ini, -1) }; };
  // Mesmo período um ano antes (mesmo dia e mês; 29/02 vira 28/02).
  const umAnoAntes = d => { const a = +d.slice(0, 4) - 1, mmdd = d.slice(5); return `${a}-${mmdd === '02-29' ? '02-28' : mmdd}`; };
  const periodoAnoAnterior = (ini, fim) => ({ ini: umAnoAntes(ini), fim: umAnoAntes(fim) });

  // Cobertura dos envios: intervalos [periodo_ini, periodo_fim] unidos (dias consecutivos ou sobrepostos viram um só).
  function cobertura(envios) {
    const iv = (envios || []).filter(e => e && e.periodo_ini && e.periodo_fim).map(e => [e.periodo_ini, e.periodo_fim]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const out = [];
    for (const [a, b] of iv) {
      const u = out[out.length - 1];
      if (u && a <= somarDias(u[1], 1)) { if (b > u[1]) u[1] = b; } else out.push([a, b]);
    }
    return out;
  }
  const coberto = (ini, fim, cob) => (cob || []).some(([a, b]) => a <= ini && fim <= b);

  const grupoDe = (eq, pessoa) => (eq.get(normTexto(pessoa)) || {}).grupo || '';

  // Agregação do dashboard. dias: [{pessoa, dia, atividade, atividades}], procs: [{pessoa, dia, processos}] (como as views do banco).
  // filtro: { perfil, grupo, pessoa } (vazio = todos). Só entram pessoas da lista da equipe.
  function agregar({ dias, procs, equipe, filtro, ini, fim, gran, cob }) {
    const eq = new Map((equipe || []).map(p => [normTexto(p.nome_bi), p]));
    const f = filtro || {};
    const passa = nome => {
      const p = eq.get(normTexto(nome));
      if (!p || p.ativo === false) return false;
      if (f.perfil && p.perfil !== f.perfil) return false;
      if (f.grupo && p.grupo !== f.grupo) return false;
      if (f.pessoa && normTexto(f.pessoa) !== normTexto(nome)) return false;
      return true;
    };
    const dentro = d => (!ini || d >= ini) && (!fim || d <= fim);
    const totais = { [ATIV_DOC]: 0, [ATIV_RETIF]: 0, [ATIV_TAREFA]: 0, total: 0, processos: 0 };
    const buckets = new Map(), pessoas = new Map(), diasPessoa = new Map();
    const bucket = d => {
      const b = inicioBucket(d, gran || 'dia');
      if (!buckets.has(b)) buckets.set(b, { inicio: b, grupos: {}, total: 0, processos: 0 });
      return buckets.get(b);
    };
    const linhaPessoa = nome => {
      const k = normTexto(nome);
      if (!pessoas.has(k)) { const p = eq.get(k); pessoas.set(k, { pessoa: p.nome_bi, perfil: p.perfil, grupo: p.grupo, [ATIV_DOC]: 0, [ATIV_RETIF]: 0, [ATIV_TAREFA]: 0, total: 0, processos: 0, diasAtivos: 0 }); }
      return pessoas.get(k);
    };
    for (const p of equipe || []) if (p.ativo !== false && passa(p.nome_bi)) linhaPessoa(p.nome_bi);
    for (const r of dias || []) {
      if (!dentro(r.dia) || !passa(r.pessoa)) continue;
      const lp = linhaPessoa(r.pessoa), b = bucket(r.dia), g = grupoDe(eq, r.pessoa) || '—';
      lp[r.atividade] = (lp[r.atividade] || 0) + r.atividades; lp.total += r.atividades;
      totais[r.atividade] = (totais[r.atividade] || 0) + r.atividades; totais.total += r.atividades;
      b.total += r.atividades; (b.grupos[g] = b.grupos[g] || { atividades: 0, processos: 0 }).atividades += r.atividades;
      diasPessoa.set(normTexto(r.pessoa) + '|' + r.dia, 1);
    }
    for (const r of procs || []) {
      if (!dentro(r.dia) || !passa(r.pessoa)) continue;
      const lp = linhaPessoa(r.pessoa), b = bucket(r.dia), g = grupoDe(eq, r.pessoa) || '—';
      lp.processos += r.processos; totais.processos += r.processos;
      b.processos += r.processos; (b.grupos[g] = b.grupos[g] || { atividades: 0, processos: 0 }).processos += r.processos;
    }
    for (const k of diasPessoa.keys()) { const p = pessoas.get(k.split('|')[0]); if (p) p.diasAtivos++; }
    // buckets contínuos de ini a fim (inclusive os vazios), com a marca de período parcial
    const lista = [];
    if (ini && fim) {
      for (let b = inicioBucket(ini, gran || 'dia'); b <= fim; b = proximoBucket(b, gran || 'dia')) {
        const x = buckets.get(b) || { inicio: b, grupos: {}, total: 0, processos: 0 };
        x.fim = fimBucket(b, gran || 'dia'); x.rotulo = rotuloBucket(b, gran || 'dia');
        x.parcial = cob ? !coberto(b, x.fim, cob) : false;
        lista.push(x);
      }
    }
    return { totais, buckets: lista, pessoas: [...pessoas.values()] };
  }

  root.Produtividade = {
    ATIVIDADES, ATIV_DOC, ATIV_TAREFA, ATIV_RETIF, serialParaMs, textoParaMs, iso, dia, atividadeCanonica, lerEquipe, lerRelatorio, contagemBI,
    somarDias, diasEntre, inicioSemana, inicioMes, fimMes, inicioBucket, fimBucket, rotuloBucket, periodoPreset, periodoAnterior, periodoAnoAnterior, cobertura, coberto, agregar,
  };
})(typeof window !== 'undefined' ? window : globalThis);
