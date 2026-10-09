// Baixa o banco de questões do Hardworq inteiro (todas as doenças do catálogo) e grava data/questions-bank.json.gz
// Uso: HARDWORQ_EMAIL=... HARDWORQ_SENHA=... node scripts/baixar-banco.mjs   (roda no GitHub Actions ou no seu PC)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAIN = path.join(raiz, 'data', 'questions-bank.json');
const GZ = PLAIN + '.gz';
const PORT = 3999, BASE = `http://127.0.0.1:${PORT}`;
const LIMITE_MS = (parseFloat(process.env.BANCO_TIMEOUT_H) || 5) * 3600 * 1000;
if (!process.env.HARDWORQ_EMAIL || !process.env.HARDWORQ_SENHA) { console.log('Sem HARDWORQ_EMAIL/HARDWORQ_SENHA neste ambiente: nada a fazer (o Render já publica o banco sozinho com GITHUB_TOKEN).'); process.exit(0); }

const contar = f => { try { return JSON.parse(fs.existsSync(f) ? (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString() : fs.readFileSync(f, 'utf8')) : '[]').length; } catch { return 0; } };
const antes = Math.max(contar(PLAIN), contar(GZ));
try { fs.rmSync(path.join(raiz, 'data', 'hwq-mirror.json')); } catch {}
console.log('Questões antes:', antes);

const senhaApp = crypto.randomBytes(12).toString('hex');
const srv = spawn('node', ['server.js'], {
  cwd: raiz, stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, PORT: String(PORT), APP_PASSWORD: senhaApp, HARDWORQ_MIRROR: '1', HARDWORQ_MIRROR_MAX: process.env.HARDWORQ_MIRROR_MAX || '80000', HARDWORQ_MIRROR_PAUSE_S: process.env.HARDWORQ_MIRROR_PAUSE_S || '1', HARDWORQ_AUTO_SYNC: '0' }
});
const parar = () => new Promise(ok => { srv.once('exit', ok); srv.kill('SIGTERM'); setTimeout(() => { try { srv.kill('SIGKILL'); } catch {} ok(); }, 20000); });
const dorme = ms => new Promise(r => setTimeout(r, ms));

let token = '';
for (let i = 0; i < 40 && !token; i++) {
  await dorme(1500);
  try { const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: senhaApp }) }); token = (await r.json()).token || ''; } catch {}
}
if (!token) { console.error('Servidor não subiu.'); await parar(); process.exit(1); }

const t0 = Date.now(); let ultimoIdx = -1, parado = 0, falhou = '';
while (Date.now() - t0 < LIMITE_MS) {
  await dorme(30000);
  let m; try { m = await (await fetch(BASE + '/api/questions/mirror', { headers: { Authorization: 'Bearer ' + token } })).json(); } catch { continue; }
  console.log(`[${Math.round((Date.now() - t0) / 60000)} min] doença ${m.idx}/${m.total} · banco ${m.bankCount} · novas ${m.novas} · volta ${m.passes}${m.erro ? ' · ' + m.erro : ''}`);
  if (m.passes >= 1 && !m.running) break;
  parado = m.idx === ultimoIdx ? parado + 1 : 0; ultimoIdx = m.idx;
  if (parado >= 20) { falhou = 'sem progresso por 10 min: ' + (m.erro || 'desconhecido'); break; }
}
await parar();
const depois = contar(PLAIN);
console.log('Questões depois:', depois);
if (falhou && depois <= antes) { console.error('Falhou:', falhou); process.exit(1); }
if (depois < antes * 0.9) { console.error('Banco novo menor que 90% do anterior — não vou sobrescrever.'); process.exit(1); }
fs.writeFileSync(GZ, zlib.gzipSync(fs.readFileSync(PLAIN), { level: 9 }));
fs.rmSync(PLAIN);
console.log('Gravado', GZ, Math.round(fs.statSync(GZ).size / 1048576 * 10) / 10, 'MB');
