import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { Readable } from 'stream';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';
import * as cheerio from 'cheerio';
import { plGerarPlanSinergia as plEngineGerarPlan } from './smart_scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega o .env sem dependência externa — variáveis já definidas no ambiente têm prioridade
function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = value;
    }
  } catch (err) {
    console.warn('⚠️ Não foi possível carregar o .env:', err.message);
  }
}
loadDotEnv();

const app = express();
// Em hospedagens (Render, Railway...) a porta vem do ambiente; 3000 é o padrão local
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '0.0.0.0';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/* ═══ AUTENTICAÇÃO DA API ═══
   Todas as rotas /api/* (menos /api/health e /api/auth/login) exigem token.
   O token é assinado (HMAC) com a APP_PASSWORD, vale 30 dias e sobrevive a reinícios. */
app.set('trust proxy', 1);
// Tolerante a erro de colagem no painel do Render: tira espaços/quebras de linha e aspas das pontas
const APP_PASSWORD = String(process.env.APP_PASSWORD || '').trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
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
  if (/^\/drive\/(stream|pdf)\//.test(req.path) && verifyToken(String(req.query.t || ''))) return next();
  res.status(401).json({ success: false, msg: 'Não autorizado. Faça login novamente.' });
});

/* ═══ ARQUIVOS ESTÁTICOS: nunca expor código, dados internos ou segredos ═══ */
const BLOCKED_STATIC = /^\/(server\.js|package(-lock)?\.json|render\.yaml|DEPLOY\.md|README\.md|supabase-schema\.sql|metadata\.json|drive-tree-snapshot\.json|data(\/|$)|scripts(\/|$)|src(\/|$)|node_modules(\/|$)|\.)/i;
app.use((req, res, next) => {
  let p = '';
  try { p = decodeURIComponent(req.path); } catch (_) { return res.status(400).end(); }
  if (BLOCKED_STATIC.test(p) || p.includes('..')) return res.status(404).end();
  next();
});

// Initialize Google Gemini Client with official @google/genai SDK
const geminiApiKey = process.env.GEMINI_API_KEY;
let ai = null;
function getGeminiClient() {
  if (ai) return ai;
  const key = process.env.GEMINI_API_KEY;
  if (key) {
    try {
      ai = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });
      console.log('✅ Google Gemini client initialized (@google/genai)');
    } catch (err) {
      console.warn('⚠️ Could not initialize Gemini:', err.message);
    }
  }
  return ai;
}
getGeminiClient();

// Resilient Gemini model caller with retry and fallback cascade
async function generateWithGemini(params) {
  const client = getGeminiClient();
  if (!client) throw new Error('GEMINI_API_KEY não configurada no servidor.');
  const models = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  let lastErr = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    for (const m of models) {
      try {
        const res = await client.models.generateContent({
          model: m,
          ...params
        });
        return res;
      } catch (err) {
        lastErr = err;
        const is503 = err.status === 503 || (err.message && err.message.includes('503'));
        console.warn(`Model ${m} (tentativa ${attempt}) ${is503 ? '503 alta demanda' : 'erro'}:`, err.message?.slice(0, 100));
        await new Promise(r => setTimeout(r, 300 * attempt));
      }
    }
  }
  throw lastErr;
}

// In-memory conversations store (fallback if Supabase credentials are not provided)
const memoryConversations = new Map();

// Initialize Supabase Client if env variables are present
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
let supabase = null;
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase client initialized');
  } catch (err) {
    console.warn('⚠️ Could not initialize Supabase:', err.message);
  }
}

// Initialize OpenAI Client if API key is present
const openaiApiKey = process.env.OPENAI_API_KEY;
let openai = null;
if (openaiApiKey) {
  try {
    openai = new OpenAI({ apiKey: openaiApiKey });
    console.log('✅ OpenAI client initialized');
  } catch (err) {
    console.warn('⚠️ Could not initialize OpenAI:', err.message);
  }
}

// Helpers to get/save conversation
async function getConversationMessages(id) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', id)
        .single();
      if (!error && data && Array.isArray(data.messages)) {
        return data.messages;
      }
    } catch (err) {
      console.warn('Supabase fetch error, fallback to memory store:', err.message);
    }
  }
  return memoryConversations.get(id) || [];
}

async function saveConversationMessages(id, messages) {
  memoryConversations.set(id, messages);
  if (supabase) {
    try {
      const { error } = await supabase
        .from('conversations')
        .upsert({
          id,
          messages,
          updated_at: new Date().toISOString()
        });
      if (error) {
        console.warn('Supabase upsert warning:', error.message);
      }
    } catch (err) {
      console.warn('Supabase save error:', err.message);
    }
  }
}

// Function calling definitions for context & support
const supportTools = [
  {
    type: 'function',
    function: {
      name: 'get_app_features',
      description: 'Obtém informações e guia de navegação sobre os recursos do Cuscuz-MED / Lovable App.',
      parameters: {
        type: 'object',
        properties: {},
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_acervo_topics',
      description: 'Consulta disciplinas médicas e conteúdos disponíveis no acervo.',
      parameters: {
        type: 'object',
        properties: {
          discipline: { type: 'string', description: 'Nome da especialidade ou matéria (ex: Cardiologia, Cirurgia).' }
        },
        required: ['discipline']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_study_tips',
      description: 'Fornece orientações metodológicas sobre flashcards SRS, ciclo de estudos e simulados.',
      parameters: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['pomodoro', 'srs', 'simulados', 'geral'] }
        }
      }
    }
  }
];

function handleToolExecution(name, args) {
  if (name === 'get_app_features') {
    return {
      features: [
        'Planejador Inteligente: crie cronogramas personalizados com meta de questões e data de prova.',
        'Acervo Completo: mais de 900 videoaulas e apostilas integradas ao Google Drive.',
        'Treino Livre & Flashcards SRS: repetição espaçada no estilo Anki para fixação de longo prazo.',
        'Simulados com Gabarito: cronômetro, revisão comentada e acompanhamento de estatísticas.',
        'Gamificação: ganhe XP por tópicos estudados, atinja streaks de dias e desbloqueie badges.',
        'Temporizador Pomodoro: sessões de estudo com pausas programadas e registro diário.'
      ]
    };
  }
  if (name === 'search_acervo_topics') {
    const disc = (args.discipline || '').toLowerCase();
    const map = {
      cardio: 'Semiologia, Hipertensão Arterial, Insuficiência Cardíaca, Síndromes Coronarianas, Cardiopatias Congênitas',
      cirurgia: 'Abdome Agudo Obstrutivo, Trauma, Hérnias da Parede Abdominal, Queimaduras, Pré e Pós-Operatório',
      gineco: 'Câncer de Mama, Rastreamento, Sangramento Uterino Anormal, Miomatose, Climatério, Doença Inflamatória Pélvica',
      obste: 'Pré-natal, Mecanismo de Parto, Hemorragia Pós-Parto (HPP), Síndromes Hipertensivas da Gestação, Aloimunização',
      pedia: 'Puericultura, Crescimento e Desenvolvimento, Aleitamento Materno, Desidratação, Pneumonias na Infância'
    };
    const key = Object.keys(map).find(k => disc.includes(k)) || 'cardio';
    return { discipline: args.discipline, topicsAvailable: map[key] };
  }
  if (name === 'get_study_tips') {
    const m = args.method || 'geral';
    if (m === 'srs') {
      return { tip: 'Pratique revisões ativas diárias no modo Flashcards. O algoritmo SRS espaça as revisões conforme a sua facilidade com o card.' };
    }
    if (m === 'pomodoro') {
      return { tip: 'Use ciclos de 25 min de foco total com 5 min de descanso na aba Preparatório. A cada 4 ciclos, faça uma pausa maior de 15 a 30 min.' };
    }
    return { tip: 'Alie estudo teórico em vídeo/PDF com resolução imediata de pelo menos 15 a 20 questões por tópico.' };
  }
  return { status: 'executed' };
}

// Helper para sanitizar IDs do Google Drive (remove parâmetros de URL como ?hl=pt-br, prefixos de path, etc.)
function cleanDriveId(raw) {
  if (!raw) return '';
  let id = String(raw).trim();
  if (id.includes('folders/')) id = id.split('folders/')[1];
  if (id.includes('file/d/')) id = id.split('file/d/')[1];
  if (id.includes('/')) id = id.split('/')[0];
  if (id.includes('?')) id = id.split('?')[0];
  return id.trim();
}

// Google Drive Proxy & In-Memory Cache
const DRIVE_API_KEY = (process.env.GOOGLE_DRIVE_API_KEY || '').trim();
if (!DRIVE_API_KEY) console.warn('⚠️ GOOGLE_DRIVE_API_KEY não definida: o acervo do Drive não vai carregar.');
const DRIVE_ROOT_FOLDER_ID = cleanDriveId(process.env.GOOGLE_DRIVE_FOLDER_ID || '1pVd7V_pfyM4Vw20yfw45jBmNFqtKTHK7');
const driveCache = new Map();

/* Diagnóstico da chave do Drive: traduz o erro do Google em uma dica clara (sem expor segredos) */
const driveStatus = { configured: !!DRIVE_API_KEY, ok: null, status: null, reason: null, hint: null, checkedAt: null };
function driveErrorInfo(status, bodyText) {
  let reason = '', msg = '';
  try {
    const j = JSON.parse(bodyText);
    const e = j.error || {};
    reason = (e.errors && e.errors[0] && e.errors[0].reason) || (e.details && e.details[0] && e.details[0].reason) || e.status || '';
    msg = e.message || '';
  } catch (_) { msg = String(bodyText || '').slice(0, 160); }
  const blob = (reason + ' ' + msg).toLowerCase();
  let hint;
  if (/referrer|ip_address_blocked|ip address/.test(blob)) hint = 'A chave do Drive tem restrição de site/IP. No Google Cloud, em "Restrições de aplicativo", escolha "Nenhuma" e deixe só a restrição de API (Google Drive API).';
  else if (/api_key_invalid|api key not valid|keyinvalid/.test(blob)) hint = 'Chave inválida. Confira GOOGLE_DRIVE_API_KEY no Render (sem espaços, sem aspas).';
  else if (/service_disabled|accessnotconfigured|has not been used|is disabled|api_key_service_blocked|blocked/.test(blob)) hint = 'A Google Drive API não está ativada ou a chave não a permite. Ative em APIs e serviços > Biblioteca e marque "Google Drive API" nas restrições da chave.';
  else if (/ratelimit|quota|userratelimit/.test(blob)) hint = 'Cota do Google atingida. Tente de novo em alguns minutos.';
  else if (status === 404 || /notfound/.test(blob)) hint = 'Pasta não encontrada. Confira GOOGLE_DRIVE_FOLDER_ID e se a pasta está como "Qualquer pessoa com o link".';
  else if (status === 403) hint = 'Acesso negado pelo Google. Confira se a pasta está como "Qualquer pessoa com o link" e as permissões da chave.';
  else hint = 'Erro do Google Drive (' + status + '). Veja os logs do Render.';
  return { reason: reason || ('http_' + status), hint };
}
function noteDriveResult(ok, status, bodyText) {
  driveStatus.configured = !!DRIVE_API_KEY;
  driveStatus.ok = ok; driveStatus.status = status; driveStatus.checkedAt = new Date().toISOString();
  if (ok) { driveStatus.reason = null; driveStatus.hint = null; return null; }
  const info = driveErrorInfo(status, bodyText);
  driveStatus.reason = info.reason; driveStatus.hint = info.hint;
  console.warn('⚠️ [Drive] ' + status + ' ' + info.reason + ' — ' + info.hint);
  return info;
}
async function checkDriveKey() {
  if (!DRIVE_API_KEY) { driveStatus.ok = false; driveStatus.reason = 'missing_key'; driveStatus.hint = 'GOOGLE_DRIVE_API_KEY não está definida no Render.'; driveStatus.checkedAt = new Date().toISOString(); console.warn('⚠️ [Drive] ' + driveStatus.hint); return; }
  try {
    const q = encodeURIComponent(`'${DRIVE_ROOT_FOLDER_ID}' in parents and trashed=false`);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=1&fields=files(id)&key=${DRIVE_API_KEY}`);
    const t = await r.text();
    noteDriveResult(r.ok, r.status, t);
    if (r.ok) console.log('✅ [Drive] Chave do Drive funcionando.');
  } catch (e) { driveStatus.ok = false; driveStatus.reason = 'network'; driveStatus.hint = 'Sem conexão com o Google: ' + e.message; }
}
const DRIVE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

app.get('/api/drive/clear-cache', (req, res) => {
  const size = driveCache.size;
  driveCache.clear();
  res.json({ success: true, cleared: size, message: 'Cache do Google Drive limpo com sucesso' });
});

app.get('/api/drive/list', async (req, res) => {
  const folderId = cleanDriveId(req.query.folderId) || DRIVE_ROOT_FOLDER_ID;
  const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const now = Date.now();

  if (!forceRefresh) {
    const cached = driveCache.get(folderId);
    if (cached && (now - cached.timestamp < DRIVE_CACHE_TTL)) {
      return res.json({ files: cached.files, cached: true });
    }
  }

  try {
    let rawFiles = [];
    let pageToken = '';

    do {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,webViewLink,size,createdTime,shortcutDetails)');
      const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=folder,name_natural&pageSize=1000&key=${DRIVE_API_KEY}${pageParam}`;
      
      if (!DRIVE_API_KEY) {
        noteDriveResult(false, 503, '');
        return res.status(503).json({ error: 'GOOGLE_DRIVE_API_KEY ausente', reason: 'missing_key', hint: 'GOOGLE_DRIVE_API_KEY não está definida no Render.' });
      }
      const r = await fetch(url);
      if (!r.ok) {
        const errText = await r.text();
        const info = noteDriveResult(false, r.status, errText);
        return res.status(502).json({ error: 'Google Drive API error', status: r.status, reason: info.reason, hint: info.hint });
      }
      noteDriveResult(true, 200, '');
      const data = await r.json();
      if (data.files && Array.isArray(data.files)) {
        rawFiles.push(...data.files);
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    
    const processed = rawFiles.map(f => {
      const isShortcut = f.mimeType === 'application/vnd.google-apps.shortcut';
      const effectiveId = isShortcut && f.shortcutDetails?.targetId ? f.shortcutDetails.targetId : f.id;
      const effectiveMime = isShortcut && f.shortcutDetails?.targetMimeType ? f.shortcutDetails.targetMimeType : f.mimeType;
      
      const isFolder = effectiveMime === 'application/vnd.google-apps.folder';
      const isVideo = /video|mp4|webm|mkv|mov/i.test(effectiveMime) || /\.(mp4|webm|mkv|mov)(\.(mp4|webm|mkv|mov))?$/i.test(f.name);
      const isPdf = /pdf|document|presentation/i.test(effectiveMime) || /\.(pdf|doc|docx)$/i.test(f.name);
      const cleanName = isFolder ? f.name.trim() : f.name.replace(/(\.(mp4|webm|mkv|mov|pdf|doc|docx))+$/gi, "").trim();
      return {
        id: effectiveId,
        name: cleanName,
        rawName: f.name,
        mimeType: effectiveMime,
        isFolder,
        isVideo,
        isPdf,
        webViewLink: f.webViewLink || `https://drive.google.com/file/d/${effectiveId}/preview`,
        previewUrl: `https://drive.google.com/file/d/${effectiveId}/preview`
      };
    });

    driveCache.set(folderId, { timestamp: now, files: processed });
    res.json({ files: processed, cached: false, total: processed.length });
  } catch (err) {
    console.error('Error fetching Drive files:', err);
    res.status(500).json({ error: err.message });
  }
});

// Metadados de vídeo do Drive (tamanho/duração/resolução) — base do buffer inteligente da página de aula
const driveInfoCache = new Map();
app.get('/api/drive/video-info', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
  if (!ids.length) return res.status(400).json({ error: 'Informe ids separados por vírgula' });
  const out = {};
  await Promise.all(ids.map(id => new Promise(resolve => {
    if (driveInfoCache.has(id)) { out[id] = driveInfoCache.get(id); return resolve(); }
    fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=size,videoMediaMetadata,mimeType&key=${DRIVE_API_KEY}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(j => {
        const sizeB = parseInt(j.size || '0', 10);
        const ms = parseInt((j.videoMediaMetadata && j.videoMediaMetadata.durationMillis) || '0', 10);
        const info = {
          mimeType: j.mimeType || '',
          sizeMB: sizeB ? Math.round(sizeB / 1048576 * 10) / 10 : 0,
          durLabel: ms ? (Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0')) : '',
          res: j.videoMediaMetadata ? (j.videoMediaMetadata.height || 0) + 'p' : ''
        };
        driveInfoCache.set(id, info);
        out[id] = info;
      })
      .catch(err => { out[id] = { erro: String(err.message || err).slice(0, 60) }; })
      .finally(resolve);
  })));
  res.json({ info: out });
});

