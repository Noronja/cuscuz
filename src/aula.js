// Aula do dia — transcrição de gravações (por trechos) e processamento em material de estudo
import { Type } from '@google/genai';

export function registerAula(app, { generateWithGemini, getGeminiClient }) {
  app.get('/api/aula/status', (_req, res) => res.json({ success: true, gemini: !!getGeminiClient() }));

  // Transcreve um trecho de áudio (já em formato que o navegador gravou)
  app.post('/api/aula/transcrever', async (req, res) => {
    try {
      if (!getGeminiClient()) return res.status(503).json({ success: false, msg: 'Transcrição indisponível: GEMINI_API_KEY não configurada.' });
      const { audio = '', mime = 'audio/webm', disciplina = '', tema = '', anterior = '' } = req.body || {};
      if (!audio || audio.length < 200) return res.status(400).json({ success: false, msg: 'Áudio vazio.' });
      if (audio.length > 28 * 1024 * 1024) return res.status(413).json({ success: false, msg: 'Trecho de áudio grande demais.' });
      const mimeBase = String(mime).split(';')[0] || 'audio/webm';
      const prompt = `Transcreva fielmente este trecho de uma aula de Medicina em português do Brasil${disciplina ? ` (disciplina: ${disciplina}${tema ? ', tema: ' + tema : ''})` : ''}.
Regras: transcreva tudo que o professor e os alunos falam, sem resumir nem corrigir o conteúdo; use pontuação e parágrafos; escreva termos médicos, siglas e nomes de fármacos corretamente; marque trechos incompreensíveis como [inaudível]; ignore ruídos. Se não houver fala, responda apenas: [sem fala]. Não adicione comentários seus.${anterior ? `\nÚltimas palavras do trecho anterior (para continuidade, NÃO repita): «${String(anterior).slice(-300)}»` : ''}`;
      const r = await generateWithGemini({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mimeBase, data: audio } }, { text: prompt }] }], config: { temperature: 0 } });
      let texto = String(r.text || '').trim();
      if (/^\[sem fala\]$/i.test(texto)) texto = '';
      res.json({ success: true, texto });
    } catch (err) {
      console.warn('[Aula transcrever]', err.message);
      const unsupported = /unsupported|invalid.*(mime|argument)|could not.*process|INVALID_ARGUMENT/i.test(err.message);
      res.status(unsupported ? 422 : 500).json({ success: false, msg: err.message, formato: unsupported });
    }
  });

  // Transforma a transcrição completa em material de estudo
  app.post('/api/aula/processar', async (req, res) => {
    try {
      if (!getGeminiClient()) return res.status(503).json({ success: false, msg: 'GEMINI_API_KEY não configurada.' });
      const { transcricao = '', disciplina = '', tema = '', assuntosPlano = [], marcas = [] } = req.body || {};
      const t = String(transcricao).trim();
      if (t.length < 80) return res.status(400).json({ success: false, msg: 'Transcrição curta demais para processar.' });
      const S = Type.STRING;
      const r = await generateWithGemini({
        contents: `Você é um monitor de Medicina. Com base SOMENTE na transcrição da aula abaixo (disciplina: ${disciplina || 'não informada'}${tema ? '; tema: ' + tema : ''}), produza material de estudo fiel ao que foi dito. Não acrescente informação que o professor não tenha dito; se algo parecer errado ou impreciso na fala, sinalize em "duvidas". Português do Brasil.
${assuntosPlano.length ? 'Assuntos esperados na prova (do manual do aluno): ' + JSON.stringify(assuntosPlano.slice(0, 60)) + '. Em "assuntosCobertos" liste, copiando exatamente, apenas os que foram realmente abordados na aula.\n' : ''}${marcas.length ? 'O aluno marcou estes momentos como importantes (mm:ss): ' + marcas.join(', ') + '.\n' : ''}
TRANSCRIÇÃO:
${t.slice(0, 170000)}`,
        config: {
          temperature: 0.3, responseMimeType: 'application/json',
          responseSchema: { type: Type.OBJECT, required: ['titulo', 'resumo', 'topicos'], properties: {
            titulo: { type: S }, resumo: { type: S, description: 'resumo em 5-10 linhas' },
            topicos: { type: Type.ARRAY, items: { type: Type.OBJECT, required: ['titulo', 'pontos'], properties: { titulo: { type: S }, pontos: { type: Type.ARRAY, items: { type: S } } } } },
            termos: { type: Type.ARRAY, items: { type: Type.OBJECT, required: ['termo', 'definicao'], properties: { termo: { type: S }, definicao: { type: S } } } },
            caiNaProva: { type: Type.ARRAY, items: { type: S }, description: 'o que o professor indicou que cai na prova ou enfatizou' },
            flashcards: { type: Type.ARRAY, items: { type: Type.OBJECT, required: ['frente', 'verso'], properties: { frente: { type: S }, verso: { type: S } } } },
            questoes: { type: Type.ARRAY, items: { type: Type.OBJECT, required: ['enunciado', 'alternativas', 'correta', 'explicacao'], properties: { enunciado: { type: S }, alternativas: { type: Type.ARRAY, items: { type: S } }, correta: { type: Type.INTEGER }, explicacao: { type: S } } } },
            duvidas: { type: Type.ARRAY, items: { type: S } },
            assuntosCobertos: { type: Type.ARRAY, items: { type: S } }
          } }
        }
      });
      const j = JSON.parse(String(r.text).trim());
      j.assuntosCobertos = (j.assuntosCobertos || []).filter(a => assuntosPlano.includes(a));
      j.flashcards = (j.flashcards || []).slice(0, 30);
      j.questoes = (j.questoes || []).filter(q => Array.isArray(q.alternativas) && q.alternativas.length >= 2 && q.correta >= 0 && q.correta < q.alternativas.length).slice(0, 10);
      res.json({ success: true, resultado: j });
    } catch (err) {
      console.error('[Aula processar]', err);
      res.status(500).json({ success: false, msg: err.message });
    }
  });
}
