// Planejador v2 — entrevista adaptativa + gerador de tarefas ligado ao acervo real (aulas/PDFs do Drive)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const MIN_AULA = 35; // duração média estimada de uma videoaula do acervo

/* ───────────────────────── Datas (UTC, formato ISO) ───────────────────────── */
export const isoOf = d => d.toISOString().slice(0, 10);
export const parseIso = s => new Date(String(s).slice(0, 10) + 'T00:00:00Z');
export const addDias = (iso, n) => { const d = parseIso(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
export const diffDias = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);
const wdOf = iso => parseIso(iso).getUTCDay(); // 0=dom … 6=sáb
const brDate = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const DIAS_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/* ───────────────────────── Disciplinas ───────────────────────── */
// peso = incidência aproximada em provas de residência (ENARE/USP/UNIFESP etc.)
export const DISCS = [
  { nome: 'Cardiologia', re: /cardio/, banco: 'Clínica Médica', peso: 3, foco: 'classificações, critérios diagnósticos, conduta de 1ª linha e indicações de cada exame' },
  { nome: 'Pneumologia', re: /pneumo/, banco: 'Clínica Médica', peso: 2, foco: 'interpretação de espirometria/gasometria/RX, critérios de gravidade e tratamento escalonado' },
  { nome: 'Gastroenterologia', re: /gastro/, banco: 'Clínica Médica', peso: 2, foco: 'diagnóstico diferencial pelo quadro clínico, exame de escolha e sinais de alarme' },
  { nome: 'Hepatologia', re: /hepato/, banco: 'Clínica Médica', peso: 1, foco: 'interpretação de sorologias/enzimas, estadiamento e complicações' },
  { nome: 'Nefrologia', re: /nefro/, banco: 'Clínica Médica', peso: 2, foco: 'distúrbios ácido-base e eletrolíticos, classificação das lesões e indicações de diálise' },
  { nome: 'Endocrinologia', re: /endocrin/, banco: 'Clínica Médica', peso: 2, foco: 'critérios diagnósticos, metas terapêuticas e escolha do fármaco' },
  { nome: 'Reumatologia', re: /reumato/, banco: 'Clínica Médica', peso: 1.5, foco: 'critérios de classificação, autoanticorpos característicos e tratamento de 1ª linha' },
  { nome: 'Hematologia', re: /hemato/, banco: 'Clínica Médica', peso: 1.5, foco: 'interpretação de hemograma/esfregaço, diagnóstico diferencial das anemias e conduta' },
  { nome: 'Infectologia', re: /infecto/, banco: 'Clínica Médica', peso: 3, foco: 'agente x quadro clínico x tratamento de escolha, profilaxias e notificação' },
  { nome: 'Neurologia', re: /neuro/, banco: 'Clínica Médica', peso: 2, foco: 'topografia da lesão, quadro clínico clássico e conduta na urgência' },
  { nome: 'Psiquiatria', re: /psiqui/, banco: 'Clínica Médica', peso: 1, foco: 'critérios diagnósticos (DSM), farmacoterapia de 1ª linha e manejo da urgência' },
  { nome: 'Dermatologia', re: /dermato/, banco: 'Clínica Médica', peso: 0.6, foco: 'lesão elementar, diagnóstico clínico e tratamento de escolha' },
  { nome: 'Ortopedia', re: /ortop|traumato/, banco: 'Cirurgia Geral', peso: 0.8, foco: 'mecanismo de trauma, classificações e conduta imediata' },
  { nome: 'Pediatria', re: /pediatr/, banco: 'Pediatria', peso: 5, foco: 'esquemas por faixa etária, marcos do desenvolvimento, doses e vacinação' },
  { nome: 'Ginecologia e Obstetrícia', re: /ginecolog.*obstet|obstet.*ginecolog/, banco: 'Ginecologia e Obstetrícia', peso: 0, go: true },
  { nome: 'Obstetrícia', re: /obstet/, banco: 'Ginecologia e Obstetrícia', peso: 4, foco: 'idade gestacional, condutas por trimestre, critérios de gravidade e via de parto' },
  { nome: 'Ginecologia', re: /ginecolog/, banco: 'Ginecologia e Obstetrícia', peso: 4, foco: 'rastreamento, critérios diagnósticos e conduta de 1ª linha' },
  { nome: 'Cirurgia', re: /cirurg/, banco: 'Cirurgia Geral', peso: 5, foco: 'indicação cirúrgica, exame de escolha, abordagem inicial (ATLS) e complicações' },
  { nome: 'Medicina Preventiva', re: /preventiv|saude coletiva|epidemiolog|bioestat/, banco: 'Medicina Preventiva e Social', peso: 3, foco: 'cálculos (sensibilidade, RR, NNT), desenhos de estudo e princípios do SUS' }
];
const DISC_BY_NAME = new Map(DISCS.map(d => [d.nome, d]));
const GO_OBST = /gesta|parto|pre-?natal|puerp|eclamp|abort|placent|obstet|fet|cesar|toxopl|sifili|trabalho de parto|amnio|hiperem|rh\b/;

export function detectDisc(texto) {
  const n = norm(texto);
  for (const d of DISCS) if (d.re.test(n)) return d;
  return null;
}

/* ───────────────────────── Catálogo do acervo ───────────────────────── */
let CAT = null;
function limparTema(str) {
  return String(str || '')
    .replace(/\.(mp4|webm|mkv|mov|pdf|avi)$/i, '')
    .replace(/^MEDCURSO\s*-\s*[A-Za-z0-9]+\s*\d*\s*-\s*/i, '')
    .replace(/^SANAR\s*-\s*/i, '')
    .replace(/^Estrat[eé]gia\s*MED\s*-\s*/i, '')
    .replace(/^M[oó]dulo\s*\d+\s*[-–—:]\s*/i, '')
    .replace(/^Bloco\s*\d+\s*[-–—:]\s*/i, '')
    .replace(/^Aula\s*\d+\s*[-–—:]\s*/i, '')
    .replace(/^\d+[.\-_)]\s*/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const GENERICA = /^(videos?( apostila)?|extensivo|aulas?|pdf|material|resumos?|\d+)$/i;
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'na', 'no', 'em', 'e', 'a', 'o', 'as', 'os', 'para', 'por', 'com', 'um', 'uma', 'ao', 'aula', 'parte', 'resumo', 'tema', 'anti']);
export const tokens = s => norm(s).split(/[^a-z0-9]+/).filter(w => w.length > 3 && !STOP.has(w));

const ehBonus = p => /b[oô]nus/i.test(p) ? 1 : 0;
function natCmp(a, b) { return ehBonus(a.path) - ehBonus(b.path) || a.path.localeCompare(b.path, 'pt', { numeric: true, sensitivity: 'base' }); }

export function getCatalogo() {
  if (CAT) return CAT;
  let m = { videos: [], materials: [], courses: [] };
  try { m = JSON.parse(fs.readFileSync(path.join(ROOT, 'acervo-manifest.json'), 'utf8')); } catch (_) {}
  const temasPorDisc = new Map(); // disc -> course -> Map(temaKey -> {tema, videos[]})
  const materiais = []; // {id,titulo,curso,path,disc,toks,tipo}

  for (const v of m.videos || []) {
    const segs = String(v.path || '').split(' / ');
    const pastas = segs.slice(1, -1);
    if (/introdu|cronograma e guias/i.test(norm(segs.slice(1).join(' ')))) continue;
    if (v.course === 'SANAR') continue; // pós em terapia intensiva — fora do escopo de residência/graduação
    let di = pastas.findIndex(p => detectDisc(p));
    let disc = di >= 0 ? detectDisc(pastas[di]) : detectDisc(segs[segs.length - 1]);
    if (!disc) continue;
    let temaBruto = di >= 0 ? pastas.slice(di + 1).find(p => !GENERICA.test(norm(p).trim())) : null;
    let tema = limparTema(temaBruto || v.t || segs[segs.length - 1]);
    if (!tema || /^\d+$/.test(tema)) tema = limparTema(pastas[pastas.length - 1] || v.t);
    if (disc.go) disc = GO_OBST.test(norm(tema)) ? DISC_BY_NAME.get('Obstetrícia') : DISC_BY_NAME.get('Ginecologia');
    const key = norm(tema);
    if (!temasPorDisc.has(disc.nome)) temasPorDisc.set(disc.nome, new Map());
    const porCurso = temasPorDisc.get(disc.nome);
    if (!porCurso.has(v.course)) porCurso.set(v.course, new Map());
    const mapa = porCurso.get(v.course);
    if (!mapa.has(key)) mapa.set(key, { tema, videos: [] });
    mapa.get(key).videos.push({ id: v.id, titulo: limparTema(v.t) || tema, path: v.path, course: v.course });
  }
  const videoIdx = [];
  for (const [discNome, porCurso] of temasPorDisc)
    for (const mapa of porCurso.values())
      for (const t of mapa.values()) {
        t.videos.sort(natCmp);
        for (const v of t.videos) videoIdx.push({ v, disc: discNome, tema: t.tema, toks: new Set(tokens(t.tema + ' ' + tituloAula(v))) });
      }

  for (const mt of m.materials || []) {
    const segs = String(mt.path || '').split(' / ');
    const pastas = segs.slice(1, -1).join(' / ');
    const titulo = limparTema(mt.t || segs[segs.length - 1]);
    const ehQuestoes = mt.course === 'QUESTÕES EM PDF' || /quest(o|õ)es|banco de quest/i.test(pastas);
    let disc = detectDisc(pastas + ' / ' + titulo);
    materiais.push({ id: mt.id, titulo, curso: mt.course, path: mt.path, disc: disc ? disc.nome : null, toks: new Set(tokens(titulo)), tipo: ehQuestoes ? 'questoes' : 'resumo' });
  }
  CAT = { temasPorDisc, videoIdx, materiais, cursos: (m.courses || []).map(c => c.name), totalVideos: (m.videos || []).length };
  return CAT;
}