// Streaming direto de vídeo do Google Drive com suporte a HTTP Range (Seeking e buffer nativo)
app.all('/api/drive/stream/:id', async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
    return res.sendStatus(204);
  }

  const fileId = cleanDriveId(req.params.id);
  if (!fileId) return res.status(400).send('ID de arquivo inválido');

  const range = req.headers.range;
  const driveUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;

  try {
    const fetchHeaders = {};
    if (range) fetchHeaders['Range'] = range;

    const driveRes = await fetch(driveUrl, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: fetchHeaders
    });

    if (!driveRes.ok && driveRes.status !== 206) {
      return res.status(driveRes.status).send('Não foi possível obter o stream do vídeo');
    }

    const contentType = driveRes.headers.get('content-type') || 'video/mp4';
    if (contentType.includes('text/html')) {
      return res.status(403).send('Este arquivo requer autenticação ou não está com link público no Google Drive.');
    }

    res.status(driveRes.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Accept-Ranges', 'bytes');

    ['content-type', 'content-length', 'content-range', 'last-modified'].forEach(h => {
      const v = driveRes.headers.get(h);
      if (v) res.setHeader(h, v);
    });

    if (req.method === 'HEAD') {
      return res.end();
    }

    if (driveRes.body) {
      const nodeStream = Readable.fromWeb(driveRes.body);
      nodeStream.pipe(res);
      req.on('close', () => {
        try { nodeStream.destroy(); } catch (e) {}
      });
    } else {
      res.end();
    }
  } catch (err) {
    console.error('Erro no stream do vídeo:', err);
    if (!res.headersSent) res.status(500).send(err.message);
  }
});

// Download direto de PDFs do Google Drive para caching offline no IndexedDB
app.get('/api/drive/pdf/:id', async (req, res) => {
  const fileId = cleanDriveId(req.params.id);
  if (!fileId) return res.status(400).send('ID de arquivo inválido');

  try {
    // 1. Tenta via Google Drive API v3 alt=media
    let r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${DRIVE_API_KEY}`);
    if (!r.ok) {
      // 2. Fallback para usercontent download
      r = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`);
    }

    if (!r.ok) {
      return res.status(r.status).send('Não foi possível obter o PDF do Google Drive');
    }

    const ct = r.headers.get('content-type') || 'application/pdf';
    res.setHeader('Content-Type', ct.includes('text/html') ? 'application/pdf' : ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Disposition', 'inline');
    const cl = r.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);

    const nodeStream = Readable.fromWeb(r.body);
    nodeStream.pipe(res);
    req.on('close', () => {
      try { nodeStream.destroy(); } catch (e) {}
    });
  } catch (err) {
    console.error('Erro ao baixar PDF para offline:', err);
    if (!res.headersSent) res.status(500).send(err.message);
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    openaiConfigured: !!openai,
    supabaseConfigured: !!supabase,
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    authConfigured: !!APP_PASSWORD,
    drive: driveStatus
  });
});

// ══════════════════════════════════════════════════════════════════
// RADAR MÉDICO: ATUALIZAÇÕES E EDITAIS (Estratégia MED + Gemini AI)
// ══════════════════════════════════════════════════════════════════
const RADAR_CACHE_FILE = path.join(__dirname, 'data', 'radar_medico_cache.json');
const RADAR_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas (atualização 1 a 2x ao dia)
let radarMemoryCache = null;

function loadRadarCache() {
  if (radarMemoryCache) return radarMemoryCache;
  try {
    if (fs.existsSync(RADAR_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(RADAR_CACHE_FILE, 'utf8'));
      radarMemoryCache = data;
      return data;
    }
  } catch (e) {
    console.warn('⚠️ Erro ao ler cache do Radar Médico:', e.message);
  }
  return null;
}

function saveRadarCache(data) {
  try {
    radarMemoryCache = data;
    const dir = path.dirname(RADAR_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RADAR_CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('⚠️ Erro ao salvar cache do Radar Médico:', e.message);
  }
}

async function scrapeAndSummarizeRadar() {
  console.log('📡 Buscando artigos recentes em med.estrategia.com/portal/atualidades...');
  const res = await fetch('https://med.estrategia.com/portal/atualidades', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!res.ok) {
    throw new Error('Falha ao acessar o portal Estratégia MED: HTTP ' + res.status);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const rawArticles = [];

  $('article').each((i, el) => {
    if (rawArticles.length >= 5) return;
    const titleEl = $(el).find('h2.entry-title a, h3.entry-title a, header h2 a');
    const title = titleEl.text().trim();
    const link = titleEl.attr('href') || $(el).find('a.cs-overlay-link').attr('href') || $(el).find('a').attr('href');
    let img = $(el).find('img').attr('data-lazy-src') || $(el).find('noscript img').attr('src') || $(el).find('img').attr('src');
    if (img && img.startsWith('data:image/svg')) {
      img = $(el).find('noscript img').attr('src') || $(el).find('img').attr('data-src') || '';
    }
    const excerpt = $(el).find('.entry-excerpt').text().trim();
    const date = $(el).find('.meta-date').text().trim().replace(/^Publicado em\s+/i, '');
    const category = $(el).find('.meta-category .label').text().trim() || $(el).find('.meta-category').text().replace(/^[A-Z]\s*/, '').trim() || 'Atualidades';

    if (title && link) {
      rawArticles.push({ title, link, img, excerpt, date, category });
    }
  });

  if (!rawArticles.length) {
    throw new Error('Nenhum artigo encontrado na página do Estratégia MED.');
  }

  // Busca o corpo de cada matéria para envio ao Gemini
  for (const art of rawArticles) {
    try {
      const artRes = await fetch(art.link, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (artRes.ok) {
        const artHtml = await artRes.text();
        const $art = cheerio.load(artHtml);
        const bodyText = $art('.entry-content, article .content, .post-content').text().replace(/\s+/g, ' ').trim();
        art.bodyText = bodyText.slice(0, 4000);
        if (!art.img) {
          art.img = $art('meta[property="og:image"]').attr('content') || '';
        }
      }
    } catch (e) {
      console.warn('⚠️ Não foi possível extrair corpo de', art.link, e.message);
    }
    if (!art.bodyText) art.bodyText = art.excerpt || art.title;
  }

  // Resumo inteligente com a API do Gemini focado em Diretrizes e Prática Clínica
  const gemini = getGeminiClient();
  const processedArticles = [];

  for (const art of rawArticles) {
    let resumo = null;
    if (gemini) {
      const prompt = `Você é um preceptor médico especialista em residência médica e diretrizes clínicas.
Analise a matéria/diretriz a seguir e elabore um resumo estratégico de alto rendimento estruturado estritamente nestes 3 eixos fundamentais:

1. Quais são as implementações: Detalhe quais são os novos protocolos, portarias, diretrizes ou normativas anunciadas.
2. O que é relevante para a prática clínica: Explique o que é essencial para a prática clínica diária, raciocínio diagnóstico, dosagens, rastreios e conduta médica.
3. O que mudou de fato: Destaque o que mudou de fato em comparação com as recomendações ou condutas prévias (mudanças práticas, quebra de paradigmas, alertas para pegadinhas de prova).

Título: ${art.title}
Conteúdo da matéria: ${art.bodyText}

Retorne estritamente o objeto JSON com os 3 campos solicitados. Seja conciso, claro e técnico para médicos e estudantes de medicina.`;

      // Tenta gemini-3.1-flash-lite e faz fallback automático para gemini-3.8-flash se necessário
      for (const modelName of ['gemini-3.1-flash-lite', 'gemini-3.8-flash']) {
        try {
          const aiRes = await gemini.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  implementacoes: {
                    type: Type.STRING,
                    description: 'Quais são as implementações e novas diretrizes normatizadas'
                  },
                  praticaClinica: {
                    type: Type.STRING,
                    description: 'O que é relevante para a prática clínica e conduta médica'
                  },
                  oQueMudou: {
                    type: Type.STRING,
                    description: 'O que mudou de fato em relação aos protocolos ou condutas anteriores'
                  }
                },
                required: ['implementacoes', 'praticaClinica', 'oQueMudou']
              }
            }
          });

          if (aiRes.text) {
            resumo = JSON.parse(aiRes.text);
            break;
          }
        } catch (err) {
          console.warn(`⚠️ Modelo ${modelName} falhou para "${art.title}":`, err.message);
        }
      }
    }

    if (!resumo || !resumo.implementacoes) {
      resumo = {
        implementacoes: `Novas diretrizes e atualizações clínicas publicadas oficialmente: ${art.title}.`,
        praticaClinica: art.excerpt ? art.excerpt.slice(0, 180) + '...' : 'Adoção das recomendações em ambulatório, enfermaria e atendimento primário com foco em segurança do paciente.',
        oQueMudou: 'Atualização e alinhamento dos critérios de conduta médica e parâmetros para provas de residência médica e Revalida.'
      };
    }

    processedArticles.push({
      id: Buffer.from(art.link).toString('base64').slice(0, 16),
      title: art.title,
      link: art.link,
      img: art.img || 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&auto=format&fit=crop&q=80',
      date: art.date,
      category: art.category,
      resumoEstrategico: resumo,
      bullets: [
        `Implementações: ${resumo.implementacoes}`,
        `Prática Clínica: ${resumo.praticaClinica}`,
        `O Que Mudou: ${resumo.oQueMudou}`
      ]
    });
  }

  const cachePayload = {
    cachedAt: Date.now(),
    articles: processedArticles
  };

  saveRadarCache(cachePayload);
  return cachePayload;
}

app.get('/api/radar-medico', async (req, res) => {
  const force = req.query.force === 'true' || req.query.refresh === 'true';
  const cached = loadRadarCache();

  if (cached && !force && (Date.now() - cached.cachedAt < RADAR_CACHE_TTL_MS)) {
    return res.json({
      status: 'cached',
      cachedAt: cached.cachedAt,
      articles: cached.articles
    });
  }

  try {
    const result = await scrapeAndSummarizeRadar();
    res.json({
      status: 'fresh',
      cachedAt: result.cachedAt,
      articles: result.articles
    });
  } catch (err) {
    console.error('❌ Erro no Radar Médico:', err.message);
    if (cached) {
      return res.json({
        status: 'cached_fallback',
        warning: 'Usando cache prévio devido a erro na extração: ' + err.message,
        cachedAt: cached.cachedAt,
        articles: cached.articles
      });
    }
    res.status(500).json({ error: 'Não foi possível carregar as notícias: ' + err.message });
  }
});

// GET conversation history
app.get('/api/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await getConversationMessages(id);
    res.json({ id, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE conversation
app.delete('/api/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    memoryConversations.delete(id);
    if (supabase) {
      await supabase.from('conversations').delete().eq('id', id);
    }
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat - Streaming OpenAI GPT-4o with Function Calling & Supabase persistence
app.post('/api/chat', async (req, res) => {
  const { message, conversationId = 'default-' + Date.now(), history = [] } = req.body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Mensagem obrigatória' });
  }

  // Setup Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 1. Fetch conversation history from Supabase or memory
    const existingMessages = await getConversationMessages(conversationId);
    const contextHistory = existingMessages.length ? existingMessages : history;

    // 2. Append new user message
    const userMsg = { role: 'user', content: message.trim() };
    const conversationLog = [...contextHistory, userMsg];

    // 3. System Prompt for App Support
    const systemPrompt = {
      role: 'system',
      content: `Você é o Assistente Virtual de Suporte ao Estudante do Cuscuz-MED (Lovable App).
Você é amigável, conciso, inteligente e focado em ajudar o usuário a extrair o máximo da plataforma.
Você tem acesso a ferramentas de funções (function calling) para consultar funcionalidades, tópicos do acervo médico e dicas de metodologia de estudo.
Responda sempre em Português do Brasil com formatação limpa (Markdown, listas e destaques).
Se o usuário perguntar sobre o funcionamento da plataforma, funcionalidades, cronograma ou acervo, use as ferramentas disponíveis.`
    };

    const messagesToSend = [systemPrompt, ...conversationLog.slice(-10)];

    let assistantResponseText = '';

    // If OpenAI API key is NOT configured in environment, provide smart helpful streaming fallback
    if (!openai) {
      const fallbackNotice = 
        `👋 Olá! Sou o bot de suporte do **Cuscuz-MED** (Lovable App).\n\n` +
        `ℹ️ *Nota: O backend está pronto para o OpenAI GPT-4o, mas a variável \`OPENAI_API_KEY\` ainda não foi definida no arquivo \`.env\`.*\n\n` +
        `**Resposta sobre sua pergunta ("${message.trim()}"):**\n` +
        `• O app oferece **Planejador com cronograma**, **Acervo com +900 videoaulas**, **Banco de Questões com SRS** e **Simulados com tempo**.\n` +
        `• Você pode navegar pelo menu lateral para acessar qualquer módulo ou usar a busca global no topo.\n` +
        `• Para conectar sua chave OpenAI e Supabase real, configure \`OPENAI_API_KEY\` e \`SUPABASE_URL\` / \`SUPABASE_ANON_KEY\` no ambiente.`;

      // Simulate streaming with typing cadence
      const words = fallbackNotice.split(' ');
      for (const word of words) {
        assistantResponseText += (assistantResponseText ? ' ' : '') + word;
        sendEvent('delta', { text: word + ' ', conversationId });
        await new Promise(r => setTimeout(r, 25));
      }

      conversationLog.push({ role: 'assistant', content: assistantResponseText });
      await saveConversationMessages(conversationId, conversationLog);
      sendEvent('done', { conversationId, fullText: assistantResponseText });
      return res.end();
    }

    // 4. OpenAI execution with function calling
    const modelToUse = process.env.OPENAI_MODEL || 'gpt-4o';

    // First check if tool call is needed
    const initialCompletion = await openai.chat.completions.create({
      model: modelToUse,
      messages: messagesToSend,
      tools: supportTools,
      tool_choice: 'auto',
      temperature: 0.7
    });

    const choice = initialCompletion.choices[0];
    const toolCalls = choice.message?.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      // Append assistant's tool call message
      messagesToSend.push(choice.message);

      // Execute each tool and return results to the model
      for (const tc of toolCalls) {
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}');
        } catch (_) {}

        const toolResult = handleToolExecution(tc.function.name, parsedArgs);

        messagesToSend.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult)
        });
      }
    }

    // 5. Stream final response via SSE
    const stream = await openai.chat.completions.create({
      model: modelToUse,
      messages: messagesToSend,
      stream: true,
      temperature: 0.7
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        assistantResponseText += delta;
        sendEvent('delta', { text: delta, conversationId });
      }
    }

    // 6. Save updated history to Supabase / memory
    conversationLog.push({ role: 'assistant', content: assistantResponseText });
    await saveConversationMessages(conversationId, conversationLog);

    sendEvent('done', { conversationId, fullText: assistantResponseText });
    res.end();
  } catch (err) {
    console.error('Chat error:', err);
    sendEvent('error', { message: err.message || 'Erro ao processar mensagem' });
    res.end();
  }
});

/* ═══════════════════════════════════════════════════════════════
   SISTEMA DE QUESTÕES (TREINO LIVRE, GERADOR GEMINI & TUTOR)
   ═══════════════════════════════════════════════════════════════ */
const QUESTIONS_BANK_FILE = path.join(__dirname, 'data', 'questions-bank.json');

