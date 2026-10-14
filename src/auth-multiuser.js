// Multi-user Authentication System with scrypt password hashing
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Configurações de segurança
const SCRYPT_N = 16384; // CPU/memory cost
const SCRYPT_R = 8;     // Block size
const SCRYPT_P = 1;     // Parallelization
const SCRYPT_KEYLEN = 64;
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // 30 dias

// Carrega usuários do disco
let usersDb = new Map();
let sessionsDb = new Map();

function loadUsersDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf8');
      const arr = JSON.parse(raw);
      usersDb = new Map(arr.map(u => [u.username, u]));
      console.log(`👥 ${usersDb.size} usuários carregados.`);
    }
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
      const arr = JSON.parse(raw);
      const now = Date.now();
      sessionsDb = new Map(arr
        .filter(s => s.expiresAt > now)
        .map(s => [s.token, s]));
      console.log(`🔑 ${sessionsDb.size} sessões válidas carregadas.`);
    }
  } catch (e) {
    console.warn('⚠️ Falha ao carregar users/sessions:', e.message);
  }
}

function saveUsersDb() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify([...usersDb.values()], null, 2), 'utf8');
  } catch (e) {
    console.warn('⚠️ Falha ao salvar users:', e.message);
  }
}

function saveSessionsDb() {
  try {
    const now = Date.now();
    const valid = [...sessionsDb.entries()].filter(([, s]) => s.expiresAt > now);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(valid.map(([, s]) => s), null, 2), 'utf8');
  } catch (e) {
    console.warn('⚠️ Falha ao salvar sessions:', e.message);
  }
}

// Hash de senha com scrypt (async nativo do Node)
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve({
        hash: derivedKey.toString('hex'),
        salt: salt.toString('hex')
      });
    });
  });
}

function verifyPassword(password, hash, salt) {
  return new Promise((resolve, reject) => {
    const saltBuf = Buffer.from(salt, 'hex');
    crypto.scrypt(password, saltBuf, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derivedKey));
    });
  });
}

// Gera token de sessão
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Cria sessão
function createSession(username) {
  const token = generateToken();
  const now = Date.now();
  const session = {
    token,
    username,
    createdAt: now,
    expiresAt: now + TOKEN_TTL_MS
  };
  sessionsDb.set(token, session);
  saveSessionsDb();
  return token;
}

// Valida sessão
function validateSession(token) {
  if (!token) return null;
  const session = sessionsDb.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessionsDb.delete(token);
    saveSessionsDb();
    return null;
  }
  // Renova expiração (sliding window)
  session.expiresAt = Date.now() + TOKEN_TTL_MS;
  saveSessionsDb();
  return session;
}

// Deleta sessão (logout)
function deleteSession(token) {
  sessionsDb.delete(token);
  saveSessionsDb();
}

// Middleware de autenticação para rotas /api/*
function authMiddleware(req, res, next) {
  // Rotas públicas (req.path é relativo ao mount point /api)
  if (req.path === '/health' || 
      req.path === '/auth/login' || 
      req.path === '/auth/signup' ||
      req.path === '/auth/check-username') {
    return next();
  }

  // Rotas de mídia aceitam token na query string (req.path é relativo a /api)
  if (/^\/drive\/(stream|pdf)\//.test(req.path)) {
    const token = req.query.t;
    if (token) {
      const session = validateSession(token);
      if (session) {
        req.user = session;
        return next();
      }
    }
  }

  // Header Authorization: Bearer <token>
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  
  const session = validateSession(token);
  if (!session) {
    return res.status(401).json({ success: false, msg: 'Sessão expirada ou inválida. Faça login novamente.' });
  }
  
  req.user = session;
  next();
}