// Lista de temas (ordenada) de uma disciplina, priorizando os cursos escolhidos pelo usuário
function temasDaDisc(disc, cursosPref) {
  const cat = getCatalogo();
  const porCurso = cat.temasPorDisc.get(disc);
  if (!porCurso) return [];
  const ordemCursos = [...new Set([...(cursosPref || []), 'MEDCURSO', 'Estratégia'])].filter(c => porCurso.has(c));
  const lista = [];
  for (const c of ordemCursos) {
    for (const t of porCurso.get(c).values()) lista.push({ ...t, curso: c });
    if (lista.length && (cursosPref || []).length <= 1) break; // um curso por disciplina, a menos que o usuário escolha vários
  }
  return lista;
}

function acharMaterial(discNome, tema, tipo, cursosPref) {
  const cat = getCatalogo();
  const tk = tokens(tema);
  let melhor = [];
  for (const mt of cat.materiais) {
    if (mt.tipo !== tipo) continue;
    if (discNome && mt.disc && mt.disc !== discNome && !(discNome.includes('Obstetrícia') || discNome.includes('Ginecologia'))) continue;
    if (discNome && !mt.disc && tipo === 'resumo') continue;
    if (discNome && mt.disc && (discNome === 'Obstetrícia' || discNome === 'Ginecologia') && !['Obstetrícia', 'Ginecologia', 'Ginecologia e Obstetrícia'].includes(mt.disc)) continue;
    let hit = 0;
    for (const t of tk) if (mt.toks.has(t)) hit++;
    const score = tk.length ? hit / tk.length : 0;
    const bonus = cursosPref && cursosPref.includes(mt.curso) ? 0.05 : 0;
    const minimo = discNome ? 0.67 : 0.8;
    const ok = hit >= 1 && (score >= minimo || (hit >= 2 && score >= 0.5)) && hit / Math.max(1, mt.toks.size) >= 0.4;
    if (ok) melhor.push({ mt, s: score + bonus });
  }
  melhor.sort((a, b) => b.s - a.s);
  return melhor.slice(0, tipo === 'questoes' ? 1 : 2).map(x => x.mt);
}

// Procura no acervo as aulas que cobrem um assunto declarado pelo aluno/manual (sem inventar: exige correspondência)
function acharAulas(discNome, assunto, cursosPref, usados) {
  const cat = getCatalogo();
  const tk = tokens(assunto);
  if (!tk.length) return null;
  const cand = [];
  for (const it of cat.videoIdx) {
    if (discNome && DISC_BY_NAME.has(discNome) && it.disc !== discNome) continue;
    if (usados && usados.has(it.v.id)) continue;
    let hit = 0; for (const t of tk) if (it.toks.has(t)) hit++;
    const sc = hit / tk.length;
    const minimo = discNome && DISC_BY_NAME.has(discNome) ? 0.67 : 0.8;
    if (hit >= 1 && (sc >= minimo || (hit >= 2 && sc >= 0.5)) && hit / Math.max(1, it.toks.size) >= 0.3) cand.push({ it, s: sc + (cursosPref && cursosPref.includes(it.v.course) ? 0.05 : 0) });
  }
  if (!cand.length) return null;
  cand.sort((a, b) => b.s - a.s);
  const top = cand[0].it;
  const mesmos = cand.filter(c => c.it.tema === top.tema && c.s >= cand[0].s - 0.2).slice(0, 3).map(c => c.it.v);
  return { tema: assunto, videos: mesmos };
}

export function resumoCatalogo() {
  const cat = getCatalogo();
  const out = [];
  for (const d of DISCS) {
    const t = temasDaDisc(d.nome, []);
    if (t.length) out.push({ disc: d.nome, temas: t.length, aulas: t.reduce((a, x) => a + x.videos.length, 0) });
  }
  return { disciplinas: out, cursos: cat.cursos, totalVideos: cat.totalVideos };
}

/* ───────────────────────── Perfil do aluno ───────────────────────── */
export const PERFIL_VAZIO = () => ({
  objetivo: '', alvo: '', dataProva: '', semData: false,
  provasFaculdade: [], semProvas: false, aulasFaculdade: [], manualNome: '', semConteudo: false,
  horas: null, dificuldades: [], fortes: [], semDificuldades: false,
  metodo: '', cursos: [], anseios: ''
});

export function sanePerfil(atual, patch) {
  const p = { ...PERFIL_VAZIO(), ...(atual || {}) };
  const x = patch || {};
  const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
  if (['graduacao', 'residencia', 'ambos'].includes(x.objetivo)) p.objetivo = x.objetivo;
  if (typeof x.alvo === 'string' && x.alvo.trim()) p.alvo = str(x.alvo, 80);
  if (typeof x.dataProva === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.dataProva)) { p.dataProva = x.dataProva; p.semData = false; }
  if (typeof x.semData === 'boolean') { p.semData = x.semData; if (x.semData) p.dataProva = ''; }
  if (Array.isArray(x.provasFaculdade)) {
    const novas = x.provasFaculdade.map(o => ({
      disciplina: str(o && o.disciplina, 60),
      data: /^\d{4}-\d{2}-\d{2}$/.test(o && o.data) ? o.data : '',
      tipo: str(o && o.tipo, 40),
      assuntos: Array.isArray(o && o.assuntos) ? o.assuntos.map(a => str(a, 120)).filter(Boolean).slice(0, 60) : []
    })).filter(o => o.disciplina && o.data).slice(0, 40);
    if (novas.length) { p.provasFaculdade = novas; p.semProvas = false; }
  }
  if (Array.isArray(x.aulasFaculdade)) {
    const au = x.aulasFaculdade.map(o => ({ disciplina: str(o && o.disciplina, 60), data: /^\d{4}-\d{2}-\d{2}$/.test(o && o.data) ? o.data : '', tema: str(o && o.tema, 140) })).filter(o => o.disciplina && o.data && o.tema).slice(0, 500);
    if (au.length) p.aulasFaculdade = au;
  }
  if (typeof x.semConteudo === 'boolean') p.semConteudo = x.semConteudo;
  if (typeof x.manualNome === 'string' && x.manualNome.trim()) p.manualNome = str(x.manualNome, 120);
  if (typeof x.semProvas === 'boolean') { p.semProvas = x.semProvas; if (x.semProvas) p.provasFaculdade = []; }
  if (Array.isArray(x.horas) && x.horas.length === 7) {
    const h = x.horas.map(v => clamp(Math.round(+v || 0), 0, 960));
    if (h.some(v => v > 0)) p.horas = h;
  }
  const lista = v => Array.isArray(v) ? [...new Set(v.map(s => str(s, 60)).filter(Boolean))].slice(0, 20) : null;
  const dif = lista(x.dificuldades); if (dif && dif.length) { p.dificuldades = dif; p.semDificuldades = false; }
  const fortes = lista(x.fortes); if (fortes && fortes.length) p.fortes = fortes;
  if (typeof x.semDificuldades === 'boolean') { p.semDificuldades = x.semDificuldades; if (x.semDificuldades) p.dificuldades = []; }
  if (['aulas', 'resumos', 'questoes', 'equilibrado'].includes(x.metodo)) p.metodo = x.metodo;
  const cursos = lista(x.cursos); if (cursos && cursos.length) p.cursos = cursos.filter(c => ['MEDCURSO', 'Estratégia', 'APOSTILAS'].includes(c));
  if (typeof x.anseios === 'string') {
    const a = str(x.anseios, 600);
    if (a && !norm(p.anseios).includes(norm(a))) p.anseios = (p.anseios ? p.anseios + ' | ' : '') + a;
    p.anseios = p.anseios.slice(-900);
  }
  return p;
}

