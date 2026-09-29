# Cuscuz-MED (estyflow)

App de preparação para residência médica: acervo (Drive), treino livre com banco de questões, gerador Gemini, flashcards SRS e simulados.

## Rodar

```bash
npm install
cp .env.example .env   # preencha as chaves
npm run dev            # http://localhost:3000
```

## Integração Hardworq (banco de questões oficial)

O Treino Livre consome a API `extensivo.hardworkmedicina.api.br` e mescla as questões em `data/questions-bank.json` (gabarito, dedupe por id e atualização de questões já existentes).

1. No `.env`, defina `HARDWORQ_ID_TURMA` (padrão: 1273) e `HARDWORQ_COOKIE` com o cookie de sessão do Hardworq logado (F12 → Application → Cookies → `session-id=...`). A sessão expira em algumas horas — quando a API responder `auth:false`, copie o cookie novamente.
2. No app: **Treino → "Sincronizar Hardworq"** — escolha áreas, grupos de prova (R1/R3/REVALIDA), anos e quantidade, e clique em "Buscar e importar".
3. Opcional: `HARDWORQ_AUTO_SYNC=1` liga o alimentador em segundo plano (a cada `HARDWORQ_SYNC_INTERVAL_H` horas, até `HARDWORQ_MAX_BANK` questões).
4. Ao resolver uma questão do Hardworq no simulador, a resposta é registrada na API (`POST /banco/questoes/{turma}/{questao}/{alternativa}/false`) automaticamente.

Endpoints no servidor: `GET /api/questions/hardworq/status`, `POST /api/questions/hardworq/sync`, `POST /api/questions/hardworq/answer`, `GET /api/questions/hardworq/aluno`, `POST /api/questions/import-hardworq` (compatibilidade; aceita JSON colado).
