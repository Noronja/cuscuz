import { Type } from '@google/genai';
import * as PE from './planner-engine.js';

const hojeBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
const okHoje = h => (/^\d{4}-\d{2}-\d{2}$/.test(h || '') ? h : hojeBR());

const PERFIL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    objetivo: { type: Type.STRING, description: 'graduacao | residencia | ambos (vazio se não informado)' },
    alvo: { type: Type.STRING }, dataProva: { type: Type.STRING, description: 'YYYY-MM-DD' }, semData: { type: Type.BOOLEAN },
    provasFaculdade: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { disciplina: { type: Type.STRING }, data: { type: Type.STRING }, assuntos: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['disciplina', 'data'] } },
    semProvas: { type: Type.BOOLEAN },
    horas: { type: Type.ARRAY, items: { type: Type.INTEGER }, description: '7 valores em minutos: domingo..sábado' },
    dificuldades: { type: Type.ARRAY, items: { type: Type.STRING } }, fortes: { type: Type.ARRAY, items: { type: Type.STRING } }, semDificuldades: { type: Type.BOOLEAN },
    metodo: { type: Type.STRING, description: 'aulas | resumos | questoes | equilibrado' },
    cursos: { type: Type.ARRAY, items: { type: Type.STRING } },
    anseios: { type: Type.STRING, description: 'restrições, rotina, preferências ou desejos livres ditos agora' }
  }
};

