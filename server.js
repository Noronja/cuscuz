import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';

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

app.use(express.json());

// Initialize Google Gemini Client with official @google/genai SDK
const geminiApiKey = process.env.GEMINI_API_KEY;
let ai = null;
if (geminiApiKey) {
  try {
    ai = new GoogleGenAI({
      apiKey: geminiApiKey,
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

// Resilient Gemini model caller with retry and fallback cascade
async function generateWithGemini(params) {
  if (!ai) throw new Error('GEMINI_API_KEY não configurada no servidor.');
  const models = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  let lastErr = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const m of models) {
      try {
        const res = await ai.models.generateContent({
          model: m,
          ...params
        });
        return res;
      } catch (err) {
        lastErr = err;
        const is503 = err.status === 503 || (err.message && err.message.includes('503'));
        console.warn(`Model ${m} (tentativa ${attempt}) ${is503 ? '503 alta demanda' : 'erro'}:`, err.message?.slice(0, 100));
        await new Promise(r => setTimeout(r, 400 * attempt));
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

// Google Drive Proxy & In-Memory Cache
const DRIVE_API_KEY = process.env.GOOGLE_DRIVE_API_KEY || 'AIzaSyA6aoGd1Yxj0Yn9JjzAABwQGOTkj7xEAVQ';
const DRIVE_ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '1pVd7V_pfyM4Vw20yfw45jBmNFqtKTHK7';
const driveCache = new Map();
const DRIVE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

app.get('/api/drive/clear-cache', (req, res) => {
  const size = driveCache.size;
  driveCache.clear();
  res.json({ success: true, cleared: size, message: 'Cache do Google Drive limpo com sucesso' });
});

app.get('/api/drive/list', async (req, res) => {
  const folderId = req.query.folderId || DRIVE_ROOT_FOLDER_ID;
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
      
      const r = await fetch(url);
      if (!r.ok) {
        const errText = await r.text();
        return res.status(r.status).json({ error: 'Google Drive API error', details: errText });
      }
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    openaiConfigured: !!openai,
    supabaseConfigured: !!supabase
  });
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
const HWQ_STATE = { userToken: null, lastLoginAt: null, lastLoginOk: null, lastSyncAt: null, lastSyncOk: null, lastSyncResult: null };

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
    const { areas, anos, grupos_prova, qtd_maxima, cookie, email, senha, idTurma, salvar = true } = req.body || {};
    if (email && senha) { HWQ.email = String(email).trim(); HWQ.senha = String(senha); HWQ_STATE.userToken = null; } // sessão avulsa (não persiste)
    if (cookie) HWQ.cookie = String(cookie).trim(); // legado

    if (salvar === false) {
      if (!HWQ_STATE.userToken) await hwqLogin();
      const search = await hwqFetchAll({ areas, anos, grupos_prova, qtd_maxima, idTurma });
      if (search.error || search.authFailed || search.status >= 400) {
        return res.status(search.authFailed ? 401 : 502).json({
          success: false, authFailed: !!search.authFailed, status: search.status,
          msg: search.authFailed ? 'Login no Hardworq falhou — verifique email/senha.' : (search.msg || search.error || `A API respondeu ${search.status}.`)
        });
      }
      const parsed = parseHardworqPayload(search.questions);
      return res.json({ success: true, fetched: search.questions.length, imported: 0, updated: 0, questions: parsed });
    }

    const result = await runHardworqSync({ areas, anos, grupos_prova, qtd_maxima, idTurma });
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
    const { idTurma, cookie, email, senha, jsonText, payload, qtd_maxima = 20, areas, anos, grupos_prova } = req.body || {};
    let parsedQuestions = [];

    if (email && senha) { HWQ.email = String(email).trim(); HWQ.senha = String(senha); HWQ_STATE.userToken = null; }
    if (cookie) HWQ.cookie = String(cookie).trim();

    if (payload || jsonText) {
      parsedQuestions = parseHardworqPayload(payload || jsonText);
    } else if (idTurma || HWQ.email || HWQ.cookie) {
      if (!HWQ_STATE.userToken) await hwqLogin();
      const search = await hwqFetchAll({ idTurma, areas, anos, grupos_prova, qtd_maxima });
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

// Serve static assets from root directory
app.use(express.static(__dirname, {
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
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
