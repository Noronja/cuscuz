with open('C:/Users/alexl/Downloads/Compressed/cuscuzi/server.js', 'r', encoding='utf-8') as f:
    content = f.read()

old = """/* ════════════════════════════════════════════════════════════════
   SISTEMA DE QUESTÕES (TREINO LIVRE, GERADOR GEMINI & TUTOR)
   ═══════════════════════════════════════════════════════════════ */
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
    try { a = lerPlain(); } catch (e) { console.warn('banco .json ileg\u00edvel:', e.message); }
    try { b = lerGz(); } catch (e) { console.warn('banco .json.gz ileg\u00edvel:', e.message); }
    const data = b.length > a.length ? b : a;
    if (Array.isArray(data) && data.length) { _bankBase = data.length; return (_bankCache = data); }
  } catch (err) {
    console.error('Erro ao ler o banco de quest\u00f5es:', err.message);
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
  // Primeira chamada: carrega s\u00edncrono (fallback), mas agenda recarga ass\u00edncrona
  try {
    const lerPlain = () => (fs.existsSync(QUESTIONS_BANK_FILE) ? JSON.parse(fs.readFileSync(QUESTIONS_BANK_FILE, 'utf8')) : []);
    const lerGz = () => (fs.existsSync(QUESTIONS_BANK_GZ) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(QUESTIONS_BANK_GZ)).toString('utf8')) : []);
    let a = [], b = [];
    try { a = lerPlain(); } catch (e) { console.warn('banco .json ileg\u00edvel:', e.message); }
    try { b = lerGz(); } catch (e) { console.warn('banco .json.gz ileg\u00edvel:', e.message); }
    const data = b.length > a.length ? b : a;
    if (Array.isArray(data) && data.length) { _bankBase = data.length; return (_bankCache = data); }
  } catch (err) {
    console.error('Erro ao ler o banco de quest\u00f5es:', err.message);
  }
  return (_bankCache = []);
}

// Carregamento ass\u00edncrono n\u00e3o-bloqueante do banco (chamado no startup)
async function preloadQuestionsBank() {
  try {
    const lerPlain = () => fs.existsSync(QUESTIONS_BANK_FILE) ? JSON.parse(await fs.promises.readFile(QUESTIONS_BANK_FILE, 'utf8')) : [];
    const lerGz = () => fs.existsSync(QUESTIONS_BANK_GZ) ? JSON.parse(zlib.gunzipSync(await fs.promises.readFile(QUESTIONS_BANK_GZ)).toString('utf8')) : [];
    const [a, b] = await Promise.all([lerPlain().catch(() => []), lerGz().catch(() => [])]);
    const data = b.length > a.length ? b : a;
    if (Array.isArray(data) && data.length) {
      _bankCache = data;
      _bankBase = data.length;
      console.log(`\uD83D\uDCDA Banco de quest\u00f5es pr\u00e9-carregado: ${data.length} quest\u00f5es`);
    }
  } catch (err) {
    console.warn('Pr\u00e9-carregamento do banco falhou (carregar\u00e1 sob demanda):', err.message);
  }
}

// Inicia pr\u00e9-carregamento em background (n\u00e3o bloqueia o servidor)
preloadQuestionsBank();"""

if old in content:
    content = content.replace(old, new)
    with open('C:/Users/alexl/Downloads/Compressed/cuscuzi/server.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: Added async preload for questions bank")
else:
    print("OLD STRING NOT FOUND")