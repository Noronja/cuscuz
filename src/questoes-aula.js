// Seleção de questões que CORRESPONDEM à videoaula (tema do vídeo + módulo), não ao assunto "em geral".
// Pontuação por palavras raras (IDF) do tema, com cobertura mínima: a questão precisa falar do que a aula fala.

const STOP = new Set(['de','da','do','das','dos','em','para','com','sem','por','sobre','que','uma','uns','umas','aula','aulas','curso','modulo','parte','bloco','extensivo','intensivo','geral','medicina','video','videos','videoaula','apostila','introducao','conceitos','principais','doencas','doenca','tratamento','diagnostico','clinica','quadro','revisao','resumo','casos','caso','tema','temas','na','no','nas','nos','ao','aos','as','os','e','ou','um','a','o','se','sua','seu','mais','como','pre','pos','med','medcurso','estrategia','sanar','rmais','bonus','extra','videoaula','gravada','ao','vivo','live']);

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();

// Sinônimos/siglas clínicas: casar qualquer um conta como o mesmo conceito
const SIN = [
  ['hipertensao','has','anti-hipertensiv','pressao arterial'],
  ['insuficiencia cardiaca','icfer','icfep','icc'],
  ['infarto','iam','sindrome coronariana','sca','coronariana'],
  ['fibrilacao atrial','fa','flutter'],
  ['diabetes','dm','diabetico','hiperglicemi'],
  ['tireoide','tireoid','hipotireoidismo','hipertireoidismo','tsh'],
  ['pneumonia','pac','pneumonias'],
  ['asma','broncoespasmo'],
  ['dpoc','enfisema','bronquite cronica'],
  ['avc','acidente vascular','ave'],
  ['sepse','choque septico','sepsis'],
  ['apendicite','apendic'],
  ['colecistite','colecist','colelitiase'],
  ['pancreatite','pancreat'],
  ['pre-eclampsia','preeclampsia','eclampsia','dheg','hipertensao gestacional'],
  ['tuberculose','tb'],
  ['hiv','aids'],
  ['dengue','arbovirose'],
  ['lupus','les'],
  ['artrite reumatoide','ar'],
  ['sdra','sindrome do desconforto respiratorio'],
  ['injuria renal aguda','ira','lesao renal aguda'],
  ['doenca renal cronica','drc','insuficiencia renal cronica'],
  ['cirrose','hepatopatia cronica'],
  ['leucemia','leucemias'],
  ['linfoma','linfomas'],
  ['anemia','anemias']
];

function sinonimosDe(tok) {
  const out = new Set([tok]);
  for (const g of SIN) if (g.some(x => x === tok || (x.length > 4 && tok.length > 4 && (x.startsWith(tok) || tok.startsWith(x))))) g.forEach(x => out.add(x));
  return [...out];
}

const stemOf = t => (t.length > 6 ? t.slice(0, t.length - 2) : t.length > 4 ? t.slice(0, t.length - 1) : t);

function tokens(texto) {
  return norm(texto).split(' ').filter(t => t.length > 2 && !STOP.has(t) && !/\d/.test(t));
}

// Índice por questão (cache por referência ao banco)
let _idx = null, _idxFor = null;
function indexar(bank) {
  if (_idxFor === bank && _idx) return _idx;
  const docs = bank.map(q => {
    const st = norm(String(q.statement || '').slice(0, 900));
    const ex = norm(String(q.explanation || '').slice(0, 500));
    const op = '';
    const meta = norm([q.subspecialty, q.specialty, ...(Array.isArray(q.tags) ? q.tags : [])].join(' '));
    return { q, st, ex, op, meta, all: ' ' + st + ' ' + ex + ' ' + op + ' ' + meta + ' ' };
  });
  _idx = docs; _idxFor = bank;
  return docs;
}

// siglas curtas (≤3 letras) só casam como palavra inteira; o resto casa no começo da palavra (plural/derivações)
const temPalavra = (texto, stem) => stem.length <= 3 ? texto.includes(' ' + stem + ' ') : texto.includes(' ' + stem);