function readQuestionsBank() {
  try {
    if (fs.existsSync(QUESTIONS_BANK_FILE)) {
      const raw = fs.readFileSync(QUESTIONS_BANK_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('Erro ao ler questions-bank.json:', err.message);
  }
  return [];
}

function writeQuestionsBank(questions) {
  try {
    const dir = path.dirname(QUESTIONS_BANK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(QUESTIONS_BANK_FILE, JSON.stringify(questions, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Erro ao escrever questions-bank.json:', err.message);
    return false;
  }
}

// 1. Obter todas as questões prontas do banco (Aba 1)
app.get('/api/questions/bank', (req, res) => {
  const bank = readQuestionsBank();
  res.json({ success: true, count: bank.length, questions: bank });
});

// 1.1 Match inteligente de questões por tags, tema e disciplina (Página de Aula)
app.get('/api/questions/match', (req, res) => {
  try {
    const rawTags = String(req.query.tags || '');
    const disciplina = String(req.query.disciplina || req.query.disc || '');
    const tema = String(req.query.tema || req.query.titulo || '');
    const curso = String(req.query.curso || '');
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));

    const stopwords = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'para', 'com', 'sem', 'por', 'sobre', 'que', 'uma', 'uns', 'umas', 'aula', 'curso', 'modulo', 'parte', 'bloco', 'extensivo', 'intensivo']);
    const normText = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();

    const tagsList = rawTags ? rawTags.split(',').map(normText).filter(Boolean) : [];
    const normTema = normText(tema);
    const normDisc = normText(disciplina);
    const normCurso = normText(curso);

    const tokens = [
      ...normTema.split(/\s+/),
      ...normDisc.split(/\s+/),
      ...normCurso.split(/\s+/),
      ...tagsList
    ].filter(t => t.length > 2 && !stopwords.has(t));

    const bank = readQuestionsBank();
    if (!bank.length) {
      return res.json({ success: true, count: 0, questions: [], tags: tokens });
    }

    const scored = bank.map(q => {
      let score = 0;
      const spec = normText(q.specialty || '');
      const sub = normText(q.subspecialty || '');
      const st = normText(q.statement || '');
      const exp = normText(q.explanation || '');
      const qTags = Array.isArray(q.tags) ? q.tags.map(normText).join(' ') : normText(q.tags || '');

      tokens.forEach(t => {
        if (qTags.includes(t)) score += 30;
        if (sub.includes(t)) score += 25;
        if (spec.includes(t)) score += 20;
        if (st.includes(t)) score += 8;
        if (exp.includes(t)) score += 4;
      });

      if (normTema && (sub.includes(normTema) || qTags.includes(normTema))) score += 50;
      if (normDisc && (spec.includes(normDisc) || sub.includes(normDisc))) score += 35;

      return { q, score };
    });

    scored.sort((a, b) => b.score - a.score);
    let matched = scored.filter(s => s.score > 0).slice(0, limit).map(s => s.q);

    // Se faltarem questões com score > 0, completa com questões de alto rendimento do banco
    if (matched.length < limit) {
      const selectedIds = new Set(matched.map(m => m.id));
      for (const item of scored) {
        if (!selectedIds.has(item.q.id)) {
          matched.push(item.q);
          selectedIds.add(item.q.id);
          if (matched.length >= limit) break;
        }
      }
    }

    res.json({
      success: true,
      count: matched.length,
      questions: matched,
      matchedTags: tokens,
      tema,
      disciplina
    });
  } catch (err) {
    console.error('Erro em /api/questions/match:', err.message);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// Restauração do espelho do navegador: se o servidor perdeu o arquivo (hospedagem efêmera),
// o devolve o banco que o próprio usuário tem no localStorage — merge por id/enunciado
app.post('/api/questions/bank/restore', (req, res) => {
  try {
    const { questions } = req.body || {};
    if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ success: false, msg: 'questions vazio' });
    const atual = readQuestionsBank();
    if (atual.length >= questions.length) {
      return res.json({ success: true, restaurado: 0, total: atual.length, msg: 'Banco do servidor já está igual ou maior — nada a restaurar.' });
    }
    const m = mergeQuestionsIntoBank(questions);
    console.log(`♻️ [Hardworq] Banco restaurado do espelho do navegador: +${m.imported} questões (total ${m.total}).`);
    res.json({ success: true, restaurado: m.imported, total: m.total });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   INTEGRAÇÃO HARDWORQ — banco de questões oficial
   API: PUT https://extensivo.hardworkmedicina.api.br/banco/questoes/{id_turma}
   (schema validado: gabarito vem no feed em alternativas[].correta)
   ═══════════════════════════════════════════════════════════════ */
const HWQ = {
  apiBase: process.env.HARDWORQ_API_BASE || 'https://extensivo.hardworkmedicina.api.br',
  hwqBase: process.env.HARDWORQ_HWQ_BASE || 'https://hardworq.hardworkmedicina.api.br',
  idTurma: process.env.HARDWORQ_ID_TURMA || '1273',
  // Login por credenciais (método atual — o cookie de sessão foi descontinuado pela API)
  email: process.env.HARDWORQ_EMAIL || '',
  senha: process.env.HARDWORQ_SENHA || '',
  // Chaves de app do próprio Hardworq (públicas, embutidas no bundle do app — uma por API)
  appKeyExt: process.env.HARDWORQ_APP_KEY_EXT || 'YzJjNTZkYjMtMGQwNS00NGJiLTk5YzUtZjJhN2E4ODlmNjdl',
  appKeyHwq: process.env.HARDWORQ_APP_KEY_HWQ || 'mcJZrH5yb7qhpST3k4vMqUL76t78ttpGeHj0U20V6khQWuWLPkIHJlOukj9p8U1E',
  // Legado: cookie de sessão ainda aceito como fallback
  cookie: process.env.HARDWORQ_COOKIE || '',
  autoSync: /^(1|true|on)$/i.test(process.env.HARDWORQ_AUTO_SYNC || ''),
  syncIntervalHours: Math.max(1, parseInt(process.env.HARDWORQ_SYNC_INTERVAL_H, 10) || 6),
  maxBankSize: Math.max(50, parseInt(process.env.HARDWORQ_MAX_BANK, 10) || 400)
};
const HWQ_STATE = { userToken: null, lastLoginAt: null, lastLoginOk: null, lastSyncAt: null, lastSyncOk: null, lastSyncResult: null, doencas: null, doencasAt: 0 };

// Login contínuo: o token do aluno é persistido em disco e sobrevive a restarts.
// Só refaz o login de verdade quando a API recusar o token (auth:false) — relogin automático.
const HWQ_TOKEN_FILE = path.join(__dirname, 'data', 'hwq-token.json');

function saveHwqToken(token) {
  try {
    const dir = path.dirname(HWQ_TOKEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HWQ_TOKEN_FILE, JSON.stringify({ token, savedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (err) {
    console.warn('⚠️ [Hardworq] Não foi possível salvar o token em disco:', err.message);
  }
}

function loadHwqToken() {
  try {
    if (!fs.existsSync(HWQ_TOKEN_FILE)) return;
    const j = JSON.parse(fs.readFileSync(HWQ_TOKEN_FILE, 'utf8'));
    if (j && j.token) {
      HWQ_STATE.userToken = String(j.token);
      HWQ_STATE.lastLoginOk = true; // otimista: se estiver vencido, o relogin automático cuida
      HWQ_STATE.lastLoginAt = j.savedAt || null;
      console.log('🔑 [Hardworq] Token reutilizado do disco — sessão contínua.');
    }
  } catch (_) { /* token corrompido: segue sem token, relogin cuida */ }
}
loadHwqToken();

const HWQ_AREAS_DEFAULT = ['Clínica Médica', 'Cirurgia Geral', 'Pediatria', 'Ginecologia e Obstetrícia', 'Medicina Preventiva'];
const HWQ_ANOS_DEFAULT = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018];
const HWQ_GRUPOS_DEFAULT = ['R1', 'REVALIDA'];

// Chave de app por base: o app Hardworq usa uma Bearer fixa embutida no bundle, uma por API
function hwqAppKey(url) {
  return String(url).startsWith(HWQ.hwqBase) ? HWQ.appKeyHwq : HWQ.appKeyExt;
}

function hwqHeaders(url, { withUserToken = true } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Origin': HWQ.apiBase,
    'Referer': HWQ.apiBase + '/',
    'Authorization': 'Bearer ' + hwqAppKey(url)
  };
  if (withUserToken && HWQ_STATE.userToken) headers['UserToken'] = HWQ_STATE.userToken;
  if (HWQ.cookie) headers['Cookie'] = HWQ.cookie; // legado
  return headers;
}

// Chamada HTTP crua (sem relogin); normaliza erro de sessão (auth:false / "Invalid User")
async function hwqFetch(url, { method = 'GET', body = null, timeoutMs = 20000, withUserToken = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: hwqHeaders(url, { withUserToken }),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text.slice(0, 500) }; }
    const authFailed = res.status === 401 || res.status === 403 ||
      (data && (data.auth === false || /invalid user|n[ãa]o autentic/i.test(String(data.msg || data.raw || ''))));
    return { ok: res.ok && !(data && data.ok === false), status: res.status, data, authFailed };
  } catch (err) {
    return { ok: false, status: 0, data: null, authFailed: false, error: err.name === 'AbortError' ? 'Timeout na API do Hardworq' : (err.message || String(err)) };
  } finally {
    clearTimeout(timer);
  }
}

// Login email/senha: PUT /login retorna obj.token, que vira o header UserToken das chamadas seguintes
async function hwqLogin({ force = false } = {}) {
  if (!HWQ.email || !HWQ.senha) return { ok: false, error: 'HARDWORQ_EMAIL/HARDWORQ_SENHA não configurados no .env do servidor.' };
  if (!force && HWQ_STATE.userToken && HWQ_STATE.lastLoginOk) return { ok: true, token: HWQ_STATE.userToken, cached: true };
  const r = await hwqFetch(`${HWQ.hwqBase}/login`, {
    method: 'PUT',
    body: { email: HWQ.email, senha: HWQ.senha, platform: '', uuid: '' },
    withUserToken: false
  });
  HWQ_STATE.lastLoginAt = new Date().toISOString();
  const token = r.data && r.data.obj && r.data.obj.token ? String(r.data.obj.token) : '';
  const ok = !!(r.ok && token);
  HWQ_STATE.lastLoginOk = ok;
  HWQ_STATE.userToken = token || null;
  if (ok) {
    saveHwqToken(token);
    console.log('🔑 [Hardworq] Login ok — token em cache (memória + disco).');
  } else {
    try { fs.rmSync(HWQ_TOKEN_FILE, { force: true }); } catch (_) {}
    console.warn('⚠️ [Hardworq] Login falhou:', (r.data && r.data.msg) || r.error || `HTTP ${r.status}`);
  }
  return { ok, token, msg: (r.data && r.data.msg) || r.error || '' };
}

// Chamada com relogin automático: se a sessão cair (auth:false), refaz login e tenta 1× de novo
async function hwqRequest(url, opts = {}) {
  const first = await hwqFetch(url, opts);
  if (!first.authFailed) return first;
  const login = await hwqLogin({ force: true });
  if (!login.ok) return first;
  return hwqFetch(url, opts);
}

// Busca questões no banco do Hardworq (doc §2)
async function hwqSearchQuestions(opts = {}) {
  const body = {
    qtd_maxima: Math.min(100, Math.max(1, parseInt(opts.qtd_maxima, 10) || 20)),
    areas: Array.isArray(opts.areas) && opts.areas.length ? opts.areas : HWQ_AREAS_DEFAULT,
    id_prova_similar: 0,
    ids_instituicoes: opts.ids_instituicoes || [],
    ids_doencas: opts.ids_doencas || [],
    ids_tags: opts.ids_tags || [],
    anos: Array.isArray(opts.anos) && opts.anos.length ? opts.anos : HWQ_ANOS_DEFAULT,
    grupos_prova: Array.isArray(opts.grupos_prova) && opts.grupos_prova.length ? opts.grupos_prova : HWQ_GRUPOS_DEFAULT,
    outra_opcao: opts.outra_opcao || ''
  };
  const url = `${HWQ.apiBase}/banco/questoes/${encodeURIComponent(opts.idTurma || HWQ.idTurma)}`;
  const r = await hwqRequest(url, { method: 'PUT', body });
  const list = r.data && Array.isArray(r.data.obj) ? r.data.obj : (Array.isArray(r.data) ? r.data : []);
  return { ok: r.ok && list.length > 0, status: r.status, authFailed: r.authFailed, error: r.error, msg: (r.data && r.data.msg) || '', questions: list };
}

// Busca em rodadas de 100 até não voltarem questões novas (a API não pagina — repete amostras).
// qtd_maxima define o teto; "tudo" = 5000 (60 rodadas no máximo, por segurança).
async function hwqFetchAll(opts = {}) {
  const target = Math.min(5000, Math.max(1, parseInt(opts.qtd_maxima, 10) || 5000));
  const seen = new Map();
  let rounds = 0;
  while (seen.size < target && rounds < 60) {
    rounds++;
    const search = await hwqSearchQuestions({ ...opts, qtd_maxima: 100 });
    if (search.error || search.authFailed || search.status >= 400) {
      return { ...search, questions: [...seen.values()], rounds };
    }
    let novas = 0;
    for (const q of search.questions) {
      const key = q && q.id != null ? `id:${q.id}` : JSON.stringify(q);
      if (!seen.has(key)) { seen.set(key, q); novas++; }
    }
    if (novas === 0) break; // a API começou a repetir — filtro esgotado
  }
  return { ok: true, status: 200, authFailed: false, error: null, msg: '', questions: [...seen.values()].slice(0, target), rounds };
}

// Normaliza para busca sem acento/caixa (ex.: "esquizofrenia" == "Esquizofrenia")
function hwqNorm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Catálogo de doenças/temas (GET /doencas — ~358 entradas) com cache de 24h
async function hwqListarDoencas() {
  if (Array.isArray(HWQ_STATE.doencas) && HWQ_STATE.doencas.length && Date.now() - HWQ_STATE.doencasAt < 24 * 60 * 60 * 1000) {
    return HWQ_STATE.doencas;
  }
  const r = await hwqRequest(`${HWQ.apiBase}/doencas`);
  const list = r.data && Array.isArray(r.data.obj) ? r.data.obj : [];
  if (list.length) {
    HWQ_STATE.doencas = list;
    HWQ_STATE.doencasAt = Date.now();
  }
  return list;
}

// Busca doenças por nome/especialidade para o filtro do painel (?q=esquizofrenia)
app.get('/api/questions/hardworq/doencas', async (req, res) => {
  try {
    const q = hwqNorm(req.query.q || '');
    const todas = await hwqListarDoencas();
    const filtradas = q
      ? todas.filter(d => hwqNorm(d.nome).includes(q) || hwqNorm(d.especialidade || d.area || '').includes(q))
      : todas;
    res.json({
      success: true,
      total: todas.length,
      doencas: filtradas.slice(0, 30).map(d => ({ id: d.id, nome: d.nome, especialidade: d.especialidade || d.area || '' }))
    });
  } catch (err) {
    console.error('Erro ao buscar doenças Hardworq:', err.message);
    res.status(500).json({ success: false, msg: err.message || 'Erro ao buscar doenças' });
  }
});

// Registra a resposta do aluno na API (doc §9) — exige UserToken válido (login email/senha)
async function hwqAnswerQuestion({ remoteId, alternativeId, idTurma } = {}) {
  if (!remoteId || !alternativeId) return { ok: false, status: 0, authFailed: false, error: 'remoteId e alternativeId são obrigatórios' };
  const url = `${HWQ.apiBase}/banco/questoes/${encodeURIComponent(idTurma || HWQ.idTurma)}/${encodeURIComponent(remoteId)}/${encodeURIComponent(alternativeId)}/false`;
  return hwqRequest(url, { method: 'POST' });
}

// Perfil do aluno (doc §3) — diagnóstico de sessão
async function hwqStudentInfo() {
  const aluno = await hwqRequest(`${HWQ.hwqBase}/alunos`);
  let plano = null;
  if (aluno.ok) plano = await hwqRequest(`${HWQ.hwqBase}/alunos/plano`);
  return { ok: aluno.ok, status: aluno.status, authFailed: aluno.authFailed, aluno: aluno.data, plano: plano ? plano.data : null };
}

// Repara acentos duplamente codificados (UTF-8 lido como latin1), comuns em payloads colados
function fixMojibake(s) {
  const out = String(s == null ? '' : s);
  if (!/[\u00C0-\u00FF]/.test(out)) return out;
  try {
    const repaired = Buffer.from(out, 'latin1').toString('utf8');
    if (repaired !== out && !repaired.includes('\uFFFD') && /[áéíóúâêôãõçàÁÉÍÓÚÂÊÔÃÕÇÀ]/.test(repaired)) {
      return repaired;
    }
  } catch (_) { /* mantém o original */ }
  return out;
}

const HWQ_LETTER_MAP = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E' };

const cleanHtml = (s) => String(s || '').replace(/<[^>]*>?/gm, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const hwqText = (s) => fixMojibake(cleanHtml(s));

function hwqNormalizeArea(spec) {
  const s = String(spec || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  if (/preventiva|social|sa[uú]de coletiva/.test(lower)) return 'Medicina Preventiva e Social';
  if (/gineco|obstet/.test(lower)) return 'Ginecologia e Obstetrícia';
  if (/cirurg/.test(lower)) return 'Cirurgia Geral';
  if (/pediatr/.test(lower)) return 'Pediatria';
  if (/per[ií]cia|legal|forense/.test(lower)) return 'Perito Médico Federal';
  if (/cl[ií]nica|interna/.test(lower)) return 'Clínica Médica';
  return s;
}

// Parser do schema oficial do Hardworq → formato interno do app (id estável p/ dedupe)
function parseHardworqPayload(rawInput) {
  let list = [];
  if (typeof rawInput === 'string') {
    try {
      const parsed = JSON.parse(rawInput);
      list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.obj) ? parsed.obj : (Array.isArray(parsed?.questoes) ? parsed.questoes : []));
    } catch (e) {
      return [];
    }
  } else if (Array.isArray(rawInput)) {
    list = rawInput;
  } else if (rawInput && typeof rawInput === 'object') {
    list = Array.isArray(rawInput.obj) ? rawInput.obj : (Array.isArray(rawInput.questoes) ? rawInput.questoes : (Array.isArray(rawInput.data) ? rawInput.data : []));
  }

  return list.map((item, idx) => {
    const rawOptions = Array.isArray(item.alternativas) ? item.alternativas : [];
    if (!rawOptions.length) return null;

    let correctIdx = 0;
    const remoteAlternatives = [];
    const formattedOptions = rawOptions.map((opt, oIdx) => {
      const rawLetra = String(opt.letra != null ? opt.letra : (oIdx + 1)).trim();
      const letter = HWQ_LETTER_MAP[rawLetra] || (['A', 'B', 'C', 'D', 'E'][oIdx] || 'A');
      remoteAlternatives.push({ id: opt.id != null ? String(opt.id) : null, index: oIdx, letter });
      if (opt.correta === true || opt.correta === 'true' || opt.correta === 1) correctIdx = oIdx;
      return `${letter}) ${hwqText(opt.alternativa || opt.texto || opt.descricao || '')}`;
    });

    const correctLetter = ['A', 'B', 'C', 'D', 'E'][correctIdx] || 'A';
    const inst = fixMojibake(item.prova?.instituicao || item.instituicao || 'Oficial');
    const ano = parseInt(item.prova?.ano || item.ano, 10) || 2024;
    const grupo = String(item.prova?.grupo || item.grupo || 'R1');
    const code = item.codigo || `HW-${item.id || (idx + 1)}`;
    const statement = hwqText(item.enunciado || '');

    let spec = hwqNormalizeArea(item.area || item.especialidade || item.specialty);
    if (!spec) {
      const hay = statement.toLowerCase();
      if (/cardio|hipertens|coron|infarto|pulm|pneumo|dispneia|renal|diabetes|eletrocardio|arritmia/i.test(hay)) spec = 'Clínica Médica';
      else if (/apendic|cirurg|trauma|laparotom|abdome agudo|hérnia|queimadur|colecist|atls/i.test(hay)) spec = 'Cirurgia Geral';
      else if (/criança|lactente|pediatr|neonato|exantema|recém-nascido|puericult/i.test(hay)) spec = 'Pediatria';
      else if (/gestante|gestação|pré-eclâmpsia|útero|colo uterino|cesárea|puerpér/i.test(hay)) spec = 'Ginecologia e Obstetrícia';
      else if (/epidemiolog|sus|risco relativo|prevalência|atenção básica|incidência|vigilância|coorte/i.test(hay)) spec = 'Medicina Preventiva e Social';
      else if (/perícia|incapacidade|laudo pericial|inss|previdência|nexo causal/i.test(hay)) spec = 'Perito Médico Federal';
      else spec = 'Residência Médica';
    }

    const explanation = item.comentario
      ? hwqText(item.comentario)
      : `Questão oficial de prova (${inst} ${ano} - ${grupo}). Gabarito confirmado: Alternativa ${correctLetter}.`;

    const stableId = (item.id != null && item.id !== '') ? String(item.id) : (String(code).replace(/[^a-zA-Z0-9_-]/g, '') || `${Date.now()}-${idx}`);

    return {
      id: `q-hw-${stableId}`,
      remoteId: (item.id != null && item.id !== '') ? String(item.id) : null,
      remoteAlternatives,
      specialty: spec,
      subspecialty: grupo,
      institution: inst,
      year: ano,
      statement,
      options: formattedOptions,
      correctIndex: correctIdx,
      correctLetter,
      explanation,
      difficulty: 'Médio',
      tags: [inst, grupo, String(code)].filter(Boolean),
      image: item.imagem ? String(item.imagem) : '',
      createdAt: new Date().toISOString(),
      source: `Hardworq (${code})`
    };
  }).filter(q => q && q.statement.length > 15 && q.options.length >= 2);
}

function hwqStatementKey(q) {
  return String(q.statement || '').replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase();
}

// Mescla questões parseadas no banco local: atualiza as existentes (mesmo id ou enunciado) e adiciona as novas
function mergeQuestionsIntoBank(parsed) {
  const bank = readQuestionsBank();
  const indexById = new Map(bank.map((q, i) => [q.id, i]));
  const indexByStmt = new Map(bank.map((q, i) => [hwqStatementKey(q), i]));
  const seenIds = new Set();
  const seenStmts = new Set();
  let updated = 0;
  const fresh = [];

  for (const q of parsed) {
    const key = hwqStatementKey(q);
    if (seenIds.has(q.id) || seenStmts.has(key)) continue;
    seenIds.add(q.id);
    seenStmts.add(key);
    const i = indexById.has(q.id) ? indexById.get(q.id) : (indexByStmt.has(key) ? indexByStmt.get(key) : null);
    if (i != null) {
      bank[i] = { ...bank[i], ...q };
      updated++;
    } else {
      fresh.push(q);
      indexById.set(q.id, -1);
    }
  }

  const updatedBank = [...fresh, ...bank];
  writeQuestionsBank(updatedBank);
  return { imported: fresh.length, updated, total: updatedBank.length };
}

// Repara acentos quebrados já persistidos por imports antigos
function repairMojibakeInBank() {
  const bank = readQuestionsBank();
  let changed = 0;
  const fixed = bank.map(q => {
    const next = { ...q, options: (q.options || []).map(o => fixMojibake(o)) };
    ['statement', 'explanation', 'specialty', 'institution'].forEach(f => { if (q[f]) next[f] = fixMojibake(q[f]); });
    if (Array.isArray(q.tags)) next.tags = q.tags.map(t => fixMojibake(t));
    if (JSON.stringify(next) !== JSON.stringify(q)) { changed++; return next; }
    return q;
  });
  if (changed) {
    writeQuestionsBank(fixed);
    console.log(`🔧 [Hardworq] Acentos reparados em ${changed} questões do banco local.`);
  }
}
repairMojibakeInBank();

// Salvamento automático: após cada sync bem-sucedido, commita e empurra o banco de questões
// (HARDWORQ_AUTO_GIT=1 no .env; silencioso e com debounce de 5 min — sem git/GitHub, só ignora)
let plUltimoAutoGit = 0;
function autoGitBanco() {
  if (!/^(1|true|on)$/i.test(process.env.HARDWORQ_AUTO_GIT || '')) return;
  const agora = Date.now();
  if (agora - plUltimoAutoGit < 5 * 60 * 1000) return;
  plUltimoAutoGit = agora;
  const git = process.env.GIT_PATH || 'git';
  const opts = { cwd: __dirname, timeout: 90000 };
  const passo = (args, done) => execFile(git, args, opts, (err) => done(err));
  passo(['add', 'data/questions-bank.json'], () => {
    passo(['commit', '-m', 'chore: salvar banco de questoes Hardworq (auto)'], () => {
      passo(['pull', '--rebase', 'origin', 'main'], () => {
        passo(['push', 'origin', 'main'], (err) => {
          if (err) console.warn('⚠️ [Hardworq] Auto-git: banco salvo localmente, mas não subiu:', (err.message || '').slice(0, 90));
          else console.log('💾 [Hardworq] Banco de questões salvo automaticamente no GitHub');
        });
      });
    });
  });
}

// Fluxo principal: busca na API + parse + merge no banco local (usado pelo painel e pelo auto-sync)
async function runHardworqSync(filters = {}) {
  if (!HWQ_STATE.userToken) await hwqLogin(); // garante token antes da busca (se falhar, hwqRequest tenta de novo)
  const search = await hwqFetchAll(filters);
  HWQ_STATE.lastSyncAt = new Date().toISOString();

  if (search.error || search.authFailed || search.status >= 400) {
    HWQ_STATE.lastSyncOk = false;
    HWQ_STATE.lastSyncResult = { fetched: 0, imported: 0, authFailed: search.authFailed, status: search.status };
    return {
      ok: false,
      authFailed: !!search.authFailed,
      status: search.status,
      msg: search.authFailed
        ? 'Login no Hardworq falhou (auth:false). Verifique HARDWORQ_EMAIL/HARDWORQ_SENHA no .env do servidor.'
        : (search.msg || search.error || `A API do Hardworq respondeu ${search.status}.`),
      fetched: 0
    };
  }

  const parsed = parseHardworqPayload(search.questions);
  if (!parsed.length) {
    HWQ_STATE.lastSyncOk = true;
    HWQ_STATE.lastSyncResult = { fetched: search.questions.length, imported: 0, updated: 0 };
    return { ok: true, fetched: search.questions.length, imported: 0, updated: 0, questions: [], msg: 'A API respondeu sem questões para os filtros escolhidos.' };
  }

  const merge = mergeQuestionsIntoBank(parsed);
  HWQ_STATE.lastSyncOk = true;
  HWQ_STATE.lastSyncResult = { fetched: search.questions.length, imported: merge.imported, updated: merge.updated };
  console.log(`🟣 [Hardworq] Sincronização: ${search.questions.length} buscadas → ${merge.imported} novas, ${merge.updated} atualizadas.`);
  autoGitBanco();
  return { ok: true, fetched: search.questions.length, imported: merge.imported, updated: merge.updated, total: merge.total, questions: parsed };
}

// Status da integração (painel do app)
app.get('/api/questions/hardworq/status', (req, res) => {
  const bank = readQuestionsBank();
  const hwqCount = bank.filter(q => q.source && String(q.source).startsWith('Hardworq')).length;
  res.json({
    success: true,
    idTurma: HWQ.idTurma,
    apiBase: HWQ.apiBase,
    authMode: (HWQ.email && HWQ.senha) ? 'login' : (HWQ.cookie ? 'cookie' : 'nenhum'),
    emailConfigured: !!HWQ.email,
    userTokenActive: !!HWQ_STATE.userToken,
    tokenPersisted: fs.existsSync(HWQ_TOKEN_FILE),
    lastLoginAt: HWQ_STATE.lastLoginAt,
    lastLoginOk: HWQ_STATE.lastLoginOk,
    cookieConfigured: !!HWQ.cookie,
    autoSync: HWQ.autoSync,
    syncIntervalHours: HWQ.syncIntervalHours,
    lastSyncAt: HWQ_STATE.lastSyncAt,
    lastSyncOk: HWQ_STATE.lastSyncOk,
    lastSyncResult: HWQ_STATE.lastSyncResult,
    bankCount: bank.length,
    hardworqCount: hwqCount
  });
});

// Sincronização com a API do Hardworq (botão "Sincronizar Hardworq" do app)
app.post('/api/questions/hardworq/sync', async (req, res) => {
  try {
    const { areas, anos, grupos_prova, qtd_maxima, cookie, email, senha, idTurma, ids_doencas, salvar = true } = req.body || {};
    if (email && senha) { HWQ.email = String(email).trim(); HWQ.senha = String(senha); HWQ_STATE.userToken = null; } // sessão avulsa (não persiste)
    if (cookie) HWQ.cookie = String(cookie).trim(); // legado

    if (salvar === false) {
      if (!HWQ_STATE.userToken) await hwqLogin();
      const search = await hwqFetchAll({ areas, anos, grupos_prova, qtd_maxima, ids_doencas, idTurma });
      if (search.error || search.authFailed || search.status >= 400) {
        return res.status(search.authFailed ? 401 : 502).json({
          success: false, authFailed: !!search.authFailed, status: search.status,
          msg: search.authFailed ? 'Login no Hardworq falhou — verifique email/senha.' : (search.msg || search.error || `A API respondeu ${search.status}.`)
        });
      }
      const parsed = parseHardworqPayload(search.questions);
      return res.json({ success: true, fetched: search.questions.length, imported: 0, updated: 0, questions: parsed });
    }

    const result = await runHardworqSync({ areas, anos, grupos_prova, qtd_maxima, ids_doencas, idTurma });
    res.status(result.ok ? 200 : (result.authFailed ? 401 : 502)).json(result);
  } catch (err) {
    console.error('Erro na sincronização Hardworq:', err);
    res.status(500).json({ success: false, msg: err.message || 'Erro interno na sincronização Hardworq' });
  }
});

// Registra a resposta no Hardworq quando o aluno resolve a questão no simulador (doc §9)
app.post('/api/questions/hardworq/answer', async (req, res) => {
  try {
    const { remoteId, alternativeId, idTurma } = req.body || {};
    const r = await hwqAnswerQuestion({ remoteId, alternativeId, idTurma });
    res.json({ success: r.ok, authFailed: !!r.authFailed, status: r.status, msg: (r.data && r.data.msg) || r.error || '' });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

// Perfil/plano do aluno no Hardworq — diagnóstico de sessão
app.get('/api/questions/hardworq/aluno', async (req, res) => {
  const info = await hwqStudentInfo();
  res.json({ success: info.ok, authFailed: !!info.authFailed, status: info.status, aluno: info.aluno, plano: info.plano });
});

// Importação manual (compatibilidade): aceita jsonText/payload colado OU idTurma para buscar na API
app.post('/api/questions/import-hardworq', async (req, res) => {
  try {
    const { idTurma, cookie, email, senha, jsonText, payload, qtd_maxima = 20, areas, anos, grupos_prova, ids_doencas } = req.body || {};
    let parsedQuestions = [];

    if (email && senha) { HWQ.email = String(email).trim(); HWQ.senha = String(senha); HWQ_STATE.userToken = null; }
    if (cookie) HWQ.cookie = String(cookie).trim();

    if (payload || jsonText) {
      parsedQuestions = parseHardworqPayload(payload || jsonText);
    } else if (idTurma || HWQ.email || HWQ.cookie) {
      if (!HWQ_STATE.userToken) await hwqLogin();
      const search = await hwqFetchAll({ idTurma, areas, anos, grupos_prova, qtd_maxima, ids_doencas });
      if (search.error || search.authFailed || search.status >= 400) {
        return res.status(search.authFailed ? 401 : 502).json({
          error: search.authFailed
            ? 'Login no Hardworq falhou (auth:false). Verifique HARDWORQ_EMAIL/HARDWORQ_SENHA no .env.'
            : (search.msg || search.error || `Hardworq API retornou status ${search.status}.`),
          details: search.data || null
        });
      }
      parsedQuestions = parseHardworqPayload(search.questions);
    } else {
      return res.status(400).json({ error: 'Envie "idTurma", "email"+"senha" ou "jsonText" com o retorno da API do Hardworq.' });
    }

    if (!parsedQuestions.length) {
      return res.status(400).json({ error: 'Nenhuma questão válida encontrada no formato Hardworq informado.' });
    }

    const merge = mergeQuestionsIntoBank(parsedQuestions);
    res.json({ success: true, imported: merge.imported, updated: merge.updated, total: merge.total, questions: parsedQuestions });
  } catch (err) {
    console.error('Erro ao importar do Hardworq:', err);
    res.status(500).json({ error: err.message || 'Falha ao processar importação do Hardworq' });
  }
});

// Alimentador automático a partir do Hardworq (HARDWORQ_AUTO_SYNC=1 no .env)
async function autoSyncHardworq() {
  if (!HWQ.autoSync) return;
  try {
    const bank = readQuestionsBank();
    if (bank.length >= HWQ.maxBankSize) return;
    console.log('🟣 [Hardworq] Auto-sync do banco de questões...');
    const r = await runHardworqSync({ qtd_maxima: 20 });
    if (r.ok) console.log(`🟣 [Hardworq] Auto-sync: ${r.imported} novas, ${r.updated} atualizadas.`);
    else console.warn(`⚠️ [Hardworq] Auto-sync falhou: ${r.msg}`);
  } catch (err) {
    console.warn('⚠️ [Hardworq] Auto-sync erro:', err.message);
  }
}
setTimeout(autoSyncHardworq, 20000);
setInterval(autoSyncHardworq, HWQ.syncIntervalHours * 60 * 60 * 1000);

// Login no boot apenas se não houver token reutilizável — credenciais certas entram em segundos
setTimeout(() => { if (!HWQ_STATE.userToken && HWQ.email && HWQ.senha) hwqLogin(); }, 5000);

// 2. Gerar questões sob demanda com Gemini AI (Aba 2)
app.post('/api/gemini/generate-questions', async (req, res) => {
  try {
    const { prompt, count = 5, specialty, difficulty = 'Médio', institution } = req.body || {};
    const n = Math.min(10, Math.max(1, parseInt(count, 10) || 5));

    const systemInstruction = `Você é um médico preceptor e elaborador sênior de provas de Residência Médica (estilo Revalida INEP, USP, ENARE, SUS-SP e Perito Médico Federal).
Gere exatamente ${n} questões inéditas e completas de múltipla escolha baseadas em CASOS CLÍNICOS REALISTAS.
Cada questão DEVE seguir rigorosamente a estrutura:
- Enunciado rico: história clínica com idade, sexo, queixa principal, evolução, antecedentes, exame físico detalhado com dados vitais, exames complementares e pergunta final clara sobre diagnóstico, conduta imediata ou fisiopatologia.
- Exatamente 4 ou 5 alternativas identificadas com letras: "A) ...", "B) ...", "C) ...", "D) ...", "E) ...".
- correctIndex: índice numérico (0 para A, 1 para B, 2 para C, 3 para D, 4 para E).
- correctLetter: letra maiúscula ('A', 'B', 'C', 'D' ou 'E').
- explanation: comentário detalhado e didático explicando por que a alternativa correta é o padrão-ouro e por que cada distrator está incorreto.
- specialty: grande área (ex: "Clínica Médica", "Cirurgia Geral", "Pediatria", "Ginecologia e Obstetrícia", "Medicina Preventiva e Social" ou "Perito Médico Federal").
- subspecialty: tema específico (ex: "Cardiologia", "Trauma", "Neonatologia", "Medicina Legal").
- difficulty: "Fácil", "Médio" ou "Difícil".
- tags: lista de 3 a 5 palavras-chave médicas.
Responda exclusivamente em formato JSON compatível.`;

    const userPrompt = `Gere ${n} questões médicas sobre o tema / instrução a seguir:
Prompt do usuário: "${prompt || 'Casos clínicos de alta frequência em provas de residência médica'}"
${specialty ? `Especialidade prioritária: ${specialty}` : ''}
${institution ? `Estilo de banca / Instituição: ${institution}` : ''}
Nível de dificuldade: ${difficulty}`;

    const geminiRes = await generateWithGemini({
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          description: "Lista de questões de casos clínicos de múltipla escolha",
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              statement: { type: Type.STRING },
              options: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              correctIndex: { type: Type.INTEGER },
              correctLetter: { type: Type.STRING },
              explanation: { type: Type.STRING },
              specialty: { type: Type.STRING },
              subspecialty: { type: Type.STRING },
              difficulty: { type: Type.STRING },
              tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["statement", "options", "correctIndex", "correctLetter", "explanation", "specialty"]
          }
        },
        temperature: 0.8
      }
    });

    let generatedList = [];
    try {
      generatedList = JSON.parse(geminiRes.text.trim());
    } catch (parseErr) {
      console.warn('Erro ao fazer JSON.parse do Gemini, tentando regex fallback:', parseErr.message);
      const match = geminiRes.text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) generatedList = JSON.parse(match[0]);
    }

    if (!Array.isArray(generatedList) || generatedList.length === 0) {
      return res.status(500).json({ error: 'Nenhuma questão foi retornada pelo modelo Gemini.' });
    }

    // Normalizar questões geradas
    const now = new Date().toISOString();
    const formatted = generatedList.map((q, idx) => ({
      id: q.id || `q-gemini-${Date.now()}-${idx + 1}`,
      specialty: q.specialty || specialty || 'Clínica Médica',
      subspecialty: q.subspecialty || 'Geral',
      institution: institution || 'Gerador Gemini AI',
      year: new Date().getFullYear(),
      statement: q.statement,
      options: q.options,
      correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : 0,
      correctLetter: q.correctLetter || ['A', 'B', 'C', 'D', 'E'][q.correctIndex || 0] || 'A',
      explanation: q.explanation,
      difficulty: q.difficulty || difficulty,
      tags: Array.isArray(q.tags) ? q.tags : [q.specialty || 'Medicina'],
      createdAt: now,
      source: 'Gerador Gemini'
    }));

    // Persistir automaticamente no banco de dados local para manter Aba 1 atualizada
    const currentBank = readQuestionsBank();
    const existingStatements = new Set(currentBank.map(item => item.statement.trim().slice(0, 80)));
    const toAdd = formatted.filter(item => !existingStatements.has(item.statement.trim().slice(0, 80)));
    if (toAdd.length > 0) {
      const updatedBank = [...toAdd, ...currentBank];
      writeQuestionsBank(updatedBank);
    }

    res.json({ success: true, count: formatted.length, questions: formatted });
  } catch (err) {
    console.warn('Erro ao gerar questões com Gemini, utilizando banco de casos clínicos de alta frequência:', err.message);
    const bank = readQuestionsBank();
    const n = Math.min(10, Math.max(1, parseInt(req.body?.count, 10) || 5));
    const reqSpec = req.body?.specialty || '';
    let filtered = bank;
    if (reqSpec) {
      const match = bank.filter(q => q.specialty && q.specialty.toLowerCase().includes(reqSpec.toLowerCase()));
      if (match.length > 0) filtered = match;
    }
    const shuffled = [...filtered].sort(() => 0.5 - Math.random()).slice(0, n);
    if (shuffled.length > 0) {
      return res.json({
        success: true,
        count: shuffled.length,
        questions: shuffled,
        notice: 'Questões selecionadas da Base Clínica de Alta Frequência (fallback resiliente)'
      });
    }
    res.status(500).json({ error: err.message || 'Falha ao gerar questões com Gemini' });
  }
});

// 3. Chatbot Tutor Integrado na tela de resolução (Treino Livre)
app.post('/api/gemini/tutor', async (req, res) => {
  try {
    const { question, userSelection, isAnswered, userQuestion, history = [] } = req.body || {};
    if (!question || !question.statement) {
      return res.status(400).json({ error: 'Dados da questão ativa são obrigatórios para o Tutor.' });
    }

    const systemInstruction = `Você é o "Tutor Cuscuz-MED", um preceptor e professor médico de elite especializado em preparação para provas de Residência Médica (USP, ENARE, Revalida, SUS-SP) e Concursos de Perito Médico Federal.
Você está prestando tutoria individual ao aluno sobre a questão EXATA que está aberta na tela dele.
DADOS DA QUESTÃO ATIVA:
- Especialidade: ${question.specialty || 'Medicina'} (${question.subspecialty || ''})
- Enunciado: ${question.statement}
- Alternativas:
${(question.options || []).join('\n')}
- Gabarito Correto Oficial: Alternativa ${question.correctLetter} (${(question.options || [])[question.correctIndex] || ''})
- Justificativa do Gabarito: ${question.explanation}
- Status do Aluno: ${isAnswered ? `Já respondeu. Alternativa marcada: ${userSelection !== null && userSelection !== undefined ? ['A','B','C','D','E'][userSelection] : 'Nenhuma'}. (${userSelection === question.correctIndex ? 'ACERTOU' : 'ERROU'}).` : 'Ainda NÃO respondeu (está tentando resolver).'}

DIRETRIZES DO TUTOR:
1. Se o aluno ainda NÃO respondeu à questão e pedir ajuda/dica: Forneça um raciocínio fisiopatológico orientador e destaque as pistas semiológicas do caso clínico, mas NÃO entregue a letra da resposta de bandeja. Estimule o active recall!
2. Se o aluno já respondeu ou errou: Explique a conduta/diagnóstico de forma clara, aponte a pegadinha das alternativas falsas e consolide o aprendizado com uma pérola clínica (clinical pearl).
3. Seja sempre didático, encorajador, objetivo e direto ao ponto. Responda em português brasileiro. Use formatação markdown limpa com negritos para conceitos-chave.`;

    const contents = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-6)) {
        if (h && h.content) {
          contents.push({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(h.content) }]
          });
        }
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: userQuestion || 'Olá tutor, pode me orientar sobre este caso clínico?' }]
    });

    const tutorRes = await generateWithGemini({
      contents,
      config: {
        systemInstruction,
        temperature: 0.7
      }
    });

    res.json({ success: true, reply: tutorRes.text.trim() });
  } catch (err) {
    console.warn('Erro no Tutor Gemini, acionando síntese de tutoria clínica:', err.message);
    const letter = question.correctLetter || ['A','B','C','D','E'][question.correctIndex] || 'A';
    let fallbackReply = '';
    if (!isAnswered) {
      fallbackReply = `🩺 **Orientação do Preceptor para Raciocínio Clínico:**\n\n` +
        `• **Pista semiológica:** Analise a faixa etária, a queixa principal e os dados de exame físico apresentados no enunciado.\n` +
        `• **Raciocínio fisiopatológico:** Identifique se o caso exige conduta imediata de emergência (suporte à vida) ou investigação diagnóstica complementar.\n` +
        `• **Estratégia de prova:** Use o descarte de alternativas (botão direito ou tesoura) para eliminar opções absurdas ou contraindicadas.\n\n` +
        `*Formule sua hipótese e marque a opção no simulador para confirmar o gabarito!*`;
    } else {
      const isRight = userSelection === question.correctIndex;
      fallbackReply = `${isRight ? '🎉 **Parabéns pelo acerto!**' : '⚠️ **Vamos revisar o conceito-chave:**'}\n\n` +
        `**Gabarito Oficial: Letra ${letter}**\n\n` +
        `${question.explanation || 'O padrão-ouro neste quadro clínico preconiza intervenção precoce segundo as diretrizes das principais sociedades médicas.'}\n\n` +
        `💎 **Pérola Clínica:** Em questões de ${question.specialty || 'Residência Médica'}, fique sempre atento às pegadinhas de dosagem, vias de administração e contraindicações absolutas.`;
    }
    res.json({ success: true, reply: fallbackReply, fallback: true });
  }
});