export function faltando(p) {
  const f = [];
  if (!p.objetivo) return ['objetivo'];
  if (p.objetivo !== 'graduacao' && !p.dataProva && !p.semData) f.push('prova');
  if (p.objetivo !== 'residencia' && !(p.provasFaculdade || []).length && !p.semProvas) f.push('faculdade');
  if (p.objetivo !== 'residencia' && (p.provasFaculdade || []).some(x => !(x.assuntos || []).length) && !p.semConteudo) f.push('conteudo');
  if (!p.horas) f.push('horas');
  if (!(p.dificuldades || []).length && !p.semDificuldades) f.push('dificuldades');
  if (!p.metodo) f.push('metodo');
  return f;
}

/* ───────────────────────── Parsers (modo sem IA) ───────────────────────── */
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function parseData(txt, hoje) {
  const n = norm(txt);
  const ano0 = +hoje.slice(0, 4);
  const mk = (d, m, a) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    let y = a ? (a < 100 ? 2000 + a : a) : ano0;
    let iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!a && iso < hoje) iso = `${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return iso;
  };
  let r;
  if ((r = n.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/))) return mk(+r[1], +r[2], r[3] ? +r[3] : 0);
  if ((r = n.match(/daqui\s*(?:a|há)?\s*(\d+)\s*(mes|meses|semana|semanas|dia|dias)/)) || (r = n.match(/\bem\s+(\d+)\s*(mes|meses|semana|semanas|dias)/))) {
    const q = +r[1]; const un = r[2];
    return addDias(hoje, un.startsWith('mes') ? q * 30 : un.startsWith('sem') ? q * 7 : q);
  }
  for (let i = 0; i < 12; i++) {
    const re = new RegExp('(?:dia\\s*(\\d{1,2})\\s*(?:de)?\\s*)?' + MESES[i] + '(?:\\s*(?:de|\\/)?\\s*(\\d{4}))?');
    if ((r = n.match(re))) {
      const dia = r[1] ? +r[1] : 15;
      return mk(dia, i + 1, r[2] ? +r[2] : 0);
    }
  }
  return null;
}

export function parseHoras(txt) {
  const n = norm(txt);
  const h = [0, 0, 0, 0, 0, 0, 0];
  const dias = { dom: [0], seg: [1], ter: [2], qua: [3], qui: [4], sex: [5], sab: [6] };
  const escopo = c => {
    if (/fim de semana|fins de semana|finais de semana|fds/.test(c)) return [0, 6];
    if (/seg\w*\s*(a|ate|-)\s*sex|dias uteis|durante a semana|de semana|semana toda|todos os dias|por dia|diari|dia\b/.test(c)) return /todos os dias|por dia|diari/.test(c) ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
    const hit = [];
    for (const [k, v] of Object.entries(dias)) if (new RegExp('\\b' + k).test(c)) hit.push(...v);
    return hit;
  };
  const chunks = n.split(/[;\n]|,\s*|\s+e\s+(?=\d|sab|dom|fim)/).map(s => s.trim()).filter(Boolean);
  let achou = false, primeiro = true;
  for (const c of chunks) {
    let min = null, m;
    if ((m = c.match(/(\d+(?:[.,]\d+)?)\s*(?:h|horas?|hrs?)\s*(\d{1,2})?/))) min = Math.round(parseFloat(m[1].replace(',', '.')) * 60 + (m[2] ? +m[2] : 0));
    else if ((m = c.match(/(\d+)\s*min/))) min = +m[1];
    else if ((m = c.match(/^\D*(\d+(?:[.,]\d+)?)\D*$/)) && parseFloat(m[1].replace(',', '.')) <= 14) min = Math.round(parseFloat(m[1].replace(',', '.')) * 60);
    const livre = /livre|nao estudo|folga|descanso|sem estudar|zero/.test(c);
    let alvo = escopo(c);
    if (min == null && livre && alvo.length) { alvo.forEach(i => (h[i] = 0)); achou = true; continue; }
    if (min == null) continue;
    if (!alvo.length) alvo = primeiro && chunks.length === 1 ? [0, 1, 2, 3, 4, 5, 6] : primeiro ? [1, 2, 3, 4, 5] : [];
    alvo.forEach(i => (h[i] = min)); achou = true; primeiro = false;
  }
  return achou && h.some(v => v > 0) ? h : null;
}

export function acharDiscs(txt) {
  const n = norm(txt);
  const out = [];
  for (const d of DISCS) {
    if (d.go) continue;
    const base = d.re.source.split('|')[0].replace(/\.\*.*/, '');
    if (new RegExp(base).test(n) || n.includes(norm(d.nome))) out.push(d.nome);
  }
  if (/\bgo\b|gineco.*obst|tocoginec/.test(n)) out.push('Ginecologia', 'Obstetrícia');
  if (/clinica medica|\bcm\b/.test(n)) out.push('Cardiologia', 'Pneumologia', 'Nefrologia', 'Endocrinologia', 'Infectologia');
  if (/\bmfc\b|saude coletiva|\bsus\b/.test(n)) out.push('Medicina Preventiva');
  return [...new Set(out)];
}

export function parseFaculdade(txt, hoje) {
  const provas = [];
  const partes = String(txt).split(/[;\n]|,(?=[^,;\n]*\d{1,2}\/\d{1,2})/);
  for (const parte of partes) {
    const m = parte.match(/\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?/);
    const data = parseData(parte, hoje);
    if (!data) continue;
    const antes = m ? parte.slice(0, m.index) : parte;
    const depois = m ? parte.slice(m.index + m[0].length) : '';
    const nome = antes.replace(/\b(prova|avalia[cç][aã]o)\b.*$/i, ' ').replace(/\b(dia|prova|de|em|no|na|do|da)\s*$/gi, ' ').replace(/[():\-–]/g, ' ').replace(/\s+/g, ' ').trim();
    const assuntos = depois.replace(/^[\s:\-–)(]+/, '').replace(/^(conteudo|conteúdo|assuntos?|materia|matéria)\s*[:\-]?\s*/i, '').split(/[,;]|\s+e\s+/).map(a => a.trim()).filter(a => a.length > 2);
    provas.push({ disciplina: nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : 'Prova da faculdade', data, assuntos });
  }
  return provas;
}

const NEGA = /^(nao|não|nenhum[a]?|nada|sem|n\/a|ainda nao|nao sei|nao tenho|pular|pula)\b/;

// Interpreta a resposta do aluno para o campo que foi perguntado e devolve o patch do perfil
export function interpretarResposta(campo, texto, hoje, provasAtuais) {
  const n = norm(texto).trim();
  const patch = {};
  if (campo === 'objetivo') {
    const grad = /gradua|facul|prova da facul|periodo|semestre|curso/.test(n);
    const res = /resid|enare|enamed|usp|unifesp|r1\b|concurso/.test(n);
    if (/ambos|os dois|as duas|junto|hibrid|tudo/.test(n) || (grad && res)) patch.objetivo = 'ambos';
    else if (grad) patch.objetivo = 'graduacao';
    else if (res) patch.objetivo = 'residencia';
  } else if (campo === 'prova') {
    if (NEGA.test(n) || /nao sei|sem data|indefinid/.test(n)) patch.semData = true;
    else {
      const d = parseData(texto, hoje);
      if (d) patch.dataProva = d;
      let alvo = String(texto).replace(/\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?/g, '').replace(/\b(prova|dia|em|de|para|a|o|no|na)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      alvo = alvo.replace(/[,;:\-\s]+$/, '');
      if (alvo.length >= 2 && alvo.length <= 60 && !/^\d+$/.test(alvo) && !MESES.some(m => norm(alvo) === m)) patch.alvo = alvo;
      else if (d) patch.alvo = 'Prova de residência';
    }
  } else if (campo === 'faculdade') {
    if (NEGA.test(n)) patch.semProvas = true;
    else { const f = parseFaculdade(texto, hoje); if (f.length) patch.provasFaculdade = f; }
  } else if (campo === 'conteudo') {
    if (NEGA.test(n)) patch.semConteudo = true;
    else {
      const provas = (provasAtuais || []).map(x => ({ ...x }));
      const linhas = String(texto).split(/\n/).map(l => l.trim()).filter(Boolean);
      const lista = a => a.split(/[,;]|\s+e\s+/).map(x => x.trim()).filter(x => x.length > 2);
      let mudou = false;
      for (const l of linhas) {
        const segs = l.split(/;\s*(?=[^;:]{3,60}:)/);
        for (const sg of segs) {
          const m = sg.match(/^([^:\-–]{3,60})\s*[:\-–]\s*(.+)$/);
          if (m) {
            const alvo = provas.find(pr => norm(pr.disciplina).includes(norm(m[1]).trim()) || norm(m[1]).includes(norm(pr.disciplina)));
            if (alvo) { alvo.assuntos = [...new Set([...(alvo.assuntos || []), ...lista(m[2])])]; mudou = true; }
          } else {
            const vazias = provas.filter(pr => !(pr.assuntos || []).length);
            if (vazias.length === 1) { vazias[0].assuntos = lista(sg); mudou = true; }
          }
        }
      }
      if (mudou) patch.provasFaculdade = provas;
    }
  } else if (campo === 'horas') {
    const h = parseHoras(texto); if (h) patch.horas = h;
  } else if (campo === 'dificuldades') {
    if (NEGA.test(n)) patch.semDificuldades = true;
    else {
      const idx = n.search(/\b(forte|bom em|boa em|facilidade|domino|tranquil)/);
      const parteDif = idx > 0 ? n.slice(0, idx) : n;
      const parteFor = idx > 0 ? n.slice(idx) : '';
      const dif = acharDiscs(parteDif); const fortes = acharDiscs(parteFor);
      if (dif.length) patch.dificuldades = dif; else if (!fortes.length) patch.dificuldades = String(texto).split(/[,;]| e /).map(s => s.trim()).filter(s => s.length > 2).slice(0, 8);
      if (fortes.length) patch.fortes = fortes;
    }
  } else if (campo === 'metodo') {
    if (/equilibr|misto|mix|tudo|um pouco de tudo|combin/.test(n)) patch.metodo = 'equilibrado';
    else if (/quest/.test(n)) patch.metodo = 'questoes';
    else if (/resum|leitura|ler|apostila|pdf/.test(n)) patch.metodo = 'resumos';
    else if (/aula|video/.test(n)) patch.metodo = 'aulas';
  } else if (campo === 'cursos') {
    const c = [];
    if (/medcurso/.test(n)) c.push('MEDCURSO');
    if (/estrategia/.test(n)) c.push('Estratégia');
    if (/apostila|resumo|casal/.test(n)) c.push('APOSTILAS');
    if (/todos|tudo|qualquer/.test(n)) c.push('MEDCURSO', 'Estratégia', 'APOSTILAS');
    if (c.length) patch.cursos = c;
  } else if (campo === 'extras') {
    if (!NEGA.test(n) && n.length > 2) patch.anseios = String(texto).slice(0, 500);
  }
  return patch;
}

const NOMES = (p) => (p.objetivo === 'graduacao' ? 'graduação' : p.objetivo === 'ambos' ? 'graduação + residência' : 'residência');

// Próxima pergunta do roteiro (modo sem IA e também reserva quando a IA falha)
export function proximaPergunta(p, jaPerguntouExtras) {
  const f = faltando(p);
  const c = f[0];
  if (c === 'objetivo') return { campo: 'objetivo', reply: 'Oi! Vou montar seu cronograma conversando com você — sem receita pronta. Primeiro: qual é o seu foco agora?', quick: ['Só graduação (provas da faculdade)', 'Só residência', 'Os dois ao mesmo tempo'] };
  if (c === 'prova') return { campo: 'prova', reply: 'Qual prova de residência você vai fazer e quando é? (ex.: "ENARE, 15/11/2026" ou "USP em março de 2027"). Se ainda não tem data, diga "não sei" que eu trabalho com um ciclo contínuo.', quick: ['Ainda não sei a data'] };
  if (c === 'faculdade') return { campo: 'faculdade', reply: 'Quais provas da faculdade você tem pela frente? Mande disciplina e data, como: "Farmacologia 20/10, Patologia 05/11". Vou proteger a semana de cada uma.', quick: ['Não tenho provas agora'] };
  if (c === 'conteudo') { const sem = (p.provasFaculdade || []).filter(x => !(x.assuntos || []).length).map(x => x.disciplina); return { campo: 'conteudo', reply: `Para o cronograma ficar alinhado ao manual, preciso do conteúdo de cada prova (${sem.join(', ')}). Digite assim: «Farmacologia: antibióticos, anti-inflamatórios; Patologia: inflamação, neoplasias» — ou envie o PDF do manual do aluno/ementa pelo botão de clipe 📎 ao lado.`, quick: ['Não tenho o conteúdo ainda'] }; }
  if (c === 'horas') return { campo: 'horas', reply: 'Quanto tempo real você consegue estudar? Pode detalhar por dia, por exemplo: "3h de segunda a sexta, 5h no sábado e domingo livre".', quick: ['2h por dia, todos os dias', '3h seg-sex e 4h sáb/dom', '4h seg-sex, domingo livre'] };
  if (c === 'dificuldades') return { campo: 'dificuldades', reply: 'Em quais matérias você tem mais dificuldade? Elas ganham mais peso. Se tiver pontos fortes, diga também ("forte em Cardiologia").', quick: ['Pediatria e Cirurgia', 'Ginecologia e Obstetrícia', 'Clínica Médica', 'Sem dificuldade específica'] };
  if (c === 'metodo') return { campo: 'metodo', reply: 'Como você aprende melhor? Isso define a proporção entre aula, resumo e questões em cada tarefa.', quick: ['Mais aulas', 'Mais resumos/leitura', 'Mais questões', 'Equilibrado'] };
  if (!jaPerguntouExtras) return { campo: 'extras', reply: 'Última coisa: existe algo que eu deva considerar? (plantões, estágio, horário em que rende mais, aulas da faculdade que não pode perder, cansaço…). Se não, é só dizer "não".', quick: ['Não, pode gerar'] };
  return null;
}

export function resumoPerfil(p) {
  const l = [];
  l.push(`Foco: ${NOMES(p)}`);
  if (p.alvo || p.dataProva) l.push(`Residência: ${p.alvo || 'prova'}${p.dataProva ? ' em ' + p.dataProva.split('-').reverse().join('/') : ''}`);
  if ((p.provasFaculdade || []).length) l.push('Provas da faculdade: ' + p.provasFaculdade.map(x => `${x.disciplina} (${x.data.split('-').reverse().slice(0, 2).join('/')}${x.assuntos && x.assuntos.length ? ', ' + x.assuntos.length + ' assuntos' : ', sem conteúdo informado'})`).join(', '));
  if (p.manualNome) l.push('Manual/ementa usado: ' + p.manualNome);
  if ((p.aulasFaculdade || []).length) l.push(`${p.aulasFaculdade.length} aulas/TBLs da faculdade com data (prévia agendada no dia anterior)`);
  if (p.horas) l.push('Horas: ' + [1, 2, 3, 4, 5, 6, 0].map(i => `${DIAS_NOME[i].slice(0, 3)} ${(p.horas[i] / 60).toFixed(p.horas[i] % 60 ? 1 : 0)}h`).join(' · '));
  if ((p.dificuldades || []).length) l.push('Dificuldades: ' + p.dificuldades.join(', '));
  if ((p.fortes || []).length) l.push('Pontos fortes: ' + p.fortes.join(', '));
  if (p.metodo) l.push('Método: ' + ({ aulas: 'mais aulas', resumos: 'mais resumos', questoes: 'mais questões', equilibrado: 'equilibrado' })[p.metodo]);
  if (p.anseios) l.push('Observações: ' + p.anseios);
  return l;
}

/* ───────────────────────── Geração das tarefas ───────────────────────── */
const RATIOS = {
  aulas: { aula: 0.6, resumo: 0.1, quest: 0.25, flash: 0.05 },
  resumos: { aula: 0.15, resumo: 0.5, quest: 0.3, flash: 0.05 },
  questoes: { aula: 0.25, resumo: 0.1, quest: 0.55, flash: 0.1 },
  equilibrado: { aula: 0.45, resumo: 0.15, quest: 0.3, flash: 0.1 }
};
const r5 = n => Math.max(5, Math.round(n / 5) * 5);

function montarPool(p, inicio, fim) {
  // devolve [{nome, peso, custom?, assuntos?, prova?}]
  const pool = new Map();
  const dif = new Set((p.dificuldades || []).map(norm));
  const fortes = new Set((p.fortes || []).map(norm));
  const ajusta = (nome, peso) => {
    let w = peso;
    if ([...dif].some(x => norm(nome).includes(x) || x.includes(norm(nome)))) w *= 2.2;
    if ([...fortes].some(x => norm(nome).includes(x) || x.includes(norm(nome)))) w *= 0.6;
    // "Clínica Médica" como dificuldade vale para todas as subáreas clínicas
    if (dif.has('clinica medica') && DISC_BY_NAME.get(nome) && DISC_BY_NAME.get(nome).banco === 'Clínica Médica') w *= 2.2;
    return w;
  };
  if (p.objetivo !== 'graduacao') {
    const escala = p.objetivo === 'ambos' ? 0.7 : 1;
    for (const d of DISCS) if (d.peso > 0) pool.set(d.nome, { nome: d.nome, peso: ajusta(d.nome, d.peso) * escala });
  }
  if (p.objetivo !== 'residencia') {
    const porDisc = new Map();
    for (const pr of (p.provasFaculdade || []).slice().sort((a, b) => a.data.localeCompare(b.data))) {
      if (diffDias(inicio, pr.data) < 1) continue; // prova passada ou hoje: nada a estudar
      const d = detectDisc(pr.disciplina);
      const nome = d ? (d.go ? 'Obstetrícia' : d.nome) : pr.disciplina;
      if (!porDisc.has(nome)) porDisc.set(nome, { nome, custom: !d, exibir: pr.disciplina, provas: [], fila: [] });
      const e = porDisc.get(nome);
      e.provas.push(pr);
      const lista = pr.assuntos && pr.assuntos.length ? pr.assuntos : ['Conteúdo geral da prova'];
      lista.forEach((assunto, i) => e.fila.push({ assunto, prova: pr, ordem: i, coberto: false, semConteudo: !(pr.assuntos && pr.assuntos.length) }));
    }
    for (const e of porDisc.values()) { e.peso = 2; pool.set(e.nome, e); }
    for (const dn of p.dificuldades || []) {
      const d = detectDisc(dn);
      if (d && !pool.has(d.nome) && p.objetivo === 'graduacao') pool.set(d.nome, { nome: d.nome, peso: 2 });
    }
  }
  pool.forEach(e => { e.base = e.peso; });
  montarPool.ajusta = ajusta;
  return [...pool.values()];
}

function passoTexto(ac, ctx) {
  const { tema, disc, foco, vids, ultima, parte } = ctx;
  switch (ac) {
    case 'aula':
      return vids && vids.length
        ? `Assista ${vids.length > 1 ? `às ${vids.length} aulas` : 'à aula'} de "${tema}"${parte}. Pause nos quadros e tabelas e anote só o essencial: ${foco}. Não copie o que o professor fala — escreva o que você teria que lembrar na prova.`
        : `Estude "${tema}" no seu material principal da faculdade/cursinho, anotando ${foco}.`;
    case 'resumo':
      if (ctx.manual) return `Leia no manual da faculdade a seção sobre "${tema}" (conteúdo da prova de ${ctx.manual}). ${ctx.temResumo ? 'Complemente com o resumo indicado ao lado. ' : ''}Monte 1 página só com o que o manual diz que será cobrado: definições, classificações, mecanismos e o que for citado como objetivo de aprendizagem.`;
      return ctx.temResumo
        ? `Leia o resumo indicado de "${tema}" e passe a limpo, em 1 página, o esquema de diagnóstico e conduta. Sublinhe o que a aula ainda não tinha te mostrado.`
        : `Sem resumo pronto para este tema: transforme suas anotações da aula em um mapa de 1 página (definição → diagnóstico → conduta → pegadinhas).`;
    case 'questoes':
      return `Resolva ${ctx.nq} questões de ${disc} sobre "${tema}" no modo cronometrado (~3 min cada). Para cada erro, escreva em uma linha por que errou (conceito, atenção ou chute) — isso vira sua lista de revisão.`;
    case 'flashcards':
      return `Crie/revise flashcards de "${tema}": 1 cartão por critério, dose ou conduta que você errou ou hesitou. Limite de 10 cartões novos.`;
    default: return '';
  }
}

function tituloAula(v) {
  let t = limparTema(v.titulo || '');
  t = t.replace(/\s*-?\s*\d+h\d+m\s*$/i, '').replace(/\b(USAR ESTE|NOVO|ATUALIZADO)\b/gi, ' ');
  t = t.replace(/^(v[ií]deo\s*aula|aula\s*b[oô]nus|aulab[oô]nus|aula)\s*/i, '').replace(/\bMEDCURSO\b/gi, ' ').replace(/\bS\d{1,2}\b/g, ' ').replace(/\b[A-Z]{2,4}\d{1,2}\b/g, ' ');
  t = t.replace(/\s+/g, ' ').replace(/^[-–:\s]+|[-–:\s]+$/g, '').trim();
  if ((t.match(/[A-Za-zÀ-ú]/g) || []).length < 5) return '';
  if (t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
  return t.slice(0, 90);
}

function buildEstudo(disc, tema, minutos, metodo, tc, usadosVideos, cursosPref, extra) {
  const info = DISC_BY_NAME.get(disc) || {};
  const foco = (extra && extra.foco) || info.foco || 'definição, critérios diagnósticos, conduta e pegadinhas de prova';
  const banco = info.banco || disc;
  const rt = RATIOS[metodo] || RATIOS.equilibrado;
  let vids = [];
  let parte = '';
  if (tc) {
    const restantes = tc.videos.filter(v => !usadosVideos.has(v.id));
    if (restantes.length) {
      let n = rt.aula > 0.2 ? Math.max(1, Math.floor((minutos * rt.aula) / MIN_AULA + 0.3)) : 0;
      n = Math.min(n, restantes.length, Math.max(1, Math.floor((minutos - 25) / MIN_AULA)));
      vids = restantes.slice(0, n);
      const idxIni = tc.videos.indexOf(vids[0]) + 1;
      if (tc.videos.length > 1 && vids.length) parte = vids.length > 1 ? ` (aulas ${idxIni}–${idxIni + vids.length - 1} de ${tc.videos.length} deste tema)` : ` (aula ${idxIni} de ${tc.videos.length} deste tema)`;
    }
  }
  const aulaMin = vids.length ? vids.length * MIN_AULA : 0;
  const subs = vids.map(tituloAula).filter(Boolean);
  const subtema = subs.length ? (subs.length > 1 ? `${subs[0]} (+${subs.length - 1})` : subs[0]) : '';
  const temaBusca = (extra && extra.assunto) ? extra.assunto : [tema, ...subs].join(' ');
  let flashMin = Math.max(5, r5(minutos * rt.flash));
  const resMat = acharMaterial(DISC_BY_NAME.has(disc) ? disc : null, temaBusca, 'resumo', cursosPref);
  let resMin = r5(minutos * rt.resumo + (aulaMin ? 0 : minutos * rt.aula * 0.6));
  if (!resMat.length && rt.resumo < 0.3 && aulaMin) resMin = Math.min(resMin, 10);
  let qMin = minutos - aulaMin - resMin - flashMin;
  if (qMin < 10) { qMin = 10; resMin = Math.max(5, minutos - aulaMin - qMin - flashMin); }
  const nq = Math.max(5, Math.round(qMin / 3));
  const temaTxt = subs[0] && vids.length === 1 ? subs[0] : tema;
  const ctx = { tema: (extra && extra.assunto) || temaTxt, disc: (extra && extra.exibir) || disc, foco, vids, parte, temResumo: resMat.length > 0, nq, manual: extra && extra.manual };
  const passos = []; const recursos = [];
  if (vids.length) {
    passos.push({ acao: 'aula', minutos: aulaMin, texto: passoTexto('aula', ctx), recursos: vids.map(v => recursos.push({ tipo: 'video', id: v.id, titulo: tituloAula(v) || tema, curso: v.course }) - 1) });
  } else if (rt.aula >= 0.45) {
    passos.push({ acao: 'aula', minutos: r5(minutos * 0.4), texto: passoTexto('aula', ctx), recursos: [] });
    resMin = Math.max(5, minutos - r5(minutos * 0.4) - qMin - flashMin);
  }
  if (resMin >= 5) {
    const idxs = resMat.map(m => recursos.push({ tipo: 'pdf', id: m.id, titulo: m.titulo, curso: m.curso }) - 1);
    passos.push({ acao: 'resumo', minutos: resMin, texto: passoTexto('resumo', ctx), recursos: idxs });
  }
  const bq = acharMaterial(DISC_BY_NAME.has(disc) ? disc : null, temaBusca, 'questoes', cursosPref);
  const temaQ = (extra && extra.assunto) || tema;
  const qIdx = [recursos.push({ tipo: 'questoes', titulo: `Questões: ${temaQ}`, tema: temaQ, disc: banco }) - 1];
  if (bq.length) qIdx.push(recursos.push({ tipo: 'pdf', id: bq[0].id, titulo: bq[0].titulo, curso: bq[0].curso, rotulo: 'Banco em PDF' }) - 1);
  passos.push({ acao: 'questoes', minutos: qMin, texto: passoTexto('questoes', ctx), recursos: qIdx });
  const fIdx = [recursos.push({ tipo: 'flashcards', titulo: `Flashcards: ${temaQ}`, tema: temaQ, disc }) - 1];
  passos.push({ acao: 'flashcards', minutos: flashMin, texto: passoTexto('flashcards', ctx), recursos: fIdx });
  passos.forEach((s, i) => (s.n = i + 1));
  const total = passos.reduce((a, s) => a + s.minutos, 0);
  return {
    tipo: 'estudo', titulo: `${extra && extra.exibir || disc} — ${(extra && extra.assunto) || subtema || tema}`, materia: disc, tema: (extra && extra.assunto) || (subs[0] && vids.length === 1 ? subs[0] : tema), modulo: tema, minutos: total, passos, recursos,
    estrategia: Object.fromEntries(passos.map(s => [s.acao, s.minutos])),
    _vids: vids.map(v => v.id)
  };
}

const chaveCob = (disc, assunto) => norm(disc) + '|' + norm(assunto);

export function gerarTarefas({ perfil, hoje, inicio, dias, retidas = [] }) {
  const p = { ...PERFIL_VAZIO(), ...perfil };
  const horas = p.horas || [0, 120, 120, 120, 120, 120, 0];
  const ini = inicio || hoje;
  // horizonte
  let alvoFim = null;
  if (p.objetivo !== 'graduacao' && p.dataProva) alvoFim = p.dataProva;
  if (p.objetivo === 'graduacao') alvoFim = (p.provasFaculdade || []).map(x => x.data).sort().pop() || null;
  let nd = dias || 56;
  if (!dias && alvoFim) nd = clamp(diffDias(ini, alvoFim) + 1, 14, 56);
  const fim = addDias(ini, nd - 1);

  const mantidas = retidas.filter(t => t && t.data < ini);
  const usados = new Set();
  mantidas.forEach(t => (t._vids || (t.recursos || []).filter(r => r.tipo === 'video').map(r => r.id)).forEach(id => usados.add(id)));

  const pool = montarPool(p, ini, fim);
  const ajusta = montarPool.ajusta;
  const credit = new Map(pool.map(x => [x.nome, 0]));
  // cobertura do conteúdo da prova já cumprida em tarefas mantidas
  const cobertas = new Set();
  const chave = chaveCob;
  retidas.forEach(t => { if (t && t.cobre && t.status === 'feito') cobertas.add(t.cobre); });
  pool.forEach(e => (e.fila || []).forEach(it => { if (cobertas.has(chave(e.nome, it.assunto))) it.coberto = true; }));
  const aulasPend = (p.aulasFaculdade || []).filter(a => a.data >= ini).map(a => ({ ...a, feita: false }));
  const temasCache = new Map();
  const getTemas = nome => { if (!temasCache.has(nome)) temasCache.set(nome, temasDaDisc(nome, p.cursos)); return temasCache.get(nome); };
  const temaAtual = nome => getTemas(nome).find(t => t.videos.some(v => !usados.has(v.id)));
  const assuntoIdx = new Map(); // disciplinas customizadas

  // fila de revisões espaçadas (a partir das tarefas de estudo já feitas)
  const fila = [];
  const novasTarefas = [];
  const agendarRevisoes = t => {
    [[1, 'rapida'], [7, 'questoes'], [30, 'questoes']].forEach(([d, kind], i) => {
      fila.push({ due: addDias(t.data, d), materia: t.materia, tema: t.tema, kind, rot: ['24h', '7 dias', '30 dias'][i], origem: t.data });
    });
  };
  mantidas.filter(t => t.tipo === 'estudo' && t.status === 'feito').forEach(agendarRevisoes);

  let seq = 0;
  const mkId = d => `v2-${d.replace(/-/g, '')}-${++seq}`;
  const provas = (p.provasFaculdade || []).slice().sort((a, b) => a.data.localeCompare(b.data));
  let pendenteErros = false;

  for (let k = 0; k < nd; k++) {
    const d = addDias(ini, k);
    const wd = wdOf(d);
    const tarefasDia = [];
    // provas da faculdade: evento + modo prova
    const provaHoje = provas.find(x => x.data === d);
    if (provaHoje) tarefasDia.push({ id: mkId(d), data: d, tipo: 'prova', titulo: `PROVA — ${provaHoje.disciplina}`, materia: provaHoje.disciplina, tema: 'Prova', minutos: 0, passos: [{ n: 1, acao: 'prova', minutos: 0, texto: 'Dia de prova: só uma passada de 15 min no seu resumo de 1 página pela manhã. Durma bem ontem, coma bem hoje e chegue com folga.', recursos: [] }], recursos: [], estrategia: {}, observacoes: 'Nada novo hoje. Depois da prova, descanse — o cronograma volta amanhã.', status: 'pendente' });
    let avail = horas[wd] || 0;
    if (provaHoje) avail = 0;
    const provaProx = provas.find(x => { const dd = diffDias(d, x.data); return dd >= 1 && dd <= 10; });
    const veiaPerigo = provaProx && diffDias(d, provaProx.data) === 1;

    if (avail >= 20) {
      let usado = 0;
      // 1) revisões espaçadas vencidas
      const orcRev = Math.min(Math.round(avail * 0.3), 60);
      const venc = fila.filter(r => r.due <= d).sort((a, b) => a.due.localeCompare(b.due));
      const itens = []; let minRev = 0;
      for (const r of venc) {
        const mn = r.kind === 'rapida' ? 10 : 15;
        if (minRev + mn > orcRev) break;
        itens.push(r); minRev += mn;
      }
      if (itens.length) {
        itens.forEach(r => fila.splice(fila.indexOf(r), 1));
        const recursos = []; const passos = itens.map((r, i) => {
          const idx = [recursos.push({ tipo: r.kind === 'rapida' ? 'flashcards' : 'questoes', titulo: (r.kind === 'rapida' ? 'Flashcards: ' : 'Questões: ') + r.tema, tema: r.tema, disc: (DISC_BY_NAME.get(r.materia) || {}).banco || r.materia }) - 1];
          return { n: i + 1, acao: r.kind === 'rapida' ? 'flashcards' : 'questoes', minutos: r.kind === 'rapida' ? 10 : 15, recursos: idx, texto: r.kind === 'rapida' ? `Revisão de ${r.rot} — "${r.tema}" (${r.materia}): faça os flashcards do tema SEM olhar o resumo; o que errar volta amanhã.` : `Revisão de ${r.rot} — "${r.tema}" (${r.materia}): 8–10 questões do tema. Se acertar ≥ 80%, o tema sai da fila; senão, releia seu resumo.` };
        });
        tarefasDia.push({ id: mkId(d), data: d, tipo: 'revisao', titulo: `Revisão espaçada (${itens.length} ${itens.length > 1 ? 'temas' : 'tema'})`, materia: 'Revisão', tema: itens.map(i => i.tema).join(' · '), minutos: minRev, passos, recursos, estrategia: { revisao: minRev }, observacoes: 'Revisão nos intervalos 24h → 7 dias → 30 dias é o que transforma aula assistida em memória de longo prazo. Faça no começo do dia, com a cabeça fresca.', status: 'pendente' });
        usado += minRev;
      }
      // 2) simulado semanal + correção de erros
      if (pendenteErros && wd !== 6 && avail - usado >= 40 && !veiaPerigo) {
        tarefasDia.push({ id: mkId(d), data: d, tipo: 'erros', titulo: 'Correção do simulado: caderno de erros', materia: 'Simulado', tema: 'Erros do simulado', minutos: 45, passos: [
          { n: 1, acao: 'erros', minutos: 30, texto: 'Refaça só as questões que errou ou chutou. Para cada uma: qual conceito faltou? Escreva a regra em 1 linha no caderno de erros.', recursos: [0] },
          { n: 2, acao: 'flashcards', minutos: 15, texto: 'Transforme as 5 regras mais importantes em flashcards e adicione às revisões.', recursos: [1] }
        ], recursos: [{ tipo: 'erros', titulo: 'Questões que você errou' }, { tipo: 'flashcards', titulo: 'Flashcards (todos devidos)', tema: 'Erros do simulado', disc: '' }], estrategia: { erros: 30, flashcards: 15 }, observacoes: 'O ganho do simulado está na correção, não na nota. Não pule esta tarefa.', status: 'pendente' });
        usado += 45; pendenteErros = false;
      }
      if (wd === 6 && p.objetivo !== 'graduacao' && avail - usado >= 90 && !provaProx) {
        const longo = avail - usado >= 200;
        const nq = longo ? 40 : 20; const mn = longo ? 130 : 70;
        tarefasDia.push({ id: mkId(d), data: d, tipo: 'simulado', titulo: longo ? 'Simulado semanal (40 questões, cronometrado)' : 'Mini-simulado semanal (20 questões)', materia: 'Simulado', tema: 'Todas as áreas da semana', minutos: mn, passos: [
          { n: 1, acao: 'simulado', minutos: nq * 3, texto: `Faça ${nq} questões de uma vez, sem consulta, em ${nq * 3} min. Priorize as áreas estudadas na semana e as suas dificuldades. Marque as questões que chutou.`, recursos: [0] },
          { n: 2, acao: 'erros', minutos: mn - nq * 3, texto: 'Anote o placar por área. A correção detalhada acontece no próximo dia de estudo.', recursos: [] }
        ], recursos: [{ tipo: 'simulado', titulo: 'Simulado do banco de questões', disc: '', tema: '' }], estrategia: { simulado: nq * 3 }, observacoes: 'Treino de resistência e de tempo de prova. Simule o ambiente real: sem celular, sem pausa.', status: 'pendente' });
        usado += mn; pendenteErros = true;
      }
      // 2b) prévia das aulas/TBLs da faculdade (conforme o manual): no dia anterior
      let previas = 0;
      for (const a of aulasPend.filter(x => !x.feita && (x.data === addDias(d, 1) || x.data === d)).slice(0, 2)) {
        if (avail - usado < 40) break;
        a.feita = true;
        const dd = detectDisc(a.disciplina);
        const nomeD = dd ? (dd.go ? 'Obstetrícia' : dd.nome) : a.disciplina;
        const tc = acharAulas(dd ? nomeD : null, a.tema, p.cursos, usados);
        const mn = 35;
        const recursos = []; const passos = [];
        if (tc) { passos.push({ n: 1, acao: 'aula', minutos: 0, texto: `Se quiser reforço, há aula do acervo sobre este assunto: "${tituloAula(tc.videos[0]) || a.tema}".`, recursos: [recursos.push({ tipo: 'video', id: tc.videos[0].id, titulo: tituloAula(tc.videos[0]) || a.tema, curso: tc.videos[0].course }) - 1] }); passos[0].minutos = 5; }
        passos.push({ n: passos.length + 1, acao: 'resumo', minutos: 20, texto: `Leia no manual a parte de "${a.tema}" antes da aula de ${brDate(a.data)}. Anote 3 perguntas que você espera que o professor responda e os termos que não conhece.`, recursos: [] });
        passos.push({ n: passos.length + 1, acao: 'questoes', minutos: mn - 20 - (tc ? 5 : 0), texto: `Faça 4–5 questões sobre "${a.tema}" para testar o que já sabe antes da aula.`, recursos: [recursos.push({ tipo: 'questoes', titulo: `Questões: ${a.tema}`, tema: a.tema, disc: nomeD }) - 1] });
        tarefasDia.push({ id: mkId(d), data: d, tipo: 'estudo', titulo: `Prévia da aula — ${a.disciplina}: ${a.tema}`, materia: nomeD, tema: a.tema, minutos: passos.reduce((x, s) => x + s.minutos, 0), passos, recursos, estrategia: Object.fromEntries(passos.map(s => [s.acao, s.minutos])), observacoes: `Aula/TBL da faculdade em ${brDate(a.data)}, conforme o manual. Chegar com leitura prévia aumenta muito o aproveitamento.`, cobre: chave(nomeD, a.tema), status: 'pendente', _semRevisao: true });
        usado += passos.reduce((x, s) => x + s.minutos, 0); previas++;
      }
      // 3) blocos principais de estudo
      let resto = avail - usado;
      if (veiaPerigo && provaProx) {
        const mn = r5(Math.min(resto, 90));
        if (mn >= 30) {
          const disc0 = detectDisc(provaProx.disciplina);
          const nomeD = disc0 ? disc0.nome : provaProx.disciplina;
          const tk = buildEstudoRevisaoProva(nomeD, provaProx, mn, disc0);
          tarefasDia.push({ id: mkId(d), data: d, ...tk });
          resto -= mn;
        }
      } else if (resto >= 20 && pool.length) {
        // pesos dinâmicos do conteúdo das provas: quanto mais assunto pendente e menos dias, mais peso
        pool.forEach(e => {
          if (!e.fila) return;
          const ups = e.provas.filter(pr => diffDias(d, pr.data) >= 1);
          if (!ups.length) { e.peso = 0; e._need = 0; return; }
          const prox = ups[0]; const dd = diffDias(d, prox.data);
          const pend = e.fila.filter(it => !it.coberto && it.prova === prox).length;
          const total = e.fila.filter(it => it.prova === prox).length;
          const span = Math.max(1, diffDias(ini, prox.data));
          const desejado = Math.ceil(total * clamp((diffDias(ini, d) + 1) / (0.7 * span), 0, 1));
          const feitos = total - pend;
          const atraso = Math.max(0, desejado - feitos);
          const need = pend / Math.max(1, dd - 2);
          e._need = atraso > 1 ? need : 0; e.proxima = prox; e._podeNovo = feitos < desejado;
          e.peso = ajusta(e.nome, clamp(1 + atraso * 2 + (dd <= 7 ? 3 : dd <= 14 ? 1.5 : 0), 1, 14));
        });
        const nBlocos = resto < 60 ? 1 : clamp(Math.round(resto / 100), 1, 4);
        const tam = r5(resto / nBlocos);
        const escolhidas = new Set();
        for (let b = 0; b < nBlocos; b++) {
          // modo prova: se há prova da faculdade em até 10 dias, a disciplina dela domina
          let escolha = null;
          if (provaProx) {
            const dn = detectDisc(provaProx.disciplina);
            const nm = dn ? (dn.go ? 'Obstetrícia' : dn.nome) : provaProx.disciplina;
            const e = pool.find(x => x.nome === nm);
            if (e && (b === 0 || (b === 1 && diffDias(d, provaProx.data) <= 5 && nBlocos > 1) )) escolha = e;
          }
          if (!escolha) {
            const ativos = pool.filter(x => x.peso > 0);
            if (!ativos.length) break;
            ativos.forEach(x => credit.set(x.nome, credit.get(x.nome) + x.peso));
            const somaPeso = ativos.reduce((a, x) => a + x.peso, 0) || 1;
            const cand = ativos.filter(x => !escolhidas.has(x.nome)).sort((a, b) => credit.get(b.nome) - credit.get(a.nome));
            escolha = cand[0] || ativos[0];
            credit.set(escolha.nome, credit.get(escolha.nome) - somaPeso);
          }
          escolhidas.add(escolha.nome);
          const reps = escolha.fila && tam >= 90 && (escolha._need || 0) > 0.8 ? 2 : 1;
          for (let q = 0; q < reps; q++) {
            const t = montarBloco(escolha, reps > 1 ? r5(tam / 2) : tam, d, p, usados, temaAtual, assuntoIdx, provaProx);
            if (t) { t.id = mkId(d); t.data = d; tarefasDia.push(t); if (t.tipo === 'estudo') { (t._vids || []).forEach(id => usados.add(id)); agendarRevisoes(t); } }
          }
        }
      }
    }
    novasTarefas.push(...tarefasDia);
  }
  // sufixos de revisões futuras nas observações
  novasTarefas.filter(t => t.tipo === 'estudo').forEach(t => {
    const r = [1, 7, 30].map(n => addDias(t.data, n));
    t.observacoes = (t.observacoes ? t.observacoes + ' ' : '') + `Revisões automáticas deste tema: ${brDate(r[0])} (24h), ${brDate(r[1])} (7 dias) e ${brDate(r[2])} (30 dias).`;
  });
  const todas = [...mantidas, ...novasTarefas].sort((a, b) => a.data.localeCompare(b.data) || 0);
  return {
    versao: 2, inicio: mantidas.length ? mantidas[0].data : ini, fim, geradoEm: new Date().toISOString(), perfil: p,
    tarefas: todas,
    resumo: {
      dias: nd, tarefas: novasTarefas.length,
      minutosTotais: novasTarefas.reduce((a, t) => a + (t.minutos || 0), 0),
      aulasAgendadas: novasTarefas.reduce((a, t) => a + (t._vids || []).length, 0),
      porMateria: novasTarefas.filter(t => t.tipo === 'estudo').reduce((o, t) => { o[t.materia] = (o[t.materia] || 0) + t.minutos; return o; }, {})
    }
  };
}

function buildEstudoRevisaoProva(nome, prova, mn, disc0) {
  const foco = (disc0 && disc0.foco) || 'o que você mais errou nos materiais da matéria';
  return {
    tipo: 'estudo', titulo: `Véspera da prova — ${prova.disciplina}`, materia: nome, tema: 'Revisão final', minutos: mn,
    passos: [
      { n: 1, acao: 'resumo', minutos: r5(mn * 0.5), texto: (prova.assuntos && prova.assuntos.length) ? `Releia seus resumos dos tópicos da prova, na ordem do manual: ${prova.assuntos.slice(0, 10).join('; ')}${prova.assuntos.length > 10 ? '…' : ''}. Marque o que ainda não está firme. Não abra conteúdo novo.` : `Releia apenas seus resumos e anotações de ${prova.disciplina}, focando em ${foco}. Não abra conteúdo novo.`, recursos: [] },
      { n: 2, acao: 'questoes', minutos: r5(mn * 0.4), texto: 'Refaça as questões que você errou antes. Só as erradas.', recursos: [0] },
      { n: 3, acao: 'flashcards', minutos: Math.max(5, mn - r5(mn * 0.5) - r5(mn * 0.4)), texto: 'Passe os flashcards devidos e pare. Durma cedo.', recursos: [1] }
    ],
    recursos: [{ tipo: 'erros', titulo: 'Questões que você errou' }, { tipo: 'flashcards', titulo: 'Flashcards devidos', tema: prova.disciplina, disc: nome }],
    estrategia: { resumo: r5(mn * 0.5), questoes: r5(mn * 0.4) },
    observacoes: `A prova de ${prova.disciplina} é amanhã (${brDate(prova.data)}). O objetivo de hoje é consolidar, não aprender.`, status: 'pendente'
  };
}

function montarBloco(escolha, minutos, data, p, usados, temaAtual, assuntoIdx, provaProx) {
  const nome = escolha.nome;
  const metodo = p.metodo || 'equilibrado';
  const obs = [];
  if (escolha.fila && escolha.proxima) {
    const prox = escolha.proxima; const dd = diffDias(data, prox.data);
    const doProx = escolha.fila.filter(it => it.prova === prox);
    let it = escolha._podeNovo === false ? null : doProx.find(x => !x.coberto);
    let revisao = false;
    if (!it) { // todo o conteúdo já foi visto: revisão ativa (questões + erros) em rodízio
      const cob = doProx.filter(x => x.coberto);
      const base = cob.length ? cob : doProx;
      const k = assuntoIdx.get(nome + '|rev') || 0; assuntoIdx.set(nome + '|rev', k + 1);
      it = base[k % base.length]; revisao = true;
    } else it.coberto = true;
    const cobertos = doProx.filter(x => x.coberto).length;
    const discCat = DISC_BY_NAME.has(nome) ? nome : null;
    const tc = revisao ? null : acharAulas(discCat, it.assunto, p.cursos, usados);
    const t = buildEstudo(nome, it.assunto, minutos, revisao ? 'questoes' : metodo, tc, usados, p.cursos, { assunto: it.assunto, exibir: escolha.exibir || nome, manual: `${escolha.exibir || nome}, ${brDate(prox.data)}`, foco: 'o que o manual e o professor destacam como conteúdo da prova' });
    if (revisao) { t.titulo = `${escolha.exibir || nome} — Revisão ativa: ${it.assunto}`; t.passos.forEach(s => { if (s.acao === 'questoes') s.texto = 'Conteúdo todo visto: resolva questões deste assunto e, para cada erro, volte ao manual e releia o trecho correspondente.'; }); }
    t.materia = nome; t.cobre = revisao ? undefined : chaveCob(nome, it.assunto);
    const o = [];
    o.push(`Conteúdo da prova de ${escolha.exibir || nome} (${brDate(prox.data)}${dd >= 0 ? `, em ${dd} dia${dd === 1 ? '' : 's'}` : ''}): assunto ${doProx.indexOf(it) + 1} de ${doProx.length}${revisao ? ' — revisão' : ''}; cobertura planejada ${cobertos}/${doProx.length}.`);
    if (it.semConteudo) o.push('Você ainda não informou o conteúdo desta prova — envie o manual/ementa no chat para eu alinhar cada assunto.');
    if (!tc && !revisao) o.push('Sem aula equivalente no acervo: use o manual da faculdade como fonte principal.');
    t.observacoes = o.join(' ');
    t.status = 'pendente';
    return t;
  }
  const dif = (p.dificuldades || []).map(norm).some(x => norm(nome).includes(x) || x.includes(norm(nome)) || (x === 'clinica medica' && (DISC_BY_NAME.get(nome) || {}).banco === 'Clínica Médica'));
  if (dif) obs.push(`${nome} está nas suas dificuldades, por isso recebe mais blocos.`);
  if (escolha.prova) {
    const dd = diffDias(data, escolha.prova.data);
    obs.push(dd >= 0 ? `Prova de ${escolha.prova.disciplina} em ${dd} dia${dd === 1 ? '' : 's'} (${brDate(escolha.prova.data)}).` : '');
  }
  // disciplinas customizadas (da faculdade, fora do acervo) — seguem a lista de assuntos
  if (escolha.custom) {
    const lista = escolha.assuntos && escolha.assuntos.length ? escolha.assuntos : ['Revisão geral da matéria'];
    const i = assuntoIdx.get(nome) || 0; assuntoIdx.set(nome, i + 1);
    const assunto = lista[i % lista.length];
    const rt = RATIOS[metodo];
    const nq = Math.max(5, Math.round(minutos * rt.quest / 3));
    const m1 = r5(minutos * (rt.aula + rt.resumo)); const mq = r5(minutos * rt.quest); const mf = Math.max(5, minutos - m1 - mq);
    return {
      tipo: 'estudo', titulo: `${escolha.exibir || nome} — ${assunto}`, materia: nome, tema: assunto, minutos: m1 + mq + mf,
      passos: [
        { n: 1, acao: 'resumo', minutos: m1, texto: `Estude "${assunto}" pelo material da sua faculdade (slides/livro/aula gravada). Faça um resumo de 1 página: o que a prova de ${escolha.exibir || nome} provavelmente cobra, em tópicos.`, recursos: [] },
        { n: 2, acao: 'questoes', minutos: mq, texto: `Resolva ${nq} questões sobre "${assunto}" (use o banco do app ou questões antigas do professor). Anote o motivo de cada erro.`, recursos: [0] },
        { n: 3, acao: 'flashcards', minutos: mf, texto: `Crie flashcards de "${assunto}" com o que você errou ou esqueceu.`, recursos: [1] }
      ],
      recursos: [{ tipo: 'questoes', titulo: `Questões: ${assunto}`, tema: assunto, disc: nome }, { tipo: 'flashcards', titulo: `Flashcards: ${assunto}`, tema: assunto, disc: nome }],
      estrategia: { resumo: m1, questoes: mq, flashcards: mf },
      observacoes: obs.filter(Boolean).join(' ') || 'Matéria da faculdade fora do seu acervo de aulas — por isso o passo a passo usa o material da própria faculdade.', status: 'pendente'
    };
  }
  const tc = temaAtual(nome);
  if (!tc) {
    // acervo esgotado: manter a disciplina viva com questões + revisão ativa
    const temas = temasDaDisc(nome, p.cursos);
    const tema = temas.length ? temas[(assuntoIdx.get(nome) || 0) % temas.length].tema : 'Questões mistas';
    assuntoIdx.set(nome, (assuntoIdx.get(nome) || 0) + 1);
    const info = DISC_BY_NAME.get(nome) || {};
    const nq = Math.max(8, Math.round(minutos * 0.7 / 3));
    return {
      tipo: 'estudo', titulo: `${nome} — Revisão por questões: ${tema}`, materia: nome, tema, minutos,
      passos: [
        { n: 1, acao: 'questoes', minutos: r5(minutos * 0.7), texto: `Você já passou por todas as aulas de ${nome} do acervo. Resolva ${nq} questões de "${tema}" e revise cada erro.`, recursos: [0] },
        { n: 2, acao: 'resumo', minutos: minutos - r5(minutos * 0.7), texto: `Reescreva em 5 linhas o que ainda erra em ${nome} (${info.foco || 'conceitos-chave'}).`, recursos: [] }
      ],
      recursos: [{ tipo: 'questoes', titulo: `Questões: ${tema}`, tema, disc: info.banco || nome }],
      estrategia: { questoes: r5(minutos * 0.7) }, observacoes: obs.filter(Boolean).join(' ') || 'Aulas do acervo desta disciplina concluídas: agora o foco é fixação.', status: 'pendente'
    };
  }
  const t = buildEstudo(nome, tc.tema, minutos, metodo, tc, usados, p.cursos, { exibir: escolha.exibir });
  if (tc.videos.length > 1) {
    const rest = tc.videos.filter(v => !usados.has(v.id)).length - (t._vids || []).length;
    if (rest > 0) obs.push(`Este tema continua amanhã/nos próximos blocos (${rest} aula${rest > 1 ? 's' : ''} restante${rest > 1 ? 's' : ''}).`);
  }
  t.observacoes = obs.filter(Boolean).join(' ') + (obs.filter(Boolean).length ? ' ' : '') + `Foco da matéria: ${(DISC_BY_NAME.get(nome) || {}).foco || 'conceitos mais cobrados'}.`;
  t.status = 'pendente';
  return t;
}
