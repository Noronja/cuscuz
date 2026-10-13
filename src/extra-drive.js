/* Pastas extras do Google Drive (além da raiz principal): varre em segundo plano, guarda em data/extra-manifest.json
   e junta ao catálogo (/acervo-manifest.json e planejador). Precisa de GOOGLE_DRIVE_API_KEY e da pasta compartilhada com "qualquer pessoa com o link". */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXTRA_FILE = path.join(__dirname, '..', 'data', 'extra-manifest.json');
const API = (process.env.DRIVE_API_BASE || 'https://www.googleapis.com').replace(/\/$/, '');
const VIDEO = /\.(mp4|webm|mkv|mov|avi)$/i, DOC = /\.(pdf|docx?|pptx?|xlsx?|txt)$/i;
const limpa = n => String(n || '').replace(/(\.(mp4|webm|mkv|mov|avi|pdf|docx?|pptx?|xlsx?|txt))+$/gi, '').trim();

export const ROOT_PADRAO = '1pVd7V_pfyM4Vw20yfw45jBmNFqtKTHK7';
const idDe = x => (String(x || '').match(/[-\w]{25,}/) || [''])[0];
export const MAIN_ID = () => idDe(process.env.GOOGLE_DRIVE_FOLDER_ID) || ROOT_PADRAO;
/* Se a pasta principal (GOOGLE_DRIVE_FOLDER_ID) não for a antiga, a lista inteira é gerada ao vivo a partir dela; senão vale o catálogo fixo + extras */
export const USA_BASE = () => MAIN_ID() === ROOT_PADRAO;
export const EXTRA_IDS = () => [...new Set(String(process.env.GOOGLE_DRIVE_EXTRA_FOLDERS || '1tIpf5nlW1lspY7BPBsCUqKweULeJHZsP').split(/[,\s]+/).map(idDe).filter(Boolean))].filter(id => id !== MAIN_ID());
export const STATUS = { running: false, at: null, erro: '', pastas: 0, videos: 0, materiais: 0 };

let MEM = null; // catálogo em memória (arquivo lido uma vez; durante a primeira varredura mostra o que já foi achado)
export function lerExtra() {
  if (MEM) return MEM;
  try { MEM = JSON.parse(fs.readFileSync(EXTRA_FILE, 'utf8')); } catch (_) { return { videos: [], materials: [], roots: [] }; }
  return MEM;
}

async function get(url, tent = 3) {
  for (let i = 1; i <= tent; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 700 * i)); continue; }
      if (!r.ok) throw new Error('Drive ' + r.status);
      return await r.json();
    } catch (e) { if (i === tent) throw e; await new Promise(s => setTimeout(s, 700 * i)); }
  }
}
async function filhos(id, key) {
  const todos = []; let tok = '';
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
    const d = await get(`${API}/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,shortcutDetails)&orderBy=folder,name_natural&pageSize=1000&key=${key}${tok ? '&pageToken=' + encodeURIComponent(tok) : ''}`);
    todos.push(...(d.files || [])); tok = d.nextPageToken || '';
  } while (tok);
  return todos;
}

export async function varrerExtras(key = process.env.GOOGLE_DRIVE_API_KEY || '') {
  if (!key) { STATUS.erro = 'GOOGLE_DRIVE_API_KEY ausente'; return null; }
  if (STATUS.running) return null;
  STATUS.running = true; STATUS.erro = '';
  const videos = [], materials = [], roots = [];
  const tinha = !!(lerExtra().videos.length || lerExtra().materials.length);
  try {
    // pastas a varrer: [id, nome fixo do curso | null]. A principal (quando trocada) vira vários cursos, um por subpasta.
    const alvos = [];
    if (!USA_BASE()) {
      const itens = await filhos(MAIN_ID(), key);
      for (const it of itens) {
        const alvoId = it.shortcutDetails && it.shortcutDetails.targetId || it.id;
        const mime = it.shortcutDetails && it.shortcutDetails.targetMimeType || it.mimeType;
        if (mime === 'application/vnd.google-apps.folder') alvos.push({ rid: alvoId, curso: limpa(it.name.trim()) });
        else { const reg = { d: it.name, t: limpa(it.name), id: alvoId, course: 'Geral', path: 'Geral / ' + it.name }; if (/^video\//.test(mime || '') || VIDEO.test(it.name)) videos.push(reg); else if (/pdf|document|presentation|spreadsheet|text/.test(mime || '') || DOC.test(it.name)) materials.push(reg); }
      }
    }
    for (const rid of EXTRA_IDS()) { const meta = await get(`${API}/drive/v3/files/${rid}?fields=id,name&key=${key}`); alvos.push({ rid, curso: limpa(meta.name) || 'Extra' }); }
    for (const { rid, curso } of alvos) {
      roots.push({ id: rid, name: curso });
      const fila = [{ id: rid, partes: [curso] }];
      while (fila.length) {
        const lote = fila.splice(0, 24);
        const res = await Promise.all(lote.map(async f => ({ f, itens: await filhos(f.id, key).catch(e => { STATUS.erro = String(e.message).slice(0, 100); return []; }) })));
        for (const { f, itens } of res) for (const it of itens) {
          const alvoId = it.shortcutDetails && it.shortcutDetails.targetId || it.id;
          const mime = it.shortcutDetails && it.shortcutDetails.targetMimeType || it.mimeType;
          if (mime === 'application/vnd.google-apps.folder') { fila.push({ id: alvoId, partes: [...f.partes, it.name.trim()] }); STATUS.pastas++; continue; }
          const reg = { d: it.name, t: limpa(it.name), id: alvoId, course: curso, path: [...f.partes, it.name].join(' / ') };
          if (/^video\//.test(mime || '') || VIDEO.test(it.name)) videos.push(reg);
          else if (/pdf|document|presentation|spreadsheet|text/.test(mime || '') || DOC.test(it.name)) materials.push(reg);
        }
        if (!tinha) MEM = { generatedAt: 'parcial-' + Date.now(), roots, videos, materials }; // primeira varredura: já mostra o que achou
      }
    }
    fs.mkdirSync(path.dirname(EXTRA_FILE), { recursive: true });
    const pronto = { generatedAt: new Date().toISOString(), roots, videos, materials };
    fs.writeFileSync(EXTRA_FILE, JSON.stringify(pronto)); MEM = pronto;
    Object.assign(STATUS, { at: new Date().toISOString(), videos: videos.length, materiais: materials.length });
    return { videos: videos.length, materials: materials.length };
  } catch (e) { STATUS.erro = String(e.message || e).slice(0, 140); return null; }
  finally { STATUS.running = false; }
}

/* Junta o catálogo principal com o das pastas extras (ids repetidos valem o principal) */
export function juntar(base0) {
  const base = USA_BASE() ? base0 : { ...base0, videos: [], materials: [], courses: [] };
  const ex = lerExtra();
  if (!ex.videos.length && !ex.materials.length) return base;
  const vi = new Set((base.videos || []).map(v => v.id)), mi = new Set((base.materials || []).map(m => m.id));
  return { ...base, videos: [...(base.videos || []), ...ex.videos.filter(v => !vi.has(v.id))], materials: [...(base.materials || []), ...ex.materials.filter(m => !mi.has(m.id))], courses: [...(base.courses || []), ...(ex.roots || []).filter(r => !(base.courses || []).some(c => c.id === r.id))] };
}