export function registerPlanner(app, { generateWithGemini, getGeminiClient }) {
  // GET /api/planner/v2/catalogo — o que existe no acervo
  app.get('/api/planner/v2/catalogo', (_req, res) => res.json({ success: true, ...PE.resumoCatalogo() }));

  // POST /api/planner/chat — entrevista adaptativa
  app.post('/api/planner/chat', async (req, res) => {
    const hoje = okHoje(req.body && req.body.hoje);
    try {
      const msgs = Array.isArray(req.body.messages) ? req.body.messages.slice(-14).map(m => ({ role: m.role === 'user' ? 'user' : 'model', content: String(m.content || '').slice(0, 1500) })) : [];
      let perfil = PE.sanePerfil(req.body.perfil || null, {});
      const asking = req.body.asking || '';
      const ultima = [...msgs].reverse().find(m => m.role === 'user');
      const jaExtras = !!req.body.jaExtras;
      let usouIA = false, reply = '', quick = [], extrasPerguntado = jaExtras;

      if (ultima && getGeminiClient()) {
        try {
          const falta = PE.faltando(perfil);
          const sistema = `Você é o mentor de estudos de um estudante de medicina brasileiro, dentro do app Cuscuz-MED. Hoje é ${hoje}. Conduza uma CONVERSA curta e natural (português do Brasil, tom próximo, sem enrolação) para montar um cronograma 100% personalizado.
Regras:
- Faça UMA pergunta por vez. Reconheça brevemente o que o aluno disse e adapte a próxima pergunta às respostas e anseios dele (cansaço, plantão, estágio, medo de uma matéria, etc.).
- Extraia tudo que ele disse para o campo "perfil" (apenas o que mudou). Datas em YYYY-MM-DD (ano atual ${hoje.slice(0, 4)} salvo indicação). horas = 7 inteiros em minutos [domingo, segunda, ..., sábado]. Se disser "não sei a data" use semData=true; "sem provas" semProvas=true; "sem dificuldade" semDificuldades=true.
- Matérias válidas do acervo: ${PE.DISCS.filter(d => d.peso > 0).map(d => d.nome).join(', ')}. Cursos: MEDCURSO, Estratégia, APOSTILAS.
- Campos essenciais ainda faltando: ${falta.length ? falta.join(', ') : 'nenhum'} (prova=prova de residência e data; faculdade=provas da graduação com datas; horas; dificuldades; metodo=aulas/resumos/questoes/equilibrado).
- Se faltar algo essencial, pergunte o primeiro que falta (a menos que o aluno tenha levantado algo urgente). Se nada falta, faça um resumo de 2 linhas do que entendeu e pergunte se quer ajustar algo antes de gerar; quickReplies = ["Gerar meu cronograma", "Quero ajustar algo"].
- Nunca invente aulas, links ou datas. Não prometa resultados. quickReplies: no máximo 4 respostas curtas e úteis para a sua pergunta.
Perfil atual (JSON): ${JSON.stringify(perfil)}`;
          const r = await generateWithGemini({
            contents: msgs.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
            config: {
              systemInstruction: sistema, temperature: 0.6, responseMimeType: 'application/json',
              responseSchema: { type: Type.OBJECT, properties: { reply: { type: Type.STRING }, perfil: PERFIL_SCHEMA, quickReplies: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['reply', 'perfil'] }
            }
          });
          const j = JSON.parse(r.text.trim());
          if (j && typeof j.reply === 'string' && j.reply.trim()) {
            perfil = PE.sanePerfil(perfil, j.perfil || {});
            reply = j.reply.trim().slice(0, 1200);
            quick = (Array.isArray(j.quickReplies) ? j.quickReplies : []).map(q => String(q).slice(0, 60)).slice(0, 4);
            usouIA = true;
          }
        } catch (e) { console.warn('[Planner chat] IA indisponível, usando roteiro:', e.message); }
      }
      if (!usouIA) {
        if (ultima && asking) {
          const patch = PE.interpretarResposta(asking, ultima.content, hoje);
          if (asking === 'extras') extrasPerguntado = true;
          perfil = PE.sanePerfil(perfil, patch);
          if (!Object.keys(patch).length && asking !== 'extras') {
            const q = PE.proximaPergunta(perfil, extrasPerguntado);
            return res.json({ success: true, ia: false, perfil, asking: q ? q.campo : '', jaExtras: extrasPerguntado, reply: 'Não consegui entender essa resposta. ' + (q ? q.reply : ''), quickReplies: q ? q.quick : [], pronto: false, resumo: PE.resumoPerfil(perfil) });
          }
        }
        const q = PE.proximaPergunta(perfil, extrasPerguntado);
        if (q) { reply = q.reply; quick = q.quick; extrasPerguntado = extrasPerguntado || q.campo === 'extras'; return res.json({ success: true, ia: false, perfil, asking: q.campo, jaExtras: extrasPerguntado, reply: (ultima ? 'Anotado. ' : '') + reply, quickReplies: quick, pronto: false, resumo: PE.resumoPerfil(perfil) }); }
        reply = 'Perfeito, já tenho o que preciso. Confira o resumo abaixo e, se estiver certo, gere o cronograma.';
        quick = ['Gerar meu cronograma', 'Quero ajustar algo'];
      }
      const pronto = PE.faltando(perfil).length === 0 && (usouIA ? /gerar|ajust|resum|confer|certo/.test(reply.toLowerCase()) || msgs.length >= 8 : true);
      res.json({ success: true, ia: usouIA, perfil, asking: '', jaExtras: true, reply, quickReplies: quick, pronto: PE.faltando(perfil).length === 0 && pronto, resumo: PE.resumoPerfil(perfil) });
    } catch (err) {
      res.status(500).json({ success: false, msg: err.message });
    }
  });

  // POST /api/planner/generate-tasks — cronograma real (aulas, PDFs, questões) a partir do perfil
  app.post('/api/planner/generate-tasks', (req, res) => {
    try {
      const hoje = okHoje(req.body.hoje);
      const perfil = PE.sanePerfil(null, req.body.perfil || {});
      if (!perfil.objetivo) return res.status(400).json({ success: false, msg: 'Perfil incompleto: falta o objetivo.' });
      const retidas = Array.isArray(req.body.retidas) ? req.body.retidas.filter(t => t && t.data && t.data < hoje && t.status === 'feito').slice(0, 2000) : [];
      const dias = req.body.dias ? Math.max(7, Math.min(120, +req.body.dias)) : undefined;
      const plan = PE.gerarTarefas({ perfil: { ...perfil, horas: perfil.horas || null }, hoje, inicio: hoje, dias, retidas });
      plan.tarefas.forEach(t => delete t._vids);
      res.json({ success: true, plan });
    } catch (err) {
      console.error('[Planner generate-tasks]', err);
      res.status(500).json({ success: false, msg: err.message });
    }
  });

  // POST /api/planner/enrich — IA reescreve passos/observações das tarefas com foco específico no tema
  app.post('/api/planner/enrich', async (req, res) => {
    try {
      if (!getGeminiClient()) return res.json({ success: true, ia: false, itens: {} });
      const tarefas = (Array.isArray(req.body.tarefas) ? req.body.tarefas : []).filter(t => t && t.tipo === 'estudo').slice(0, 10);
      const p = PE.sanePerfil(null, req.body.perfil || {});
      if (!tarefas.length) return res.json({ success: true, ia: true, itens: {} });
      const entrada = tarefas.map(t => ({ id: t.id, materia: t.materia, tema: t.tema, titulo: t.titulo, passos: (t.passos || []).map(s => ({ acao: s.acao, minutos: s.minutos })) }));
      const r = await generateWithGemini({
        contents: `Aluno de medicina. Preferências/anseios: ${JSON.stringify({ objetivo: p.objetivo, metodo: p.metodo, dificuldades: p.dificuldades, anseios: p.anseios })}.
Para cada tarefa, reescreva o texto de cada passo (mesma ordem e mesmo "acao") de forma ESPECÍFICA para o tema: o que prestar atenção na aula, o que resumir, que tipo de questão treinar e quais cartões criar. Seja concreto e conciso (1–2 frases por passo), sem inventar doses, números ou links. Em "observacoes" explique em 1–2 frases o que costuma ser cobrado em prova sobre o tema e uma dica de estratégia.
Tarefas: ${JSON.stringify(entrada)}`,
        config: {
          temperature: 0.5, responseMimeType: 'application/json',
          responseSchema: { type: Type.OBJECT, properties: { itens: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, passos: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { acao: { type: Type.STRING }, texto: { type: Type.STRING } }, required: ['acao', 'texto'] } }, observacoes: { type: Type.STRING } }, required: ['id', 'passos', 'observacoes'] } } }, required: ['itens'] }
        }
      });
      const j = JSON.parse(r.text.trim());
      const itens = {};
      for (const it of j.itens || []) {
        const orig = tarefas.find(t => t.id === it.id);
        if (!orig || !Array.isArray(it.passos) || it.passos.length !== orig.passos.length) continue;
        if (!it.passos.every((s, i) => s.acao === orig.passos[i].acao && String(s.texto || '').length > 15)) continue;
        itens[it.id] = { passos: it.passos.map(s => String(s.texto).slice(0, 500)), observacoes: String(it.observacoes || '').slice(0, 500) };
      }
      res.json({ success: true, ia: true, itens });
    } catch (err) {
      console.warn('[Planner enrich]', err.message);
      res.json({ success: true, ia: false, itens: {} });
    }
  });
}