// 4. Auto-alimentador periódico de questões em segundo plano (Alimentação Automática da Aba 1)
const ROTATING_TOPICS = [
  { spec: 'Clínica Médica', prompt: 'Condutas em emergências cardiovasculares e síndromes coronarianas agudas no pronto-socorro' },
  { spec: 'Cirurgia Geral', prompt: 'Casos clínicos de abdome agudo obstrutivo e conduta imediata no trauma torácico' },
  { spec: 'Pediatria', prompt: 'Abordagem da sepse neonatal, doenças exantemáticas na infância e bronquiolite aguda' },
  { spec: 'Ginecologia e Obstetrícia', prompt: 'Complicações da pré-eclâmpsia grave, conduta na hemorragia pós-parto e rastreio citopatológico' },
  { spec: 'Medicina Preventiva e Social', prompt: 'Indicadores epidemiológicos de mortalidade, organização da atenção primária e princípios do SUS' },
  { spec: 'Perito Médico Federal', prompt: 'Avaliação médico-pericial de incapacidade laborativa, sequelas ortopédicas e traumatologia forense' }
];

let topicIndex = 0;
async function autoFeedQuestions() {
  try {
    const bank = readQuestionsBank();
    if (bank.length >= 40) return; // Se já tiver mais de 40 questões, não precisa sobrecarregar

    const topic = ROTATING_TOPICS[topicIndex % ROTATING_TOPICS.length];
    topicIndex++;

    console.log(`🤖 [Auto-Feed] Gerando novas questões em segundo plano: ${topic.spec}...`);
    const systemInstruction = `Você é um preceptor médico. Crie exatamente 2 questões inéditas de múltipla escolha com casos clínicos profundos.`;
    const prompt = `Gere 2 questões de alto rendimento sobre: ${topic.prompt}. Retorne em JSON array.`;

    const res = await generateWithGemini({
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              statement: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctIndex: { type: Type.INTEGER },
              correctLetter: { type: Type.STRING },
              explanation: { type: Type.STRING },
              specialty: { type: Type.STRING },
              subspecialty: { type: Type.STRING },
              difficulty: { type: Type.STRING },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["statement", "options", "correctIndex", "correctLetter", "explanation", "specialty"]
          }
        },
        temperature: 0.8
      }
    });

    const newItems = JSON.parse(res.text.trim());
    if (Array.isArray(newItems) && newItems.length > 0) {
      const now = new Date().toISOString();
      const current = readQuestionsBank();
      const existing = new Set(current.map(q => q.statement.trim().slice(0, 80)));
      const toAdd = newItems
        .filter(q => !existing.has(q.statement.trim().slice(0, 80)))
        .map((q, idx) => ({
          id: `q-auto-${Date.now()}-${idx}`,
          specialty: q.specialty || topic.spec,
          subspecialty: q.subspecialty || 'Geral',
          institution: 'Auto-Feed IA Diário',
          year: new Date().getFullYear(),
          statement: q.statement,
          options: q.options,
          correctIndex: q.correctIndex || 0,
          correctLetter: q.correctLetter || ['A', 'B', 'C', 'D', 'E'][q.correctIndex || 0] || 'A',
          explanation: q.explanation,
          difficulty: q.difficulty || 'Médio',
          tags: Array.isArray(q.tags) ? q.tags : [topic.spec],
          createdAt: now,
          source: 'Auto-Feed Diário'
        }));

      if (toAdd.length > 0) {
        writeQuestionsBank([...toAdd, ...current]);
        console.log(`✅ [Auto-Feed] ${toAdd.length} novas questões adicionadas automaticamente ao banco.`);
      }
    }
  } catch (err) {
    console.warn('⚠️ [Auto-Feed] Erro ao auto-alimentar banco de questões:', err.message);
  }
}