// Rotas de autenticação
export function registerAuthRoutes(app) {
  // Verifica se username está disponível
  app.get('/api/auth/check-username', (req, res) => {
    const username = String(req.query.username || '').trim().toLowerCase();
    if (!username || username.length < 3) {
      return res.json({ available: false, reason: 'Mínimo 3 caracteres' });
    }
    if (!/^[a-z0-9_-]+$/.test(username)) {
      return res.json({ available: false, reason: 'Apenas letras, números, _ e -' });
    }
    const exists = usersDb.has(username);
    res.json({ available: !exists, reason: exists ? 'Usuário já existe' : null });
  });

  // Sign Up - Criar conta
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const displayName = String(req.body?.displayName || '').trim();

      if (!username || username.length < 3) {
        return res.status(400).json({ ok: false, msg: 'Usuário deve ter pelo menos 3 caracteres' });
      }
      if (!/^[a-z0-9_-]+$/.test(username)) {
        return res.status(400).json({ ok: false, msg: 'Usuário: apenas letras, números, _ e -' });
      }
      if (usersDb.has(username)) {
        return res.status(409).json({ ok: false, msg: 'Este usuário já existe' });
      }
      if (!password || password.length < 6) {
        return res.status(400).json({ ok: false, msg: 'Senha deve ter pelo menos 6 caracteres' });
      }
      if (password.length > 128) {
        return res.status(400).json({ ok: false, msg: 'Senha muito longa' });
      }

      const { hash, salt } = await hashPassword(password);
      const user = {
        username,
        displayName: displayName || username,
        passwordHash: hash,
        passwordSalt: salt,
        createdAt: Date.now(),
        lastLoginAt: null,
        settings: {
          theme: 'dark',
          notifications: true
        }
      };
      usersDb.set(username, user);
      saveUsersDb();

      const token = createSession(username);
      res.json({ ok: true, token, user: { username, displayName: user.displayName } });
    } catch (err) {
      console.error('[Auth] Erro no signup:', err);
      res.status(500).json({ ok: false, msg: 'Erro interno ao criar conta' });
    }
  });

  // Login
  app.post('/api/auth/login', async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim().toLowerCase();
      const password = String(req.body?.password || '');

      if (!username || !password) {
        return res.status(400).json({ ok: false, msg: 'Informe usuário e senha' });
      }

      const user = usersDb.get(username);
      if (!user) {
        return res.status(401).json({ ok: false, msg: 'Usuário ou senha incorretos' });
      }

      const valid = await verifyPassword(password, user.passwordHash, user.passwordSalt);
      if (!valid) {
        return res.status(401).json({ ok: false, msg: 'Usuário ou senha incorretos' });
      }

      user.lastLoginAt = Date.now();
      usersDb.set(username, user);
      saveUsersDb();

      const token = createSession(username);
      res.json({ ok: true, token, user: { username, displayName: user.displayName } });
    } catch (err) {
      console.error('[Auth] Erro no login:', err);
      res.status(500).json({ ok: false, msg: 'Erro interno no login' });
    }
  });

  // Logout
  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token) deleteSession(token);
    res.json({ ok: true });
  });

  // Info do usuário logado
  app.get('/api/auth/me', authMiddleware, (req, res) => {
    const user = usersDb.get(req.user.username);
    if (!user) {
      return res.status(404).json({ ok: false, msg: 'Usuário não encontrado' });
    }
    res.json({
      ok: true,
      user: {
        username: user.username,
        displayName: user.displayName,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        settings: user.settings
      }
    });
  });

  // Atualiza configurações do usuário
  app.patch('/api/auth/me', authMiddleware, (req, res) => {
    const user = usersDb.get(req.user.username);
    if (!user) return res.status(404).json({ ok: false, msg: 'Usuário não encontrado' });
    
    const { displayName, settings } = req.body || {};
    if (displayName && displayName.trim()) user.displayName = displayName.trim().slice(0, 50);
    if (settings && typeof settings === 'object') user.settings = { ...user.settings, ...settings };
    
    usersDb.set(req.user.username, user);
    saveUsersDb();
    
    res.json({ ok: true, user: { username: user.username, displayName: user.displayName, settings: user.settings } });
  });

  // Alterar senha
  app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
    try {
      const user = usersDb.get(req.user.username);
      if (!user) return res.status(404).json({ ok: false, msg: 'Usuário não encontrado' });

      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.newPassword || '');

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ ok: false, msg: 'Informe senha atual e nova senha' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ ok: false, msg: 'Nova senha deve ter pelo menos 6 caracteres' });
      }

      const valid = await verifyPassword(currentPassword, user.passwordHash, user.passwordSalt);
      if (!valid) {
        return res.status(401).json({ ok: false, msg: 'Senha atual incorreta' });
      }

      const { hash, salt } = await hashPassword(newPassword);
      user.passwordHash = hash;
      user.passwordSalt = salt;
      usersDb.set(req.user.username, user);
      saveUsersDb();

      // Invalida todas as outras sessões deste usuário (exceto a atual)
      const currentToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
      for (const [token, session] of sessionsDb.entries()) {
        if (session.username === req.user.username && token !== currentToken) {
          sessionsDb.delete(token);
        }
      }
      saveSessionsDb();

      res.json({ ok: true, msg: 'Senha alterada com sucesso. Outras sessões foram encerradas.' });
    } catch (err) {
      console.error('[Auth] Erro ao alterar senha:', err);
      res.status(500).json({ ok: false, msg: 'Erro interno' });
    }
  });
}

// Inicializa DB na carga do módulo
loadUsersDb();

// Exporta funções para uso em outras rotas
export function getUserDataDir(username) {
  const safe = String(username || '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'user';
  const dir = path.join(DATA_DIR, 'users', safe);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getUserFilePath(username, filename) {
  return path.join(getUserDataDir(username), filename);
}

export { authMiddleware, validateSession, createSession, usersDb, sessionsDb };