with open('C:/Users/alexl/Downloads/Compressed/cuscuzi/server.js', 'r', encoding='utf-8') as f:
    content = f.read()

old = """/* ═══ AUTENTICAÇÃO DA API ═══
   Todas as rotas /api/* (menos /api/health e /api/auth/login) exigem token.
   O token é assinado (HMAC) com a APP_PASSWORD, vale 30 dias e sobrevive a reinícios. */
app.set('trust proxy', 1);
// Tolerante a erro de colagem no painel do Render: tira espaços/quebras de linha e aspas das pontas
const APP_PASSWORD = String(process.env.APP_PASSWORD || '').trim().replace(/^(['"])([\\s\\S]*)\\1$/, '$2').trim();
if (APP_PASSWORD) console.log('🔐 APP_PASSWORD recebida (' + APP_PASSWORD.length + ' caracteres).');
const AUTH_SECRET = crypto.createHash('sha256').update('cuscuz-auth|' + APP_PASSWORD).digest();
const AUTH_TTL_MS = 30 * 24 * 3600 * 1000;
const IS_HOSTED = !!(process.env.RENDER || process.env.NODE_ENV === 'production');
if (!APP_PASSWORD) {
  console.warn(IS_HOSTED
    ? '⛔ APP_PASSWORD não definida: a API está BLOQUEADA até você definir essa variável no Render.'
    : '⚠️ APP_PASSWORD não definida: API aberta (modo local de desenvolvimento).');
}
function signToken() {
  const exp = String(Date.now() + AUTH_TTL_MS);
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(exp).digest('hex');
  return exp + '.' + sig;
}
function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  const good = crypto.createHmac('sha256', AUTH_SECRET).update(exp).digest('hex');
  const a = Buffer.from(sig), b = Buffer.from(good);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const loginAttempts = new Map(); // ip -> { n, reset }
app.post('/api/auth/login', (req, res) => {
  if (!APP_PASSWORD) {
    return IS_HOSTED
      ? res.status(503).json({ ok: false, msg: 'APP_PASSWORD não chegou ao servidor. No Render: Environment → Add Environment Variable → APP_PASSWORD → Save and deploy.' })
      : res.json({ ok: true, token: signToken() });
  }
  const now = Date.now();
  const rec = loginAttempts.get(req.ip) || { n: 0, reset: now + 15 * 60 * 1000 };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + 15 * 60 * 1000; }
  if (rec.n >= 10) return res.status(429).json({ ok: false, msg: 'Muitas tentativas. Aguarde 15 minutos.' });
  const given = crypto.createHash('sha256').update(String((req.body && req.body.password) || '').trim()).digest();
  const real = crypto.createHash('sha256').update(APP_PASSWORD).digest();
  if (!crypto.timingSafeEqual(given, real)) {
    rec.n++; loginAttempts.set(req.ip, rec);
    return res.status(401).json({ ok: false, msg: 'Senha incorreta.' });
  }
  loginAttempts.delete(req.ip);
  res.json({ ok: true, token: signToken() });
});
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/auth/login') return next();
  if (!APP_PASSWORD) {
    if (IS_HOSTED) return res.status(503).json({ success: false, msg: 'APP_PASSWORD não configurada no servidor.' });
    return next();
  }
  const h = req.headers.authorization || '';
  if (verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '')) return next();
  // <video>/<iframe> não enviam cabeçalho: nas rotas de mídia aceita o token em ?t=
  if (/^\\/drive\\/(stream|pdf)\\//.test(req.path) && verifyToken(String(req.query.t || ''))) return next();
  res.status(401).json({ success: false, msg: 'Não autorizado. Faça login novamente.' });
});

/* ═══ ARQUIVOS ESTÁTICOS: nunca expor código, dados internos ou segredos ═══ */"""

new = """/* ═══ AUTENTICAÇÃO MULTI-USUÁRIO (scrypt + sessões) ═══ */
app.set('trust proxy', 1);

// Registra rotas de auth (signup, login, logout, me, change-password)
registerAuthRoutes(app);

// Middleware de autenticação para todas as rotas /api/*
app.use('/api', authMiddleware);

/* ═══ ARQUIVOS ESTÁTICOS: nunca expor código, dados internos ou segredos ═══ */"""

if old in content:
    content = content.replace(old, new)
    with open('C:/Users/alexl/Downloads/Compressed/cuscuzi/server.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: Replaced auth section")
else:
    print("OLD STRING NOT FOUND")
    # Find where it differs
    idx = content.find("/* ═══ AUTENTICAÇÃO DA API ═══")
    if idx != -1:
        print(f"Found at {idx}")
        print(repr(content[idx:idx+200]))