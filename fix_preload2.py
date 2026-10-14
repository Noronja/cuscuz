with open('C:/Users/alexl/Downloads/Compressed/cuscuzi/server.js', 'r', encoding='utf-8') as f:
    content = f.read()

old = """/* ════════════════════════════════════════════════════════════════
   SISTEMA DE QUESTÕES (TREINO LIVRE, GERADOR GEMINI & TUTOR)
   ════════════════════════════════════════════════════════════════ */
const QUESTIONS_BANK_FILE = path.join(__dirname, 'data', 'questions-bank.json');

let _bankCache = null;
let _bankTimer = null;
let _bankDirty = false;
let _bankBase = 0; // quantas questões o repositório já tinha quando o servidor subiu
const QUESTIONS_BANK_GZ = QUESTIONS_BANK_FILE + '.gz';
// O banco pré-catalogado vem no repositório compactado (.json.gz, gerado pelo GitHub Actions); o .json é o arquivo de trabalho
function readQuestionsBank() {
  if (_bankCache) return _bankCache;
  try {
    const lerPlain = () => (fs.existsSync(QUESTIONS_BANK_FILE) ? JSON.parse(fs.readFileSync(QUESTIONS_BANK_FILE, 'utf8')) : []);
    const lerGz = () => (fs.existsSync(QUESTIONS_BANK_GZ) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(QUESTIONS_BANK_GZ)).toString('utf8')) : []);
    let a = [], b = [];
    try { a = lerPlain(); } catch (e) { console.warn('banco .json ilegível:', e.message); }
    try { b = lerGz(); } catch (e) { console.warn('banco .json.gz ilegível:', e.message); }
    const data = b.length > a.length ? b : a; // vale o mais completo
    if (Array.isArray(data) && data.length) { _bankBase = data.length; return (_bankCache = data); }
  } catch (err) {
    console.error('Erro ao ler o banco de questões:', err.message);
  }
  return (_bankCache = []);"""

new = """/* ════════════════════════════════════════════════════════════════
   SISTEMA DE QUESTÕES (TREINO LIVRE, GERADOR GEMINI & TUTOR)
   ════════════════════════════════════════════════════════════════ */
const QUESTIONS_BANK_FILE = path.join(__dirname, 'data', 'questions-bank.json');

let _bankCache = null;
let _bankTimer = null;
let _bankDirty = false;
let _bankBase = 0; // quantas questões o repositório já tinha quando o servidor subiu
const QUESTIONS_BANK_GZ = QUESTIONS_BANK_FILE + '.gz';
// O banco pré-catalogado vem no repositório compactado (.json.gz, gerado pelo GitHub Actions); o .json é o arquivo de trabalho
function readQuestionsBank() {
  if (_bankCache) return _bankCache;
  // Primeira chamada: carrega síncrono (fallback), mas agenda recarga assíncrona
  try {
    const lerPlain = () => (fs.existsSync(QUESTIONS_BANK_FILE) ? JSON.parse(fs.readFileSync(QUESTIONS_BANK_FILE, 'utf8')) : []);
    const lerGz = () => (fs.existsSync(QUESTIONS_BANK_GZ) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(QUESTIONS_BANK_GZ)).toString('utf8')) : []);
    let a = [], b = [];
    try { a = lerPlain(); } catch (e) { console.warn('banco .json ilegível:', e.message); }
    try { b = lerGz(); } catch (e) { console.warn('banco .json.gz ilegível:', e.message); }
    const data = b.length > a.length ? b : a; // vale o mais completo
    if (Array.isArray(data) && data.length) { _bankBase = data.length; return (_bankCache = data); }
  } catch (err) {
    console.error('Erro ao ler o banco de questões:', err.message);
  }
  return (_bankCache = []);
}

// Carregamento assíncrono não-bloqueante do banco (chamado no startup)
async function preloadQuestionsBank() {
  try {
    const lerPlain = () => fs.existsSync(QUESTIONS_BANK_FILE) ? JSON.parse(await fs.promises.readFile(QUESTIONS_BANK_FILE, 'utf8')) : [];
    const lerGz = () => fs.existsSync(QUESTIONS_BANK_GZ) ? JSON.parse(zlib.gunzipSync(await fs.promises.readFile(QUESTIONS_BANK_GZ)).toString('utf8')) : [];
    const [a, b] = await Promise.all([lerPlain().catch(() => []), lerGz().catch(() => [])]);
    const data = b.length > a.length ? b : a;
    if (Array.isArray(data) && data.length) {
      _bankCache = data;
      _bankBase = data.length;
      console.log(`📚 Banco de questões pré-carregado: ${data.length} questões`);
    }
  } catch (err) {
    console.warn('Pré-carregamento do banco falhou (carregará sob demanda):', err.message);
  }
}

// Inicia pré-carregamento em background (não bloqueia o servidor)
preloadQuestionsBank();"""

if old in content:
    content = content.replace(old, new)
    with open('C:/Users/alexl/Downloads/Compressed/cuscuzi/server.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: Added async preload for questions bank")
else:
    print("OLD STRING NOT FOUND - trying to find differences")
    idx = content.find("SISTEMA DE QUESTÕES")
    if idx != -1:
        print("Found at:", idx)
        print(repr(content[idx:idx+800]))