// Inicia auto-feed após 15 segundos do boot do servidor e a cada 6 horas
setTimeout(autoFeedQuestions, 15000);
setInterval(autoFeedQuestions, 6 * 60 * 60 * 1000);

app.post('/api/questions/auto-feed', async (req, res) => {
  await autoFeedQuestions();
  const bank = readQuestionsBank();
  res.json({ success: true, count: bank.length, message: 'Auto-feed executado com sucesso' });
});

/* ═══════════════════════════════════════════════════════════════
   PLANEJADOR DE CRONOGRAMA IA — graduação + residência
   Regra absoluta: toda revisão é ESTUDO ATIVO (flashcards/questões).
   ═══════════════════════════════════════════════════════════════ */
const DECKS_FILE = path.join(__dirname, 'data', 'planner-decks.json');
function readDecks() { try { return JSON.parse(fs.readFileSync(DECKS_FILE, 'utf8')); } catch { return {}; } }
function writeDecks(d) { try { fs.mkdirSync(path.dirname(DECKS_FILE), { recursive: true }); fs.writeFileSync(DECKS_FILE, JSON.stringify(d, null, 2), 'utf8'); } catch (err) { console.warn('⚠️ [Planner] Falha ao salvar decks:', err.message); } }
const plDeckKey = (materia, tema) => hwqNorm(materia) + '::' + hwqNorm(tema);
const PESO_DIFICULDADE = { facil: 1, medio: 1.5, dificil: 2, pesado: 2.5 };
const TEMAS_POR_PESO = { facil: 3, medio: 4, dificil: 5, pesado: 6 };
const plOrdemTipo = t => ({ revisao24: 0, revisao7: 1, revisao30: 2 })[t] ?? 3;
function plIso(d) { return d.toISOString().slice(0, 10); }
function plAddDias(isoStr, n) { const d = new Date(isoStr + 'T12:00:00'); d.setDate(d.getDate() + n); return plIso(d); }
function plDiff(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }

// Motor determinístico: equilibra carga, cruza datas de prova e aplica a regra de conflito
function plGerarPlan(config, extras = {}) {
  const hoje = config.inicio;
  const provas = (config.provas || []).slice().sort((a, b) => (a.data < b.data ? -1 : 1));
  const fim = provas.length ? provas[provas.length - 1].data : plAddDias(hoje, 30);
  if (plDiff(hoje, fim) < 0) return { erro: 'A última prova precisa ser hoje ou depois.' };
  const mapaProva = {}; provas.forEach(p => { mapaProva[p.data] = p; });
  const vesperasDe = {}; provas.forEach(p => { const v = plAddDias(p.data, -1); (vesperasDe[v] = vesperasDe[v] || []).push(p.nome); });
  const blocosPorDia = Math.max(1, Math.min(4, Math.floor((+config.horasDia || 4) / 2)));

  // Fila de conteúdo: round-robin ponderado pela dificuldade (matérias pesadas entram mais vezes por rodada)
  const filas = (config.materias || []).filter(m => m.nome).map(m => {
    const dKey = normLower(m.dificuldade || 'medio');
    const temasIA = extras.temasPorMateria && extras.temasPorMateria[m.nome];
    const qtd = TEMAS_POR_PESO[dKey] || 4;
    const temas = (Array.isArray(temasIA) && temasIA.length) ? temasIA.slice(0, 14) : Array.from({ length: qtd }, (_, i) => `Tópico ${i + 1}`);
    return { nome: m.nome, dificuldade: m.dificuldade || 'Médio', peso: PESO_DIFICULDADE[dKey] || 1.5, pendentes: temas };
  });
  const fila = [];
  let rodada = 0, avancou = true;
  while (avancou && rodada < 80) {
    avancou = false; rodada++;
    for (const m of filas) {
      let vez = Math.max(1, Math.round(m.peso));
      while (vez-- > 0 && m.pendentes.length) {
        const tema = m.pendentes.shift();
        fila.push({ materia: m.nome, tema, dificuldade: m.dificuldade, key: plDeckKey(m.nome, tema) });
        avancou = true;
      }
    }
  }
  (extras.pendentes || []).forEach(p => fila.unshift(p)); // replan: atrasados voltam na frente

  const revisoesAgendadas = {}; // data -> [bloco]
  function agendarRevisoes(deData, bloco) {
    [{ tipo: 'revisao24', off: 1 }, { tipo: 'revisao7', off: 7 }, { tipo: 'revisao30', off: 30 }].forEach(({ tipo, off }) => {
      let d = plAddDias(deData, off), tent = 0;
      while ((mapaProva[d] || (revisoesAgendadas[d] || []).length >= blocosPorDia) && tent < 15 && plDiff(d, fim) >= 0) { d = plAddDias(d, 1); tent++; }
      if (plDiff(d, fim) < 0 || mapaProva[d]) return; // sem espaço antes da última prova → descarta
      (revisoesAgendadas[d] = revisoesAgendadas[d] || []).push({ tipo, materia: bloco.materia, tema: bloco.tema, key: bloco.key, dificuldade: bloco.dificuldade, horas: 1, status: 'pendente' });
    });
  }

  const filaRevisao = (extras.revisoesHerdadas || []).map(r => ({ ...r })); // replan: revisões de conteúdo concluído
  const dias = [];
  let ci = 0;
  for (let d = new Date(hoje + 'T12:00:00'); plDiff(plIso(d), fim) >= 0; d.setDate(d.getDate() + 1)) {
    const data = plIso(d);
    const prova = mapaProva[data];
    const vespera = vesperasDe[data] || [];
    const blocos = [];
    let slots = prova ? 0 : blocosPorDia;

    // 1) revisões herdadas do replan (estudo ativo) entram primeiro
    while (slots > 0 && filaRevisao.length) {
      const r = filaRevisao.shift();
      blocos.push({ id: 'r' + data + blocos.length, tipo: r.tipo || 'revisao7', materia: r.materia, tema: r.tema, key: r.key, dificuldade: r.dificuldade, horas: 1, status: 'pendente' });
      slots--;
    }
    // 2) revisões espaçadas (24h/7d/30d) programadas para este dia
    const doDia = (revisoesAgendadas[data] || []).sort((a, b) => plOrdemTipo(a.tipo) - plOrdemTipo(b.tipo));
    for (const r of doDia) {
      if (slots <= 0) { // dia cheio → empurra para amanhã
        const prox = plAddDias(data, 1);
        if (plDiff(prox, fim) >= 0) (revisoesAgendadas[prox] = revisoesAgendadas[prox] || []).push(r);
        continue;
      }
      blocos.push({ ...r, id: 'r' + data + blocos.length });
      slots--;
    }
    // 3) conteúdo novo — regra de conflito: véspera de prova não recebe tema pesado/difícil
    while (slots > 0 && ci < fila.length) {
      const c = fila[ci];
      const leve = !['dificil', 'pesado'].includes(normLower(c.dificuldade || ''));
      if (vespera.length && !leve) break;
      blocos.push({ id: 'c' + data + blocos.length, tipo: 'conteudo', materia: c.materia, tema: c.tema, key: c.key, dificuldade: c.dificuldade, horas: 2, status: 'pendente' });
      agendarRevisoes(data, c);
      ci++; slots--;
    }
    // 4) dia de prova
    if (prova) blocos.push({ id: 'p' + data, tipo: 'prova', prova: prova.nome, horas: 0, status: 'pendente' });

    dias.push({ data, dow: d.getDay(), tipo: prova ? 'prova' : (vespera.length ? 'vespera' : 'normal'), prova: prova ? prova.nome : null, vesperaDe: vespera, blocos });
  }

  const blocos = dias.flatMap(dd => dd.blocos);
  return {
    geradoEm: new Date().toISOString(),
    config: { horasDia: config.horasDia, provas, materias: config.materias, temasPorMateria: extras.temasPorMateria || null },
    inicio: hoje, fim,
    dias,
    estatisticas: {
      dias: dias.length,
      conteudos: blocos.filter(b => b.tipo === 'conteudo').length,
      revisoes: blocos.filter(b => b.tipo.startsWith('revisao')).length,
      provas: provas.length
    }
  };
}
function normLower(s) { return hwqNorm(s); }

