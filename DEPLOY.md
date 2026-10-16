# Deploy do Cuscuz-MED (backend + app) no Railway.app — grátis

O GitHub Pages só hospeda arquivos estáticos — o `server.js` (sync do Hardworq, gerador Gemini, tutor, chat) precisa de um servidor Node de verdade. O **Railway.app** conecta direto neste repositório e sobe tudo: app + API no mesmo endereço.

## Passo a passo (5 minutos, uma vez só)

1. Acesse [railway.app](https://railway.app) → **Get Started** → entre com a sua conta **GitHub**.
2. Clique em **New Project** → **Deploy from Repo** e escolha o repositório **Noronja/cuscuz** (ou seu fork).
3. O Railway vai detectar automaticamente que é um projeto Node.js e definir o comando de start como `npm start` (que executa `node server.js`).
4. Clique em **Deploy** e aguarde o build (~2 min).
5. Após o deploy inicial, o Railway vai pedir o valor das variáveis de ambiente necessárias. Vá em **Variables** e adicione:
    - `HARDWORQ_EMAIL` / `HARDWORQ_SENHA` → as credenciais da sua conta Hardworq
      (não ficam no GitHub; ficam só no serviço)
    - `GEMINI_API_KEY` → se tiver, cola a sua (ativa o gerador de questões e o tutor IA)
    - `OPENAI_API_KEY` / `SUPABASE_URL` / `SUPABASE_ANON_KEY` → opcionais
    - `APP_PASSWORD` → (opcional) senha para proteção de acesso ao app
    - Variáveis do Hardworq adicionais (se necessário):
      - `HARDWORQ_ID_TURMA` (padrão: "1273")
      - `HARDWORQ_AUTO_SYNC` (padrão: "0")
      - `HARDWORQ_SYNC_INTERVAL_H` (padrão: "6")
      - `HARDWORQ_MAX_BANK` (padrão: "2000")
      - `HARDWORQ_MIRROR` (padrão: "1")
      - `HARDWORQ_MIRROR_MAX` (padrão: "25000")
    - `GITHUB_TOKEN` → Token do GitHub (Fine-grained, Contents: read and write neste repositório) para o servidor publicar o banco catalogado (opcional, mas recomendado para atualização automática do banco)
6. Aguarde o deploy. O log mostrará `🔑 [Hardworq] Login ok` quando a sessão subir.
7. Pronto: o app fica em algo como `https://cuscuz-med-production.up.railway.app` — use esse endereço.

## O que esperar no Railway

- **Sleeping (pausa gratuita)**: após 1 hora sem acesso (no plano gratuito), o serviço "dorme" e a primeira visita demora ~30-50s para acordar. As visitas seguintes são instantâneas enquanto ativo.
- **Arquivos temporários**: questões sincronizadas e o token de sessão vivem no disco do serviço e são recriados a cada reinício/depura. O banco volta com as questões commitadas no repo (o `.json` vai junto do deploy) e o login do Hardworq se refaz sozinho — as credenciais estão nas variáveis de ambiente.
- **Banco persistente**: para questões sincronizadas sobreviverem a reinícios, você pode:
  a) Fazer commit do `data/questions-bank.json` de tempos em tempos ( pode automatizar com o workflow do GitHub Actions)
  b) Usar um plano pago do Railway com persistência de disco
  c) Rodar local no seu PC

## Variáveis de ambiente importantes

Variáveis que podem ser configuradas no Railway (aba Variables):

| Variável | Descrição | Obrigatório? |
|----------|-----------|--------------|
| `HARDWORQ_EMAIL` | Login do Hardworq | Sim (para banco de questões) |
| `HARDWORQ_SENHA` | Senha do Hardworq | Sim (para banco de questões) |
| `GEMINI_API_KEY` | Chave da API do Google Gemini | Não (ativa recursos de IA) |
| `OPENAI_API_KEY` | Chave da API da OpenAI | Não (opcional) |
| `SUPABASE_URL` | URL do Supabase | Não (opcional) |
| `SUPABASE_ANON_KEY` | Chave anonima do Supabase | Não (opcional) |
| `APP_PASSWORD` | Senha de proteção do app | Não (recomendado para acesso restrito) |
| `GITHUB_TOKEN` | Token do GitHub para publicar banco | Não (recomendado para atualização automática) |
| `HARDWORQ_ID_TURMA` | ID da turma no Hardworq | Não (padrão: "1273") |
| `HARDWORQ_AUTO_SYNC` | Sincronização automática do Hardworq | Não (padrão: "0") |
| `HARDWORQ_SYNC_INTERVAL_H` | Intervalo de sync em horas | Não (padrão: "6") |
| `HARDWORQ_MAX_BANK` | Número máximo de questões no banco | Não (padrão: "2000") |
| `HARDWORQ_MIRROR` | Ativar espelho contínuo do banco | Não (padrão: "1") |
| `HARDWORQ_MIRROR_MAX` | Limite máximo do espelho | Não (padrão: "25000") |
| `NODE_VERSION` | Versão do Node.js | Não (padrão: "22.14.0") |

## Notas importantes

- O projeto usa Node.js versão 22 (definida implicitamente pelo package.json ou pode ser definida com NODE_VERSION)
- O comando de start é `npm start` (equivalente a `node server.js`)
- Não é necessário um Procfile ou arquivo de configuração especial; o Railway detecta automaticamente projetos Node
- O health check não é configurado por padrão, mas o endpoint `/api/health` existe no servidor

## Depois do deploy

Seu app estará disponível em um subdomínio da railway.app (como no exemplo: https://cuscuz-med-production.up.railway.app/)

Você pode conectar um domínio personalizado nas settings do serviço no Railway, se desejar.

O GitHub Pages pode continuar servindo como vitrine estática ou ser desativado em Settings → Pages — o endereço do Railway é o app completo com backend e frontend.