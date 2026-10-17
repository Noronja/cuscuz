import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { driveFetch, cleanDriveId } from './src/drive-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Em hospedagens (Render, Railway...) a porta vem do ambiente; 3000 é o padrão local
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '0.0.0.0';

// Drive API configuration
const DRIVE_OK = !!process.env.GOOGLE_DRIVE_API_KEY;
const DRIVE_ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

// Healthcheck endpoint para o Railway
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', drive: DRIVE_OK ? 'configured' : 'missing_key', timestamp: new Date().toISOString() });
});

// Busca materiais (PDFs e apostilas HTML) no Drive navegando na estrutura:
// curso > disciplina > aula > subpasta "Apostila"
// Suporta fallback: se aulaId for um arquivo dentro de subpasta (ex: Vídeo aula),
// sobe para a pasta pai da aula e procura a subpasta "Apostila" lá.
app.get('/api/drive/materials', async (req, res) => {
  const course = (req.query.course || '').trim();
  const disc = (req.query.disc || '').trim();
  const aula = (req.query.aula || '').trim();
  if (!course || !disc) return res.status(400).json({ error: 'course e disc são obrigatórios', materials: [] });
  if (!DRIVE_OK) return res.status(503).json({ error: 'GOOGLE_DRIVE_API_KEY ausente', materials: [] });

  // Normaliza texto (remove acentos, caixa baixa, caracteres especiais)
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const limpaTnome = n => norm(String(n || ''));

  try {
    const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID || DRIVE_ROOT_FOLDER_ID;
    const cleanRoot = cleanDriveId(rootId);
    if (!cleanRoot) return res.json({ materials: [], hint: 'GOOGLE_DRIVE_FOLDER_ID não configurado' });

    // Helper para listar filhos de uma pasta
    async function listFolder(folderId) {
      const files = [];
      let pageToken = '';
      do {
        const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
        const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,shortcutDetails,webViewLink,parents)');
        const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
        const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=folder,name_natural&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageParam}`;
        const r = await driveFetch(url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) break;
        const data = await r.json();
        if (data.files) files.push(...data.files);
        pageToken = data.nextPageToken || '';
      } while (pageToken);
      return files;
    }

    // Helper para obter metadata de um arquivo/pasta (inclui parents)
    async function getFileMeta(fileId) {
      const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,shortcutDetails,webViewLink,parents&supportsAllDrives=true&includeItemsFromAllDrives=true`;
      const r = await driveFetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      return r.json();
    }

    // Helper para verificar se um nome é pasta "Apostila"
    function isApostilaFolder(name) {
      const n = String(name || '').toLowerCase();
      return n.includes('apostila') || n === 'apostilas';
    }

    // Helper para verificar se arquivo é PDF ou HTML
    function classifyFile(f) {
      const nome = String(f.name || '');
      const nomeNorm = norm(nome);
      const isShortcut = f.mimeType === 'application/vnd.google-apps.shortcut';
      const effectiveId = isShortcut && f.shortcutDetails?.targetId ? f.shortcutDetails.targetId : f.id;
      const effectiveMime = isShortcut && f.shortcutDetails?.targetMimeType ? f.shortcutDetails.targetMimeType : f.mimeType;
      const isFolder = effectiveMime === 'application/vnd.google-apps.folder';

      const pdfExt = /\.(pdf|doc|docx)$/i;
      const htmlExt = /\.(html?|htm)$/i;

      const isPdf = !isFolder && (!nomeNorm.match(htmlExt)) && (pdfExt.test(nome) || /pdf|document|presentation/i.test(effectiveMime));
      const isHtml = !isFolder && (htmlExt.test(nome) || /html/i.test(effectiveMime));

      return { nome, nomeNorm, isShortcut, effectiveId, effectiveMime, isFolder, isPdf, isHtml };
    }

    // Processa uma pasta de aula: procura subpasta "Apostila" ou arquivos soltos
    async function processarPastaAula(aulaFolderId, aulaNome) {
      const aulaFiles = await listFolder(aulaFolderId);
      const apostilaPasta = aulaFiles.find(f => (f.mimeType === 'application/vnd.google-apps.folder' || f.isFolder) && isApostilaFolder(f.name));

      let arquivosParaProcessar = [];

      if (apostilaPasta) {
        const apostilaFolderId = apostilaPasta.shortcutDetails?.targetId || apostilaPasta.id;
        const apostilaFiles = await listFolder(apostilaFolderId);
        arquivosParaProcessar = apostilaFiles;
      } else {
        arquivosParaProcessar = aulaFiles.filter(f => {
          const { isFolder, isPdf, isHtml } = classifyFile(f);
          return !isFolder && (isPdf || isHtml);
        });
      }

      const resultados = [];
      for (const f of arquivosParaProcessar) {
        const { nome, nomeNorm, isShortcut, effectiveId, effectiveMime, isFolder, isPdf, isHtml } = classifyFile(f);
        if (isFolder) continue;
        if (!isPdf && !isHtml) continue;

        resultados.push({
          id: effectiveId,
          nome: nome.replace(/\.(pdf|html?|htm|doc|docx)$/i, '').trim(),
          rawName: nome,
          mimeType: effectiveMime,
          isFolder: false,
          isPdf,
          isHtml,
          curso,
          disc,
          aulaId: aulaFolderId,
          aulaNome,
          webViewLink: f.webViewLink || `https://drive.google.com/file/d/${effectiveId}/preview`
        });
      }
      return resultados;
    }

    // 1. Encontrar a pasta do curso na raiz do Drive
    const rootFiles = await listFolder(cleanRoot);
    const cursoPasta = rootFiles.find(f => {
      const nome = String(f.name || '').toLowerCase();
      const c = String(course || '').toLowerCase();
      return nome.includes(c) || c.includes(nome) || limpaTnome(f.name) === limpaTnome(course);
    });

    if (!cursoPasta) return res.json({ materials: [], hint: 'Pasta do curso não encontrada no Drive' });

    const cursoId = cursoPasta.shortcutDetails?.targetId || cursoPasta.id;

    // 2. Encontrar a pasta da disciplina dentro do curso
    const cursoFiles = await listFolder(cursoId);
    const discNorm = norm(disc);

    const discPasta = cursoFiles.find(f => {
      if (f.mimeType !== 'application/vnd.google-apps.folder' && !f.isFolder) return false;
      const nome = String(f.name || '').toLowerCase();
      const nNorm = norm(nome);
      return nNorm.includes(discNorm) || discNorm.includes(nNorm.replace(/\.(pdf|html?|htm|doc|docx)$/i, '')) || limpaTnome(f.name) === limpaTnome(disc);
    });

    if (!discPasta) return res.json({ materials: [], hint: 'Pasta da disciplina não encontrada no Drive' });

    const discFolderId = discPasta.shortcutDetails?.targetId || discPasta.id;

    // 3. Listar subpastas da disciplina (as aulas)
    const discFiles = await listFolder(discFolderId);
    const aulaPastas = discFiles.filter(f => f.mimeType === 'application/vnd.google-apps.folder' || f.isFolder);

    // 4. Determinar qual pasta de aula usar
    let targetAulaPasta = null;

    if (aula) {
      // 4a. Tentar encontrar a aula por nome direto
      const aulaNorm = norm(aula);
      const encontradaPorNome = aulaPastas.find(f => {
        const nome = String(f.name || '').toLowerCase();
        const nNorm = norm(nome);
        return nNorm.includes(aulaNorm) || aulaNorm.includes(nNorm) || limpaTnome(f.name) === limpaTnome(aula);
      });

      if (encontradaPorNome) {
        targetAulaPasta = encontradaPorNome;
      } else {
        // 4b. Fallback: o aulaId pode ser um arquivo dentro de uma subpasta da aula
        // (ex: usuário está na subpasta "Vídeo aula", clicou em um vídeo)
        try {
          const meta = await getFileMeta(aula);
          if (meta && meta.parents && meta.parents.length > 0) {
            const parentId = meta.parents[0];
            // Verificar se esse parent é uma das aulas da disciplina
            const paiEhAula = aulaPastas.find(f => {
              const fid = f.shortcutDetails?.targetId || f.id;
              return fid === parentId;
            });
            if (paiEhAula) {
              targetAulaPasta = paiEhAula;
            } else {
              // O parent pode ser uma subpasta dentro da aula (ex: "Vídeo aula")
              // Precisamos subir mais um nível: verificar se o parent do parent é uma aula
              const metaPai = await getFileMeta(parentId);
              if (metaPai && metaPai.parents && metaPai.parents.length > 0) {
                const avôId = metaPai.parents[0];
                const avoEhAula = aulaPastas.find(f => {
                  const fid = f.shortcutDetails?.targetId || f.id;
                  return fid === avôId;
                });
                if (avoEhAula) {
                  targetAulaPasta = avoEhAula;
                }
              }
            }
          }
        } catch (e) {
          console.warn('[Drive Materials] Falha ao obter meta do arquivo aula:', e.message);
        }

        if (!targetAulaPasta) {
          // Fallback final: não conseguimos identificar a aula específica,
          // sinaliza para usar todas as aulas abaixo
          targetAulaPasta = null;
        }
      }
    }

    if (!targetAulaPasta) {
      // Retornar materiais de todas as aulas da disciplina (fallback quando
      // não conseguimos identificar a aula específica pelo ID do arquivo)
      const materials = [];
      for (const aulaPasta of aulaPastas) {
        const aulaFolderId = aulaPasta.shortcutDetails?.targetId || aulaPasta.id;
        const aulaNome = aulaPasta.name || 'Aula sem nome';
        const mats = await processarPastaAula(aulaFolderId, aulaNome);
        materials.push(...mats);
      }
      const uniq = materials.filter((m, idx, self) => idx === self.findIndex(m2 => m2.id === m.id));
      return res.json({ materials: uniq, total: uniq.length, course, disc, aula: null, source: 'drive-all-aulas' });
    }

    // 5. Processar a pasta da aula encontrada
    const aulaFolderId = targetAulaPasta.shortcutDetails?.targetId || targetAulaPasta.id;
    const aulaNome = targetAulaPasta.name || 'Aula sem nome';
    const materials = await processarPastaAula(aulaFolderId, aulaNome);

    return res.json({ materials, total: materials.length, course, disc, aula: aula, source: 'drive-recursive' });
  } catch (err) {
    console.error('[Drive Materials]', err.message);
    return res.status(500).json({ error: err.message, materials: [] });
  }
});

// Iniciar o servidor
app.listen(PORT, HOST, () => {
  console.log(`🚀 Cuscuz-MED server running on http://${HOST}:${PORT}`);
});
