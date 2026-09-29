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

1. No `.env`, defina `HARDWORQ_EMAIL` e `HARDWORQ_SENHA` (credenciais da conta Hardworq). O servidor faz login via `PUT /login`, guarda o token do aluno (header `UserToken`) e o renova automaticamente quando a sessão cair (`auth:false`). O token é persistido em `data/hwq-token.json`, então a sessão continua válida entre restarts ("logado pra sempre" — sem cookie, sem intervenção). O antigo `HARDWORQ_COOKIE` ainda é aceito, mas não é mais necessário.
2. No app: **Treino → "Sincronizar Hardworq"** — escolha áreas, grupos de prova (R1/R3/REVALIDA), anos e quantidade (10 a 1000, ou "Tudo": busca em rodadas de 100 até esgotar questões novas, teto de 5000).
3. Opcional: `HARDWORQ_AUTO_SYNC=1` liga o alimentador em segundo plano (a cada `HARDWORQ_SYNC_INTERVAL_H` horas, até `HARDWORQ_MAX_BANK` questões).
4. Ao resolver uma questão do Hardworq no simulador, a resposta é registrada na API (`POST /banco/questoes/{turma}/{questao}/{alternativa}/false`) automaticamente.

Endpoints no servidor: `GET /api/questions/hardworq/status`, `POST /api/questions/hardworq/sync`, `POST /api/questions/hardworq/answer`, `GET /api/questions/hardworq/aluno`, `POST /api/questions/import-hardworq` (compatibilidade; aceita JSON colado).
