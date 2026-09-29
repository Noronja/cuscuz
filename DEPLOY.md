# Deploy do Cuscuz-MED (backend + app) no Render — grátis

O GitHub Pages só hospeda arquivos estáticos — o `server.js` (sync do Hardworq, gerador
Gemini, tutor, chat) precisa de um servidor Node de verdade. O **Render.com** conecta
direto neste repositório e sobe tudo: app + API no mesmo endereço.

## Passo a passo (5 minutos, uma vez só)

1. Acesse [render.com](https://render.com) → **Get Started** → entre com a sua conta **GitHub**.
2. Aceite o plano **Free** (pede cartão? não pede para o plano free).
3. Clique em **New + → Blueprint** e escolha o repositório **Noronja/cuscuz**.
   (O arquivo `render.yaml` deste repo já configura tudo: Node 22, build, health check.)
4. O Render vai pedir o valor das variáveis marcadas:
   - `HARDWORQ_EMAIL` / `HARDWORQ_SENHA` → as credenciais da sua conta Hardworq
     (não ficam no GitHub; ficam só no serviço)
   - `GEMINI_API_KEY` → se tiver, cola a sua (ativa o gerador de questões e o tutor IA)
   - `OPENAI_API_KEY` / `SUPABASE_URL` / `SUPABASE_ANON_KEY` → opcionais
5. **Apply** e aguarde o build (~2 min). O log mostra `🔑 [Hardworq] Login ok` quando a
   sessão subir.
6. Pronto: o app fica em `https://cuscuz-med-XXXX.onrender.com` — use esse endereço.

## O que esperar do plano free

- **Cold start**: após 15 min sem acesso, o serviço "dorme" e a primeira visita demora
  ~50 s para acordar. As visitas seguintes são instantâneas.
- **Arquivos temporários**: questões sincronizadas e o token de sessão vivem no disco do
  serviço e são recriados a cada reinício/depura. O banco volta com as questões commitadas
  no repo (o `.json` vai junto do deploy) e o login do Hardworq se refaz sozinho — as
  credenciais estão nas variáveis de ambiente.
- **Banco persistente de verdade**: para questões sincronizadas sobreviverem a reinícios,
  faça commit do `data/questions-bank.json` de tempos em tempos (posso automatizar),
  ou use um plano pago com disco, ou rode local no seu PC.

## Alternativas

- **PC ligado + túnel** (Cloudflare Tunnel/ngrok): grátis e com seus arquivos locais, mas
  exige o PC sempre ligado.
- **Render pago (~US$ 7/mês)**: sem cold start e com disco persistente.

Depois do deploy, o GitHub Pages pode ficar como vitrine ou ser desativado em
Settings → Pages — o endereço do Render é o app completo.