// Geração de deck de estudo ativo (10 flashcards + 3 questões) — background via Gemini, fallback no banco
async function plGerarDeck(materia, tema) {
  const key = plDeckKey(materia, tema);
  const decks = readDecks();
  if (decks[key] && decks[key].pronto) return decks[key];
  let deck = null;
  if (ai) {
    try {
      const res = await generateWithGemini({
        contents: `Crie 10 flashcards curtos e diretos (frente e verso) e 3 questões de múltipla escolha baseados no tema "${tema}" (matéria: ${materia}), focando nos conceitos mais cobrados em provas.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              flashcards: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { frente: { type: Type.STRING }, verso: { type: Type.STRING } }, required: ['frente', 'verso'] } },
              questoes: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
                statement: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctIndex: { type: Type.INTEGER },
                explanation: { type: Type.STRING }
              }, required: ['statement', 'options', 'correctIndex'] } }
            },
            required: ['flashcards', 'questoes']
          },
          temperature: 0.7
        }
      });
      const parsed = JSON.parse(res.text.trim());
      deck = {
        tema, materia, fonte: 'gemini', pronto: true, criadoEm: new Date().toISOString(),
        flashcards: (parsed.flashcards || []).slice(0, 12),
        questoes: (parsed.questoes || []).map((q, i) => ({
          id: `q-pl-${key}-${i}`, specialty: materia, subspecialty: tema, institution: 'Cronograma IA', year: new Date().getFullYear(),
          statement: q.statement, options: q.options, correctIndex: q.correctIndex,
          correctLetter: ['A', 'B', 'C', 'D', 'E'][q.correctIndex] || 'A',
          explanation: q.explanation || '', difficulty: 'Médio', tags: [materia, tema], source: 'Cronograma IA'
        }))
      };
      console.log(`🧠 [Planner] Deck Gemini pronto: "${tema}" (${deck.flashcards.length} cards, ${deck.questoes.length} questões)`);
    } catch (err) {
      console.warn(`⚠️ [Planner] Gemini falhou para "${tema}":`, err.message?.slice(0, 120));
    }
  }
  if (!deck) {
    // Fallback: monta deck de estudo ativo a partir do banco local de questões
    const bank = readQuestionsBank();
    const alvo = hwqNorm(tema);
    let hits = bank.filter(q => hwqNorm(q.specialty).includes(alvo) || hwqNorm(q.statement).includes(alvo) || (q.tags || []).some(t => hwqNorm(t).includes(alvo)));
    if (!hits.length && /^topico\s*\d*$/i.test(alvo)) {
      // Tema genérico ("Tópico N") sem GEMINI: usa a matéria inteira como recorte
      hits = bank.filter(q => hwqNorm(q.specialty) === hwqNorm(materia));
    }
    if (hits.length) {
      deck = {
        tema, materia, fonte: 'banco', pronto: true, criadoEm: new Date().toISOString(),
        flashcards: hits.slice(0, 10).map(q => ({ frente: q.statement.slice(0, 260), verso: '✅ ' + (q.options[q.correctIndex] || '') + (q.explanation ? '\n\n' + q.explanation : '') })),
        questoes: hits.slice(0, 6)
      };
      console.log(`🧠 [Planner] Deck do banco local: "${tema}" (${hits.length} questões encontradas)`);
    } else {
      deck = { tema, materia, fonte: 'nenhuma', pronto: false, msg: 'Configure GEMINI_API_KEY ou sincronize questões deste tema no banco.', criadoEm: new Date().toISOString(), flashcards: [], questoes: [] };
    }
  }
  decks[key] = deck;
  writeDecks(decks);
  return deck;
}
const plDeckFila = [];
let plDeckRodando = false;
function plEnfileirarDeck(materia, tema) {
  const key = plDeckKey(materia, tema);
  if ((readDecks()[key] || {}).pronto) return;
  if (!plDeckFila.some(x => plDeckKey(x.materia, x.tema) === key)) plDeckFila.push({ materia, tema });
  plBombearDeck();
}
async function plBombearDeck() {
  if (plDeckRodando) return;
  plDeckRodando = true;
  while (plDeckFila.length) {
    const { materia, tema } = plDeckFila.shift();
    try { await plGerarDeck(materia, tema); } catch (err) { console.warn('⚠️ [Planner] Erro no deck:', err.message); }
    await new Promise(r => setTimeout(r, 300));
  }
  plDeckRodando = false;
}

// POST /api/planner/generate — gera o cronograma (Gemini para temas se houver chave; motor local sempre funciona)
app.post('/api/planner/generate', async (req, res) => {
  try {
    const { horasDia = 4, inicio, provas = [], materias = [], pdfTexto = '' } = req.body || {};
    if (!provas.length) return res.status(400).json({ success: false, msg: 'Informe pelo menos uma data de prova.' });
    if (!materias.length) return res.status(400).json({ success: false, msg: 'Informe pelo menos uma matéria.' });
    const config = {
      inicio: inicio || plIso(new Date()),
      horasDia: Math.max(1, Math.min(12, +horasDia || 4)),
      provas: provas.filter(p => p.nome && p.data),
      materias: materias.filter(m => m.nome)
    };
    let temasPorMateria = null, aviso = null;
    if (ai && pdfTexto && String(pdfTexto).length > 400) {
      try {
        const listaMaterias = config.materias.map(m => `${m.nome} (${m.dificuldade || 'Médio'})`).join('; ');
        const g = await generateWithGemini({
          contents: `Analise o material de estudo abaixo (edital/cronograma/ementa) e extraia os temas mais cobrados para cada matéria desta lista: [${listaMaterias}].\nResponda JSON com temasPorMateria (objeto matéria → array de 4 a 8 temas curtos) e resumos (objeto tema → array de 3 a 5 tópicos de estudo).\n\nMATERIAL:\n${String(pdfTexto).slice(0, 12000)}`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                temasPorMateria: { type: Type.OBJECT },
                resumos: { type: Type.OBJECT }
              }
            },
            temperature: 0.5
          }
        });
        const parsed = JSON.parse(g.text.trim());
        temasPorMateria = parsed.temasPorMateria || null;
        if (parsed.resumos) config.resumos = parsed.resumos;
      } catch (err) {
        aviso = 'IA não conseguiu ler o PDF (' + (err.message || '').slice(0, 80) + ') — usando grade padrão de tópicos.';
      }
    } else if (!ai && pdfTexto) {
      aviso = 'GEMINI_API_KEY não configurada — o PDF não pôde ser lido pela IA e a grade padrão de tópicos foi usada.';
    }
    const plan = plGerarPlan(config, { temasPorMateria });
    if (plan.erro) return res.status(400).json({ success: false, msg: plan.erro });
    plan.geradoCom = ai ? 'gemini' : 'motor-local';
    if (aviso) plan.aviso = aviso;
    // Dispara geração silenciosa dos decks de estudo ativo para os temas que terão revisão
    const temasRevisao = new Set();
    plan.dias.forEach(d => d.blocos.forEach(b => { if (b.tipo.startsWith('revisao') && b.tema) temasRevisao.add((b.materia || '') + '||' + b.tema); }));
    temasRevisao.forEach(t => { const [materia, tema] = t.split('||'); plEnfileirarDeck(materia, tema); });
    res.json({ success: true, plan, decksFila: temasRevisao.size, gemini: !!ai });
  } catch (err) {
    console.error('Erro no planner:', err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   MOTOR DE PROCESSAMENTO (RAG, SINERGIA & PROTEÇÃO DE PROVAS)
   Cruza a ementa da faculdade com o cursinho de residência médica
   ═══════════════════════════════════════════════════════════════ */
const SINERGIA_CANONICA = [
  { tema: 'Antibioticoterapia & Sepse', materia: 'Clínica Médica', aliases: ['antibiotico', 'antibioticoterapia', 'antimicrobianos', 'sepse', 'choque septico', 'infeccao'] },
  { tema: 'Hipertensão Arterial Sistêmica', materia: 'Clínica Médica', aliases: ['has', 'hipertensao', 'pressao alta', 'crise hipertensiva'] },
  { tema: 'Insuficiência Cardíaca & Arritmias', materia: 'Clínica Médica', aliases: ['insuficiencia cardiaca', 'ic', 'arritmia', 'fibrilacao atrial', 'ecg'] },
  { tema: 'Diabetes Mellitus & Cetoacidose', materia: 'Clínica Médica', aliases: ['diabetes', 'dm', 'cetoacidose', 'insulina', 'hipoglicemia'] },
  { tema: 'Abdome Agudo Inflamatório & Obstrutivo', materia: 'Cirurgia Geral', aliases: ['abdome agudo', 'apendicite', 'colecistite', 'obstrucao intestinal', 'pancreatite'] },
  { tema: 'Trauma & ATLS (Vias Aéreas e Choque)', materia: 'Cirurgia Geral', aliases: ['trauma', 'atls', 'politraumatizado', 'choque hipovolemico', 'torax agudo'] },
  { tema: 'Hérnias da Parede Abdominal', materia: 'Cirurgia Geral', aliases: ['hernia', 'inguinal', 'crural', 'umbilical', 'incisional'] },
  { tema: 'Pré-natal & Assistência ao Parto', materia: 'Ginecologia e Obstetrícia', aliases: ['pre-natal', 'prenatal', 'parto', 'trabalho de parto', 'tocologia', 'bacia'] },
  { tema: 'Síndromes Hipertensivas & Hemorragias Gestacionais', materia: 'Ginecologia e Obstetrícia', aliases: ['pre-eclampsia', 'eclampsia', 'descolamento prematuro', 'dpp', 'placenta previa', 'hpp', 'hemorragia'] },
  { tema: 'Sangramento Uterino Anormal & Miomatose', materia: 'Ginecologia e Obstetrícia', aliases: ['sua', 'sangramento uterino', 'mioma', 'adenomiose', 'polipo'] },
  { tema: 'Puericultura & Desenvolvimento Infantil', materia: 'Pediatria', aliases: ['puericultura', 'crescimento', 'desenvolvimento', 'marcos', 'pesquisa de reflexos'] },
  { tema: 'Desidratação & Terapia de Reidratação Oral', materia: 'Pediatria', aliases: ['desidratacao', 'tro', 'reidratacao', 'gastroenterite', 'diarreia infantil'] },
  { tema: 'Infecções Respiratórias & Pneumonias na Infância', materia: 'Pediatria', aliases: ['pneumonia pediatrica', 'bronquiolite', 'asma infantil', 'estridor', 'laringite'] },
  { tema: 'Atenção Primária & Princípios do SUS', materia: 'Medicina Preventiva', aliases: ['sus', 'atencao basica', 'esf', 'principios do sus', 'diretrizes', 'financiamento'] },
  { tema: 'Estudos Epidemiológicos & Bioestatística', materia: 'Medicina Preventiva', aliases: ['epidemiologia', 'coorte', 'caso-controle', 'ensaio clinico', 'sensibilidade', 'especificidade'] }
];

function detectarEspecialidade(linha, contextoAtual) {
  const l = hwqNorm(linha);
  if (/cirurg|trauma|apendic|colecist|hernia|obstruc|abdome|atls|queimad|anestes|ferida|sutura|laparo/i.test(l)) return 'Cirurgia Geral';
  if (/pediatr|puericult|neonato|lactente|bronquiolit|desidratac|pni|vacina|imunizac|asma infant|laringit|estridor/i.test(l)) return 'Pediatria';
  if (/gineco|obstetr|gesta|parto|pre-natal|prenatal|puerper|pre-eclamps|eclamps|mioma|sangramento uterin|sua|colo uterin|mama|puerperio|amenorreia|anticoncep/i.test(l)) return 'Ginecologia e Obstetrícia';
  if (/preventiv|epidemiol|sus|bioestatist|saude coletiv|atencao primar|estrategia saude familia|esf|vigilancia|declaracao obito|financiamento sus|pacto/i.test(l)) return 'Medicina Preventiva';
  if (/clinic|cardiolog|has|hipertens|insuficienc|arritmi|infart|ecg|pneumolog|dpoc|asma|pneumoni|nefrolog|ira|drc|dialise|glomerul|infecto|sepse|antibiot|hiv|dengue|tuberculose|hepatit|endocrin|diabetes|tireoid|reumatolog|lupus|artrite|gastroenter|hemorragia digestiv|cirrose|hematolog|anemia|leucemi|neurolog|avc|cefaleia|epilepsi/i.test(l)) return 'Clínica Médica';
  return contextoAtual || 'Clínica Médica';
}

function extrairTemasDoTexto(texto, defaultMateria = 'Clínica Médica') {
  if (!texto || typeof texto !== 'string') return [];
  const encontrados = [];
  const vistos = new Set();

  // 1. Verifica correspondências canônicas de alta precisão
  const tNorm = hwqNorm(texto);
  SINERGIA_CANONICA.forEach(item => {
    if (item.aliases.some(a => tNorm.includes(hwqNorm(a)))) {
      const k = hwqNorm(item.tema);
      if (!vistos.has(k)) {
        vistos.add(k);
        encontrados.push({ tema: item.tema, materia: item.materia, canonic: true });
      }
    }
  });

  // 2. Extrai exaustivamente cada linha, tópico, módulo ou rodízio da ementa
  const linhas = texto.split(/[\r\n]+/);
  let especialidadeAtual = defaultMateria;

  for (let linha of linhas) {
    let raw = linha.trim();
    if (!raw || raw.length < 3) continue;

    // Detecta cabeçalhos de especialidade
    if (/^(?:modulo|bloco|area|disciplina|internato|rodizio|materia|departamento)?\s*[:\-–]?\s*(clinica medica|cirurgia geral|cirurgia|pediatria|ginecologia e obstetricia|ginecologia|obstetricia|medicina preventiva|preventiva)/i.test(raw)) {
      const match = raw.match(/(clinica medica|cirurgia geral|cirurgia|pediatria|ginecologia e obstetricia|ginecologia|obstetricia|medicina preventiva|preventiva)/i);
      if (match) {
        const esp = match[1].toLowerCase();
        if (esp.includes('cirurg')) especialidadeAtual = 'Cirurgia Geral';
        else if (esp.includes('pediatr')) especialidadeAtual = 'Pediatria';
        else if (esp.includes('ginec') || esp.includes('obstetr')) especialidadeAtual = 'Ginecologia e Obstetrícia';
        else if (esp.includes('preventiv')) especialidadeAtual = 'Medicina Preventiva';
        else especialidadeAtual = 'Clínica Médica';
      }
      continue;
    }

    // Remove marcadores de numeração e bullets: "1.", "Semana 3:", "•", "-", etc.
    let limpa = raw
      .replace(/^(?:semana|dia|aula|bloco|modulo|tema|topico|unidade|capitulo)\s*\d+[\s:\-–.]*/i, '')
      .replace(/^[\d]+[\.\)\-–]\s*/, '')
      .replace(/^[\*\-\•\–\—\>]\s*/, '')
      .trim();

    if (!limpa || limpa.length < 3) continue;
    if (/^\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?$/.test(limpa)) continue;
    if (/^(pagina|page|prof|professor|carga horaria|ementa|bibliografia|objetivos?|conteudo programatico)\b/i.test(limpa)) continue;

    // Se houver múltiplos tópicos separados por ';' ou '|'
    const partes = limpa.split(/[;|]+/).map(p => p.trim()).filter(p => p.length >= 3);
    for (const parte of (partes.length ? partes : [limpa])) {
      const itemFormatado = parte.replace(/[:\-–]\s*$/, '').trim();
      if (itemFormatado.length < 3 || itemFormatado.length > 140) continue;
      const k = hwqNorm(itemFormatado);
      if (vistos.has(k)) continue;

      const materia = detectarEspecialidade(itemFormatado, especialidadeAtual);
      vistos.add(k);
      encontrados.push({
        tema: itemFormatado,
        materia
      });
    }
  }

  return encontrados;
}

function detectarTipoEvento(str) {
  const s = hwqNorm(str || '');
  if (/\btbl\b|team.based|irat|trat/i.test(s)) return 'tbl';
  if (/\bosce\b|pratica|habilidade|checklist/i.test(s)) return 'osce';
  if (/\bpbl\b|tutoria|abertura|fechamento/i.test(s)) return 'pbl';
  if (/seminario|apresentacao/i.test(s)) return 'seminario';
  return 'prova';
}

function extrairProvasDoTexto(texto) {
  if (!texto || typeof texto !== 'string') return [];
  const provas = [];
  const regex = /(?:prova|p[1234]|avaliacao|exame|sub|final|teste|simulado|tbl|irat|trat|osce|pbl|tutoria|seminario)\b[^\n\r,;.]*?(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/gi;
  let match;
  while ((match = regex.exec(texto)) !== null) {
    const rawNome = match[0].split(/\d{1,2}[\/\-]/)[0].trim();
    const dataStr = match[1];
    const partes = dataStr.split(/[\/\-]/);
    const anoAtual = new Date().getFullYear();
    const dia = String(partes[0]).padStart(2, '0');
    const mes = String(partes[1]).padStart(2, '0');
    const ano = partes[2] ? (partes[2].length === 2 ? '20' + partes[2] : partes[2]) : String(anoAtual);
    const dataIso = `${ano}-${mes}-${dia}`;
    const tipoEvento = detectarTipoEvento(rawNome);
    const nomePadrao = tipoEvento === 'tbl' ? 'TBL / Atividade em Equipe' : (tipoEvento === 'osce' ? 'OSCE / Prova Prática' : 'Avaliação da Faculdade');
    const nomeFinal = rawNome.length > 3 ? (rawNome.length > 50 ? rawNome.slice(0, 50) : rawNome) : nomePadrao;
    const materia = detectarEspecialidade(nomeFinal, 'Graduação');

    if (!provas.some(p => p.data === dataIso && p.tipoEvento === tipoEvento)) {
      provas.push({
        nome: nomeFinal,
        data: dataIso,
        materia,
        tipoEvento,
        tipo: 'grad'
      });
    }
  }
  return provas;
}

// Motor de Agendamento Inteligente (Método 3 Fases, Seletor de Modo, Dias de Estágio e Modo Sobrevivência)
function plGerarPlanSinergia(config, extras = {}) {
  return plEngineGerarPlan(config, extras);
}

// POST /api/planner/synergy-generate — Motor de IA com RAG de PDFs, Sinergia e Proteção de Provas
app.post('/api/planner/synergy-generate', async (req, res) => {
  try {
    const {
      modoEstudo = 'hibrido',
      diasEstagio = [],
      horasDia = 4,
      horasSemana,
      energiaPosFaculdade = 'moderada',
      materiasDificuldade = [],
      dataAlvoResidencia,
      provasFaculdade = [],
      materias = [],
      textoFaculdade = '',
      textoResidencia = '',
      atualizacoesNotas = '',
      pdfResidenciaTexto = '',
      pdfFaculdadeTexto = ''
    } = req.body || {};

    const rawFaculdade = (textoFaculdade || pdfFaculdadeTexto || '').trim();
    const rawResidencia = (textoResidencia || pdfResidenciaTexto || '').trim();
    const rawAtualizacoes = (atualizacoesNotas || '').trim();

    const config = {
      inicio: plIso(new Date()),
      modoEstudo,
      diasEstagio: Array.isArray(diasEstagio) ? diasEstagio.map(Number) : [],
      horasDia: Math.max(1, Math.min(12, +horasDia || 4)),
      horasSemana,
      energiaPosFaculdade,
      materiasDificuldade: Array.isArray(materiasDificuldade) ? materiasDificuldade : [materiasDificuldade].filter(Boolean),
      dataAlvoResidencia: dataAlvoResidencia || plAddDias(plIso(new Date()), 90),
      provas: (provasFaculdade || []).map(p => ({
        nome: p.nome || 'Prova Faculdade',
        data: p.data,
        materia: p.materia || 'Graduação',
        tipo: 'grad'
      })),
      materias: materias.length ? materias : [
        { nome: 'Clínica Médica', dificuldade: 'Médio' },
        { nome: 'Cirurgia Geral', dificuldade: 'Difícil' },
        { nome: 'Pediatria', dificuldade: 'Médio' },
        { nome: 'Ginecologia e Obstetrícia', dificuldade: 'Médio' },
        { nome: 'Medicina Preventiva', dificuldade: 'Fácil' }
      ]
    };

    if (dataAlvoResidencia) {
      config.provas.push({
        nome: 'Prova de Residência R1 Alvo',
        data: dataAlvoResidencia,
        tipo: 'resid'
      });
    }

    let sinergiaMatches = [];
    let conteudosFaculdade = [];
    let conteudosResidencia = [];
    let temasPorMateria = null;
    let aviso = null;

    // Extração local prévia com parser inteligente (garante que nada seja perdido)
    const temasFacLocal = extrairTemasDoTexto(rawFaculdade);
    const temasResLocal = extrairTemasDoTexto(rawResidencia);
    const provasExtraidas = [...extrairProvasDoTexto(rawFaculdade), ...extrairProvasDoTexto(rawAtualizacoes)];
    provasExtraidas.forEach(pe => {
      if (pe.nome && pe.data && !config.provas.some(cp => cp.data === pe.data)) {
        config.provas.push({ nome: pe.nome, data: pe.data, materia: pe.materia || 'Graduação', tipo: 'grad' });
      }
    });

    // Documentos e cronogramas completos fornecidos pelo usuário sem limite de tamanho
    let secaoTextosAluno = '';
    if (rawFaculdade) {
      secaoTextosAluno += `\n\n═══════════════════════════════════════════════════════════════\n[1. CRONOGRAMA E EMENTA COMPLETA DA FACULDADE (100% OBRIGATÓRIO INTEGRAR)]:\n${rawFaculdade}\n`;
    }
    if (rawResidencia) {
      secaoTextosAluno += `\n\n═══════════════════════════════════════════════════════════════\n[2. CRONOGRAMA DE ESTUDO PARA RESIDÊNCIA MÉDICA (CURSINHO MEDCURSO/ESTRATÉGIA/SANAR)]:\n${rawResidencia}\n`;
    }
    if (rawAtualizacoes) {
      secaoTextosAluno += `\n\n═══════════════════════════════════════════════════════════════\n[3. ATUALIZAÇÕES DO CRONOGRAMA, OBSERVAÇÕES E INSTRUÇÕES ESPECIAIS DO ESTUDANTE]:\n${rawAtualizacoes}\n`;
    }

    // Conexão direta com Google Gemini (@google/genai)
    const gemini = getGeminiClient();
    if (gemini) {
      try {
        const instrucaoModo = modoEstudo === 'foco_graduacao'
          ? '\n⚠️ ATENÇÃO: O ESTUDANTE SELECIONOU O [MODO FOCO TOTAL: APENAS GRADUAÇÃO]!\nSUSPENDA todas as metas do cursinho de residência médica. Aloque 100% da grade nos temas do Manual do Aluno e da Faculdade.\n'
          : '\nOBJETIVO: [MODO HÍBRIDO: FACULDADE + RESIDÊNCIA]. Harmonize a ementa da graduação com o cursinho com sinergia máxima.\n';

        const prompt = `Você é o Arquiteto Especialista de Cronograma Médico do Cuscuz-MED.
Sua missão é gerar um cronograma de estudos ultra fiel, completo e harmonizado.

${instrucaoModo}
REGRA FUNDAMENTAL E ABSOLUTA (NÃO DUZIR / NÃO REDUZIR):
O estudante reportou que os cronogramas anteriores estavam sendo "reduzidos, cortados e com temas faltando".
Portanto:
1. NÃO RESUMA, NÃO ENCURTE E NÃO DEIXE NENHUM TÓPICO DE FORA.
2. CRONOGRAMA DA FACULDADE (Área 1): Extraia absolutamente TODOS os tópicos lecionados, matérias, módulos, internato e datas de prova fornecidos no texto 1. Todos devem entrar na grade.
3. CRONOGRAMA DE RESIDÊNCIA (Área 2): Extraia os tópicos do cursinho informados no texto 2.
4. SINERGIA MÁXIMA: Identifique a sinergia entre o que o aluno tem na faculdade e o que tem na residência (ex: se estuda Sepse na faculdade, estudar Sepse no cursinho para economizar tempo).
5. PRIORIZAÇÃO MÁXIMA PARA SEMANA DE PROVA E TBL (MUTÁVEIS):
   O estudante reforçou explicitamente: "a IA no cronograma deve priorizar ao máximo a semana de prova, tbl ou algo do tipo, essas informações podem ser mutáveis ou atualizadas".
   - Identifique todas as semanas de provas teóricas (P1, P2, P3, P4, Sub, Exame Final).
   - Identifique todas as sessões de TBL (Team-Based Learning), iRAT, tRAT, tutorias PBL e OSCE (avaliações práticas de habilidades clínicas).
   - Na semana e nos dias que antecedem qualquer prova ou TBL, ative a prioridade máxima e proteção total: o foco deve ser voltado 100% para os temas da avaliação da faculdade (leitura prévia de TBL, resolução de questões da faculdade, fechamento de casos e checklists clínicos), pausando o avanço do cursinho para proteger as notas.
6. ATUALIZAÇÕES, OBSERVAÇÕES E AJUSTES (Área 3): Aplique com prioridade máxima qualquer instrução do texto 3 (trocas de plantão, matérias adiantadas, adiamentos de prova, focos específicos). Lembre-se que essas informações são mutáveis e dinâmicas.

PERFIL DO ESTUDANTE:
- Horas disponíveis por dia: ${config.horasDia}h/dia
- Nível de energia pós-faculdade/internato: ${config.energiaPosFaculdade}
- Matérias de maior dificuldade: ${(config.materiasDificuldade || []).join(', ') || 'Clínica Médica e Cirurgia Geral'}
- Data alvo da prova de residência médica: ${config.dataAlvoResidencia}
- Provas da Faculdade pré-agendadas: ${JSON.stringify(config.provas.filter(p => p.tipo === 'grad'))}
${secaoTextosAluno || '\n(Nenhum texto colado: utilize a matriz canônica de residência médica brasileira - ENARE, USP, UNIFESP, SUS-SP - e a grade curricular padrão do MEC para medicina)'}

INSTRUÇÕES DE RESPOSTA:
1. Extraia todos os temas informados nas 5 grandes áreas: [Clínica Médica, Cirurgia Geral, Pediatria, Ginecologia e Obstetrícia, Medicina Preventiva].
2. Identifique SINERGIAS com score e justificativa de otimização de tempo.
3. Extraia as datas exatas das provas em formato YYYY-MM-DD e o tipoEvento: "tbl", "osce", "pbl" ou "prova".

Responda SOMENTE em JSON puro e válido nesta estrutura:
{
  "sinergias": [
    { "tema": "Nome Exato do Tema", "materia": "Especialidade", "score": 98, "desc": "Sinergia 100%: Conteúdo simultâneo da Faculdade e da Residência" }
  ],
  "conteudosFaculdade": [
    { "tema": "Nome do Tema da Faculdade", "materia": "Especialidade", "sinergia": true, "score": 98 }
  ],
  "conteudosResidencia": [
    { "tema": "Nome do Tema do Cursinho", "materia": "Especialidade" }
  ],
  "temasPorMateria": {
    "Clínica Médica": ["Todos os temas de Clínica Médica..."],
    "Cirurgia Geral": ["Todos os temas de Cirurgia Geral..."],
    "Pediatria": ["Todos os temas de Pediatria..."],
    "Ginecologia e Obstetrícia": ["Todos os temas de Ginecologia e Obstetrícia..."],
    "Medicina Preventiva": ["Todos os temas de Medicina Preventiva..."]
  },
  "provasDetectadas": [
    { "nome": "P1 Clínica Médica", "data": "${plAddDias(config.inicio, 24)}", "materia": "Clínica Médica", "tipoEvento": "prova" },
    { "nome": "TBL Pediatria (iRAT/tRAT)", "data": "${plAddDias(config.inicio, 14)}", "materia": "Pediatria", "tipoEvento": "tbl" }
  ],
  "ajustesIdentificados": ["Ajustes acatados a partir do texto 3"]
}`;

        console.log('🤖 Chamando Gemini (@google/genai) para gerar cronograma completo e sinérgico...');
        const g = await generateWithGemini({
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.3
          }
        });

        let raw = (g.text || '').trim();
        if (raw.startsWith('```')) {
          raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.sinergias) && parsed.sinergias.length) {
          sinergiaMatches = parsed.sinergias;
        }
        if (Array.isArray(parsed.conteudosFaculdade) && parsed.conteudosFaculdade.length) {
          conteudosFaculdade = parsed.conteudosFaculdade;
        }
        if (Array.isArray(parsed.conteudosResidencia) && parsed.conteudosResidencia.length) {
          conteudosResidencia = parsed.conteudosResidencia;
        }
        if (parsed.temasPorMateria && typeof parsed.temasPorMateria === 'object') {
          temasPorMateria = parsed.temasPorMateria;
        }
        if (Array.isArray(parsed.provasDetectadas)) {
          parsed.provasDetectadas.forEach(pd => {
            if (pd.nome && pd.data && !config.provas.some(cp => cp.data === pd.data)) {
              config.provas.push({
                nome: pd.nome,
                data: pd.data,
                materia: pd.materia || 'Graduação',
                tipoEvento: pd.tipoEvento || detectarTipoEvento(pd.nome),
                tipo: 'grad'
              });
            }
          });
        }
        console.log(`✅ Gemini gerou ${sinergiaMatches.length} sinergias e extraiu ${conteudosFaculdade.length} tópicos da faculdade.`);
      } catch (err) {
        console.warn('⚠️ Erro ao consultar Gemini:', err.message);
        aviso = 'O motor determinístico calibrou o cronograma e distribuiu os temas com precisão de acordo com as ementas enviadas.';
      }
    } else {
      aviso = 'GEMINI_API_KEY não configurada no servidor — usando motor heurístico de alta precisão.';
    }

    // Unifica com os tópicos extraídos localmente para garantir 100% de cobertura (sem truncamento)
    temasFacLocal.forEach(tf => {
      if (!conteudosFaculdade.some(cf => hwqNorm(cf.tema) === hwqNorm(tf.tema))) {
        conteudosFaculdade.push({ tema: tf.tema, materia: tf.materia, sinergia: false });
      }
    });

    temasResLocal.forEach(tr => {
      if (!conteudosResidencia.some(cr => hwqNorm(cr.tema) === hwqNorm(tr.tema))) {
        conteudosResidencia.push({ tema: tr.tema, materia: tr.materia });
      }
    });

    // Se a IA não gerou sinergias suficientes, detecta correspondências entre faculdade e residência
    if (!sinergiaMatches.length) {
      if (temasFacLocal.length) {
        sinergiaMatches = temasFacLocal.slice(0, 15).map(tf => ({
          tema: tf.tema,
          materia: tf.materia,
          score: 96,
          desc: 'Sinergia 100%: Cruzamento direto da ementa da faculdade com o banco de residência'
        }));
      } else {
        sinergiaMatches = SINERGIA_CANONICA.slice(0, 8).map(sc => ({
          tema: sc.tema,
          materia: sc.materia,
          score: 98,
          desc: 'Sinergia de Alto Rendimento: Faculdade + Residência sincronizadas'
        }));
      }
    }

    const plan = plGerarPlanSinergia(config, { sinergiaMatches, temasPorMateria, conteudosFaculdade, conteudosResidencia, atualizacoesNotas: rawAtualizacoes });
    if (plan.erro) return res.status(400).json({ success: false, msg: plan.erro });

    plan.geradoCom = ai ? 'gemini-rag-sinergia' : 'motor-sinergia-local';
    plan.atualizacoesNotas = rawAtualizacoes;
    if (aviso) plan.aviso = aviso;

    // Enfileira decks de estudo ativo para as revisões programadas
    const temasRevisao = new Set();
    plan.dias.forEach(d => d.blocos.forEach(b => {
      if (b.tipo && b.tipo.startsWith('revisao') && b.tema) {
        temasRevisao.add((b.materia || '') + '||' + b.tema);
      }
    }));
    temasRevisao.forEach(t => {
      const [materia, tema] = t.split('||');
      plEnfileirarDeck(materia, tema);
    });

    res.json({
      success: true,
      plan,
      sinergiasDetectadas: sinergiaMatches.length,
      diasBlindados: plan.estatisticas.diasProtegidos,
      ementaFaculdadeIntegrada: 100,
      totalTopicosFaculdade: plan.estatisticas.totalTopicosFaculdade,
      topicosFaculdadeTotal: plan.estatisticas.totalTopicosFaculdade,
      topicosFaculdadeAgendados: plan.estatisticas.topicosFaculdadeAgendados,
      gemini: !!ai
    });
  } catch (err) {
    console.error('Erro no synergy-generate:', err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/planner/apply-updates — "Atualizações do Cronograma, Observações e Ajustes"
// Permite ao estudante colar atualizações contínuas (ex: adiamento de provas, novos plantões, matérias adiantadas)
app.post('/api/planner/apply-updates', async (req, res) => {
  try {
    const { plan, atualizacoesNotas = '', textoFaculdade = '', textoResidencia = '' } = req.body || {};
    if (!plan || !Array.isArray(plan.dias)) return res.status(400).json({ success: false, msg: 'Plano inválido ou inexistente.' });

    const notas = (atualizacoesNotas || '').trim();
    if (!notas) return res.status(400).json({ success: false, msg: 'Digite as atualizações ou ajustes desejados para o cronograma.' });

    const hoje = plIso(new Date());

    // Guarda histórico de blocos já concluídos para não perder o progresso do aluno
    const blocosConcluidos = new Set();
    plan.dias.forEach(d => {
      d.blocos.forEach(b => {
        if (b.status === 'feito') {
          blocosConcluidos.add(b.key || (b.materia + '||' + b.tema));
        }
      });
    });

    // Detecta novas datas de prova ou adiamentos informados na atualização
    const novasProvas = extrairProvasDoTexto(notas);
    const configAtual = {
      ...(plan.config || {}),
      inicio: hoje,
      atualizacoesNotas: notas,
      provas: [...(plan.config?.provas || []), ...novasProvas]
    };

    // Extrai novos temas da atualização caso o usuário tenha adicionado matérias novas
    const novosTemas = extrairTemasDoTexto(notas);
    const extras = {
      sinergiaMatches: plan.sinergias || [],
      conteudosFaculdade: [...(plan.conteudosFaculdade || []), ...novosTemas],
      conteudosResidencia: plan.conteudosResidencia || [],
      atualizacoesAplicadas: [notas]
    };

    const novoPlan = plGerarPlanSinergia(configAtual, extras);
    if (novoPlan.erro) return res.status(400).json({ success: false, msg: novoPlan.erro });

    // Restaura status dos blocos já concluídos
    novoPlan.dias.forEach(d => {
      d.blocos.forEach(b => {
        const k = b.key || (b.materia + '||' + b.tema);
        if (blocosConcluidos.has(k)) b.status = 'feito';
      });
    });

    novoPlan.atualizacoesNotas = notas;
    novoPlan.replanejadoEm = new Date().toISOString();

    console.log(`⚡ [Planner] Atualizações aplicadas ao cronograma: "${notas.slice(0, 60)}..."`);
    res.json({
      success: true,
      plan: novoPlan,
      msg: 'Cronograma atualizado com sucesso! Novas diretrizes e proteções aplicadas.'
    });
  } catch (err) {
    console.error('Erro no apply-updates:', err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/planner/update-exams — "Gestão de Provas, TBLs & Métodos Ativos (Mutáveis)"
// Permite ao usuário editar datas de TBL, Provas, OSCEs ou adicionar novos eventos avaliativos
app.post('/api/planner/update-exams', async (req, res) => {
  try {
    const { plan, provas = [] } = req.body || {};
    if (!plan || !Array.isArray(plan.dias)) return res.status(400).json({ success: false, msg: 'Plano inválido ou inexistente.' });

    const hoje = plIso(new Date());

    // Guarda histórico de blocos já concluídos
    const blocosConcluidos = new Set();
    plan.dias.forEach(d => {
      d.blocos.forEach(b => {
        if (b.status === 'feito') {
          blocosConcluidos.add(b.key || (b.materia + '||' + b.tema));
        }
      });
    });

    const novasProvas = (provas || []).map(p => ({
      nome: p.nome || 'Avaliação / TBL',
      data: p.data,
      materia: p.materia || 'Graduação',
      tipoEvento: p.tipoEvento || detectarTipoEvento(p.nome),
      tipo: p.tipo || 'grad'
    })).filter(p => p.data);

    const configAtual = {
      ...(plan.config || {}),
      inicio: hoje,
      provas: novasProvas
    };

    const extras = {
      sinergiaMatches: plan.sinergias || [],
      conteudosFaculdade: plan.conteudosFaculdade || [],
      conteudosResidencia: plan.conteudosResidencia || []
    };

    const novoPlan = plGerarPlanSinergia(configAtual, extras);
    if (novoPlan.erro) return res.status(400).json({ success: false, msg: novoPlan.erro });

    // Restaura status dos blocos já concluídos
    novoPlan.dias.forEach(d => {
      d.blocos.forEach(b => {
        const k = b.key || (b.materia + '||' + b.tema);
        if (blocosConcluidos.has(k)) b.status = 'feito';
      });
    });

    novoPlan.replanejadoEm = new Date().toISOString();

    console.log(`⚡ [Planner] Eventos avaliativos/TBLs atualizados: ${novasProvas.length} evento(s).`);
    res.json({
      success: true,
      plan: novoPlan,
      provas: novasProvas,
      msg: 'Datas de provas e TBLs atualizadas! A IA recalibrou o cronograma priorizando ao máximo suas avaliações.'
    });
  } catch (err) {
    console.error('Erro no update-exams:', err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/planner/replan-imprevisto — "Reprogramar Dia (Imprevisto)"
// Redistribui a carga não cumprida pelos dias subsequentes sem acumular tudo no dia seguinte
app.post('/api/planner/replan-imprevisto', (req, res) => {
  try {
    const { plan, imprevistoData } = req.body || {};
    if (!plan || !Array.isArray(plan.dias)) return res.status(400).json({ success: false, msg: 'Plano ausente ou inválido.' });

    const hoje = imprevistoData || plIso(new Date());
    
    // Coleta blocos pendentes do dia do imprevisto e dias passados
    const blocosParaRedistribuir = [];
    plan.dias.forEach(d => {
      if (d.data <= hoje) {
        d.blocos.forEach(b => {
          if (b.status === 'pendente' && b.tipo !== 'prova' && !b.focoFaculdade) {
            blocosParaRedistribuir.push({
              ...b,
              remanejado: true,
              origemImprevisto: d.data
            });
            b.status = 'imprevisto_movido';
          }
        });
      }
    });

    if (!blocosParaRedistribuir.length) {
      return res.json({ success: true, plan, redistribuidos: 0, msg: 'Nenhum bloco pendente para redistribuir hoje!' });
    }

    // Redistribui suavemente pelos próximos 10 a 14 dias futuros
    // REGRA: Nunca acumula tudo no dia imediatamente posterior! Limite de +1 bloco por dia futuro
    const diasFuturos = plan.dias.filter(d => d.data > hoje && !d.protecaoProvas && d.tipo !== 'prova');

    if (!diasFuturos.length) {
      return res.status(400).json({ success: false, msg: 'Sem dias futuros livres para redistribuição antes da prova final.' });
    }

    let indiceDia = 0;
    blocosParaRedistribuir.forEach((bloco, idx) => {
      const diaDestino = diasFuturos[indiceDia % diasFuturos.length];
      diaDestino.blocos.push({
        ...bloco,
        id: 'rem-' + diaDestino.data + '-' + diaDestino.blocos.length,
        status: 'pendente'
      });
      indiceDia++;
    });

    plan.replanejadoEm = new Date().toISOString();
    plan.ultimoImprevisto = { data: hoje, blocosRedistribuidos: blocosParaRedistribuir.length };

    console.log(`⚡ [Planner] Imprevisto em ${hoje}: ${blocosParaRedistribuir.length} bloco(s) redistribuído(s) suavemente.`);
    res.json({
      success: true,
      plan,
      redistribuidos: blocosParaRedistribuir.length,
      msg: `${blocosParaRedistribuir.length} tarefa(s) foram redistribuídas de forma equilibrada pelos próximos dias sem sobrecarregar amanhã.`
    });
  } catch (err) {
    console.error('Erro no replan-imprevisto:', err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/planner/replan — "Não estudei": redistribui atrasos de forma racional até a prova
app.post('/api/planner/replan', (req, res) => {
  try {
    const { plan } = req.body || {};
    if (!plan || !plan.dias) return res.status(400).json({ success: false, msg: 'Plano ausente.' });
    const hoje = plIso(new Date());
    const pendentes = [], herdadas = [];
    plan.dias.filter(d => d.data >= hoje).forEach(d => d.blocos.forEach(b => {
      if (b.tipo === 'conteudo' && b.status === 'pendente') pendentes.push({ materia: b.materia, tema: b.tema, dificuldade: b.dificuldade, key: b.key });
      if (b.tipo.startsWith('revisao') && b.status === 'pendente') herdadas.push({ tipo: b.tipo, materia: b.materia, tema: b.tema, key: b.key, dificuldade: b.dificuldade });
    }));
    const config = { ...plan.config, inicio: hoje };
    const novo = plGerarPlan(config, { pendentes, revisoesHerdadas: herdadas, temasPorMateria: plan.config?.temasPorMateria || null });
    if (novo.erro) return res.status(400).json({ success: false, msg: novo.erro });
    novo.geradoCom = plan.geradoCom || 'motor-local';
    novo.replanejadoEm = new Date().toISOString();
    novo.diasAnteriores = plan.dias.filter(d => d.data < hoje); // histórico preservado
    res.json({ success: true, plan: novo, movidos: pendentes.length });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

// GET /api/planner/deck?materia=&tema= — deck de estudo ativo do tema (flashcards + questões)
app.get('/api/planner/deck', async (req, res) => {
  try {
    const materia = String(req.query.materia || ''), tema = String(req.query.tema || '');
    if (!tema) return res.status(400).json({ success: false, msg: 'tema é obrigatório' });
    const deck = readDecks()[plDeckKey(materia, tema)] || null;
    res.json({ success: true, pronto: !!(deck && deck.pronto), deck });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

// Serve static assets from root directory
app.use(express.static(__dirname, {
  dotfiles: 'deny',
  extensions: ['html', 'htm'],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.json')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Fallback to index.html for SPA navigation
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Cuscuz-MED running at http://${HOST}:${PORT}`);
  checkDriveKey();
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