function selecionar(bank, { tema, modulo, disc, limit = 40 } = {}) {
  const docs = indexar(bank);
  const tt = tokens(tema);
  const mt = tokens(modulo).filter(t => !tt.includes(t));
  // Se o título do vídeo é genérico ("38", "Índice"), o módulo vira o tema
  const principais = tt.length ? tt : mt;
  const secundarios = tt.length ? mt : [];
  if (!principais.length) return { questions: [], total: 0, exatas: 0, termos: [] };

  const N = docs.length || 1;
  const conceito = tok => {
    const syn = sinonimosDe(tok).map(x => (x.length <= 3 ? x : stemOf(x)));
    let df = 0;
    for (const d of docs) if (syn.some(s => temPalavra(d.all, s))) df++;
    return { tok, syn, idf: Math.log(1 + N / (1 + df)), df };
  };
  const cp = principais.map(conceito);
  const cs = secundarios.map(conceito);
  const totalIdf = cp.reduce((a, c) => a + c.idf, 0) || 1;
  const frase = tt.length >= 2 ? norm(tema) : '';
  const discN = norm(disc);

  const pontuadas = [];
  for (const d of docs) {
    let hit = 0, score = 0;
    for (const c of cp) {
      const onde = c.syn.some(s => temPalavra(d.meta, s)) ? 1.6
        : c.syn.some(s => temPalavra(d.st, s)) ? 1
        : c.syn.some(s => temPalavra(d.ex, s)) ? 0.6
        : c.syn.some(s => temPalavra(d.op, s)) ? 0.4 : 0;
      if (onde) { hit += c.idf; score += c.idf * onde; }
    }
    if (!hit) continue;
    const cobertura = hit / totalIdf;
    // exige que a questão cubra a maior parte dos conceitos do tema (tema curto: todos)
    const minCob = principais.length === 1 ? 0.99 : principais.length === 2 ? 0.55 : principais.length === 3 ? 0.6 : 0.6;
    const fraseOk = frase && (d.st.includes(frase) || d.ex.includes(frase));
    if (cobertura < minCob && !fraseOk) continue;
    if (fraseOk) score += 6;
    for (const c of cs) if (c.syn.some(s => temPalavra(d.st, s) || temPalavra(d.ex, s))) score += c.idf * 0.35;
    if (discN && (norm(d.q.specialty).includes(discN) || discN.includes(norm(d.q.specialty)) || norm(d.q.subspecialty).includes(discN))) score += 0.8;
    pontuadas.push({ q: d.q, score, cobertura, fraseOk });
  }
  pontuadas.sort((a, b) => b.score - a.score || (b.q.year || 0) - (a.q.year || 0));
  const exatas = pontuadas.filter(p => p.cobertura >= 0.99 || p.fraseOk).length;
  const sel = pontuadas.slice(0, limit).map(p => Object.assign({}, p.q, { _rel: p.cobertura >= 0.99 || p.fraseOk ? 'alta' : 'media' }));
  return { questions: sel, total: pontuadas.length, exatas, termos: principais };
}

// Acha no catálogo de doenças do Hardworq (~358) as que correspondem à aula, para buscar no banco completo (30 mil+)
function acharDoencas(doencas, tema, modulo) {
  const cobre = (dTok, base) => dTok.every(d => {
    const sd = stemOf(d);
    return base.some(b => { const sb = stemOf(b); return sb === sd || (sd.length >= 5 && sb.length >= 5 && (sb.startsWith(sd) || sd.startsWith(sb))) || sinonimosDe(b).some(x => stemOf(x) === sd); });
  });
  const baseT = tokens(tema), baseM = tokens(modulo);
  const out = [];
  for (const d of doencas || []) {
    const dt = tokens(d.nome);
    if (!dt.length) continue;
    if (cobre(dt, baseT)) out.push({ d, peso: 2 + dt.length });
    else if (!baseT.length && cobre(dt, baseM)) out.push({ d, peso: 1 + dt.length });
  }
  out.sort((a, b) => b.peso - a.peso);
  return out.slice(0, 3).map(x => x.d);
}

export { selecionar, norm, tokens, acharDoencas };
