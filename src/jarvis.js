// Jarvis — assistente de voz do Cuscuz-MED: entende o pedido, devolve fala + ações para o app executar
import { Type } from '@google/genai';
import crypto from 'crypto';
import * as PE from './planner-engine.js';

const ACOES = ['iniciar_gravacao', 'ir_para', 'abrir_aula', 'praticar_questoes', 'abrir_flashcards', 'abrir_erros', 'concluir_tarefa', 'ajustar_plano', 'gerar_plano'];
const DESTINOS = ['inicio', 'acervo', 'treino', 'simulados', 'planner', 'calendario', 'semana', 'preparatorio', 'aula'];

function pcm16ToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Reserva sem IA: entende os pedidos mais comuns por palavras-chave
function interpretarLocal(texto, ctx) {
  const n = PE.norm(texto);
  const nome = ctx.nome || 'doutor';
  let m;
  if (/(o que|qual).*(hoje|tenho|tarefa)|tarefas? de hoje|plano de hoje|o que (eu )?(tenho|devo)/.test(n)) {
    const ts = (ctx.hoje || []).filter(t => t.status !== 'feito');
    if (!ts.length) return { fala: `Nada pendente para hoje, ${nome}. Aproveite o descanso, ou posso adiantar algum tema.`, acoes: [{ tipo: 'ir_para', destino: 'planner' }] };
    return { fala: `Hoje você tem ${ts.length} ${ts.length > 1 ? 'tarefas' : 'tarefa'}: ${ts.slice(0, 4).map(t => t.titulo.replace(/—/g, ',')).join('; ')}.`, acoes: [{ tipo: 'ir_para', destino: 'planner' }] };
  }
  if ((m = n.match(/(?:abr\w*|toc\w*|pass\w*|quero|coloc\w*|mostr\w*)\s+(?:a\s+|uma\s+)?aula\s+(?:de|sobre|da|do)\s+(.+)/))) return { fala: `Procurando a aula de ${m[1]}.`, acoes: [{ tipo: 'abrir_aula', busca: m[1] }] };
  if ((m = n.match(/quest(?:oes|ao)\s+(?:de|sobre|da|do)\s+(.+)/))) return { fala: `Preparando questões de ${m[1]}.`, acoes: [{ tipo: 'praticar_questoes', tema: m[1], disciplina: '' }] };
  if (/flashcard|cartoes|cartao/.test(n)) return { fala: 'Abrindo os flashcards que vencem hoje.', acoes: [{ tipo: 'abrir_flashcards' }] };
  if (/\berros?\b|caderno de erros|questoes que errei/.test(n)) return { fala: 'Abrindo o caderno de erros.', acoes: [{ tipo: 'abrir_erros' }] };
  if (/(terminei|conclui|concluí|fiz|ja fiz)/.test(n)) return { fala: 'Marcando como concluída.', acoes: [{ tipo: 'concluir_tarefa', tarefa: texto.replace(/^.*?(terminei|conclu\w+|fiz)\s*/i, '') }] };
  if (/(cansad|sem tempo|nao consigo|reorganiz|ajust|mudar o plano|adiant|atras)/.test(n)) return { fala: 'Entendido. Vamos ajustar o cronograma, conte-me o que mudou.', acoes: [{ tipo: 'ajustar_plano', texto }] };
  if (/(gerar|montar|criar).*(cronograma|plano)/.test(n)) return { fala: 'Vamos montar o seu cronograma.', acoes: [{ tipo: 'gerar_plano' }] };
  if (/(grav\w+|transcre\w+).*(aula)|aula do dia|modo aula/.test(n)) return { fala: 'Abrindo o modo aula do dia. Pode começar a gravação quando estiver pronto.', acoes: [{ tipo: 'ir_para', destino: 'aula' }] };
  const dest = [['simulado', 'simulados'], ['calend', 'calendario'], ['semana', 'semana'], ['planner|cronograma|planej', 'planner'], ['acervo|aulas|curso', 'acervo'], ['treino|questoes', 'treino'], ['inicio|home|painel', 'inicio']].find(([k]) => new RegExp(k).test(n));
  if (dest && /(abr|va|vai|ir|mostr|leve|ver)/.test(n)) return { fala: `Abrindo ${dest[1]}.`, acoes: [{ tipo: 'ir_para', destino: dest[1] }] };
  return { fala: `Desculpe, ${nome}, não entendi. Experimente: "o que tenho hoje", "abra a aula de talassemia", "questões de pediatria" ou "abra os flashcards".`, acoes: [] };
}

export function registerJarvis(app, { generateWithGemini, getGeminiClient }) {
  const ttsCache = new Map();

  app.post('/api/jarvis', async (req, res) => {
    try {
      const texto = String((req.body && req.body.texto) || '').trim().slice(0, 600);
      if (!texto) return res.status(400).json({ success: false, msg: 'Fale ou digite algo.' });
      const ctx = req.body.contexto || {};
      const hist = Array.isArray(req.body.historico) ? req.body.historico.slice(-8) : [];
      let out = null, ia = false;
      if (getGeminiClient()) {
        try {
          const sistema = `Você é o JARVIS, assistente de voz pessoal de um estudante de medicina brasileiro, dentro do app Cuscuz-MED. Fale português do Brasil com elegância discreta, calma e levemente irônica, como um mordomo inglês muito competente. Chame o aluno de «${ctx.nome || 'doutor'}». Respostas CURTAS (1 a 3 frases), pois serão faladas em voz alta: sem markdown, listas, emojis ou siglas difíceis de pronunciar.
Contexto atual do aluno (JSON): ${JSON.stringify({ hoje: ctx.hoje || [], flashcardsVencidos: ctx.flashcards, errosSalvos: ctx.erros, dataHoje: ctx.dataHoje, planoAtivo: !!ctx.planoAtivo })}
Você controla o app emitindo "acoes". Tipos: iniciar_gravacao (abre o modo Aula do dia e começa a gravar/transcrever a aula da faculdade), ir_para(destino: ${DESTINOS.join('|')}), abrir_aula(busca: termo do tema — o sistema procura no acervo real), praticar_questoes(tema, disciplina), abrir_flashcards, abrir_erros, concluir_tarefa(tarefa: trecho do título de uma tarefa de hoje), ajustar_plano(texto: o que o aluno quer mudar), gerar_plano. Só emita ação quando o aluno pedir algo que a exija. Para conversa, dúvidas de medicina ou motivação, apenas responda em "fala" (seja correto; diga quando não tiver certeza). Nunca invente que uma aula existe: use abrir_aula com busca. Não faça diagnóstico nem prescrição para casos reais.`;
          const r = await generateWithGemini({
            contents: [...hist.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: String(h.content || '').slice(0, 500) }] })), { role: 'user', parts: [{ text: texto }] }],
            config: {
              systemInstruction: sistema, temperature: 0.6, responseMimeType: 'application/json',
              responseSchema: { type: Type.OBJECT, properties: { fala: { type: Type.STRING }, acoes: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { tipo: { type: Type.STRING }, destino: { type: Type.STRING }, busca: { type: Type.STRING }, tema: { type: Type.STRING }, disciplina: { type: Type.STRING }, tarefa: { type: Type.STRING }, texto: { type: Type.STRING } }, required: ['tipo'] } } }, required: ['fala'] }
            }
          });
          const j = JSON.parse(r.text.trim());
          if (j && typeof j.fala === 'string') { out = { fala: j.fala.slice(0, 500), acoes: Array.isArray(j.acoes) ? j.acoes : [] }; ia = true; }
        } catch (e) { console.warn('[Jarvis] IA indisponível:', e.message); }
      }
      if (!out) out = interpretarLocal(texto, ctx);
      // valida e resolve as ações (aulas só com correspondência real no acervo)
      const acoes = [];
      for (const a of out.acoes || []) {
        if (!a || !ACOES.includes(a.tipo)) continue;
        if (a.tipo === 'ir_para' && !DESTINOS.includes(a.destino)) continue;
        if (a.tipo === 'abrir_aula') {
          const r = PE.buscarAulasLivre(a.busca || '', 1)[0];
          if (!r) { out.fala = `Não encontrei no acervo uma aula sobre ${String(a.busca || 'esse tema').slice(0, 60)}, ${ctx.nome || 'doutor'}. Posso tentar outro termo.`; continue; }
          acoes.push({ tipo: 'abrir_aula', id: r.id, titulo: r.titulo, disc: r.disc }); out.fala = ia ? out.fala : `Abrindo a aula ${r.titulo}.`; continue;
        }
        acoes.push({ tipo: a.tipo, destino: a.destino, tema: a.tema, disciplina: a.disciplina, tarefa: a.tarefa, texto: a.texto });
      }
      res.json({ success: true, ia, fala: out.fala, acoes });
    } catch (err) {
      console.error('[Jarvis]', err);
      res.status(500).json({ success: false, msg: err.message });
    }
  });

  // Voz do Jarvis (Gemini TTS). Se indisponível, o app usa a voz do navegador.
  app.post('/api/jarvis/tts', async (req, res) => {
    try {
      const client = getGeminiClient();
      const texto = String((req.body && req.body.texto) || '').trim().slice(0, 450);
      if (!client || !texto) return res.status(503).json({ success: false, msg: 'TTS indisponível' });
      const key = crypto.createHash('sha1').update(texto).digest('hex');
      if (ttsCache.has(key)) { res.type('audio/wav'); return res.send(ttsCache.get(key)); }
      const modelo = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
      const r = await client.models.generateContent({
        model: modelo,
        contents: [{ parts: [{ text: `Diga em português do Brasil, com voz masculina grave, calma, polida e sofisticada, como um mordomo inglês competente, ritmo pausado: ${texto}` }] }],
        config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || 'Charon' } } } }
      });
      const part = r.candidates && r.candidates[0] && r.candidates[0].content.parts.find(p => p.inlineData);
      if (!part) throw new Error('sem áudio');
      const wav = pcm16ToWav(Buffer.from(part.inlineData.data, 'base64'));
      ttsCache.set(key, wav); if (ttsCache.size > 60) ttsCache.delete(ttsCache.keys().next().value);
      res.type('audio/wav'); res.send(wav);
    } catch (err) {
      console.warn('[Jarvis TTS]', err.message);
      res.status(503).json({ success: false, msg: 'TTS indisponível: ' + err.message });
    }
  });
}
