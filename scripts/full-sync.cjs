const fs = require('fs');
const path = require('path');

const DRIVE_API_KEY = process.env.GOOGLE_DRIVE_API_KEY || '';
const DRIVE_ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '1pVd7V_pfyM4Vw20yfw45jBmNFqtKTHK7';

async function fetchChildren(folderId) {
  let all = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const p = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,webViewLink,shortcutDetails)&orderBy=folder,name_natural&pageSize=1000&key=${DRIVE_API_KEY}${p}`;
    
    let res;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        res = await fetch(url);
        if (res.status === 429 || res.status >= 500) {
          await new Promise(r => setTimeout(r, 600 * attempt));
          continue;
        }
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise(r => setTimeout(r, 600 * attempt));
      }
    }
    
    if (!res || !res.ok) {
      console.warn(`Error fetching folder ${folderId}: ${res ? res.status : 'no response'}`);
      break;
    }
    
    const data = await res.json();
    if (data.files && Array.isArray(data.files)) {
      all.push(...data.files);
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  
  return all;
}

async function main() {
  console.log('🚀 Iniciando varredura completa do Google Drive...');
  const startTime = Date.now();
  
  // Fila de pastas para explorar: { id, name, pathParts }
  const queue = [{ id: DRIVE_ROOT_FOLDER_ID, name: 'Root', pathParts: [] }];
  
  const allVideos = [];
  const allMaterials = [];
  const allFolders = [];
  
  const BATCH_SIZE = 12;
  let visitedCount = 0;
  
  while (queue.length > 0) {
    const currentBatch = queue.splice(0, BATCH_SIZE);
    
    const batchResults = await Promise.all(
      currentBatch.map(async (folder) => {
        try {
          const files = await fetchChildren(folder.id);
          return { folder, files };
        } catch (err) {
          console.error(`Falha ao ler pasta ${folder.name} (${folder.id}):`, err.message);
          return { folder, files: [] };
        }
      })
    );
    
    for (const { folder, files } of batchResults) {
      visitedCount++;
      for (const f of files) {
        const isShortcut = f.mimeType === 'application/vnd.google-apps.shortcut';
        const effectiveId = isShortcut && f.shortcutDetails?.targetId ? f.shortcutDetails.targetId : f.id;
        const effectiveMime = isShortcut && f.shortcutDetails?.targetMimeType ? f.shortcutDetails.targetMimeType : f.mimeType;
        const isFolder = effectiveMime === 'application/vnd.google-apps.folder';
        
        const currentPathParts = [...folder.pathParts, f.name.trim()];
        const displayPath = currentPathParts.join(' / ');
        
        if (isFolder) {
          allFolders.push({
            id: effectiveId,
            name: f.name.trim(),
            path: displayPath,
            parent: folder.id
          });
          queue.push({
            id: effectiveId,
            name: f.name.trim(),
            pathParts: currentPathParts
          });
        } else {
          const isVideo = /video|mp4|webm|mkv|mov/i.test(effectiveMime) || /\.(mp4|webm|mkv|mov)$/i.test(f.name);
          const isPdf = /pdf|document|presentation/i.test(effectiveMime) || /\.(pdf|doc|docx)$/i.test(f.name);
          
          // Encontrar matéria / disciplina a partir da hierarquia
          // Exemplo: MEDCURSO 2024 / Cardiologia / MEDCURSO - Car 1 / videos apostila / 1.mp4
          // Course name = pathParts[0] (ex: MEDCURSO)
          // Discipline = pathParts[1] ou pathParts[2] se pathParts[1] for ano
          let courseName = currentPathParts[0] || 'Cursos';
          let discipline = 'Geral';
          if (currentPathParts.length >= 3) {
            discipline = currentPathParts[1].includes('202') ? currentPathParts[2] : currentPathParts[1];
          } else if (currentPathParts.length >= 2) {
            discipline = currentPathParts[1];
          } else {
            discipline = courseName;
          }
          
          const cleanTitle = f.name.replace(/\.[^/.]+$/, '').trim();
          const itemRecord = {
            id: effectiveId,
            t: cleanTitle,
            d: discipline,
            course: courseName,
            path: displayPath,
            size: f.size || null,
            webViewLink: f.webViewLink || `https://drive.google.com/file/d/${effectiveId}/preview`
          };
          
          if (isVideo) {
            allVideos.push(itemRecord);
          } else if (isPdf) {
            allMaterials.push(itemRecord);
          }
        }
      }
    }
    
    if (visitedCount % 24 === 0 || queue.length === 0) {
      console.log(`📊 Pastas lidas: ${visitedCount} | Na fila: ${queue.length} | Vídeos: ${allVideos.length} | Materiais: ${allMaterials.length}`);
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Varredura concluída em ${elapsed}s!`);
  console.log(`- Total de pastas exploradas: ${visitedCount}`);
  console.log(`- Total de videoaulas catalogadas: ${allVideos.length}`);
  console.log(`- Total de materiais/PDFs catalogados: ${allMaterials.length}`);
  
  // Ler o manifest atual para preservar itens anteriores caso haja IDs adicionais
  const manifestPath = path.join(__dirname, '..', 'acervo-manifest.json');
  let existingVideos = [];
  let existingMaterials = [];
  try {
    const rawExisting = fs.readFileSync(manifestPath, 'utf8');
    const matchV = rawExisting.match(/var\s+videosData\s*=\s*(\[[\s\S]*?\]);/);
    if (matchV) {
      try {
        const cleaned = matchV[1].replace(/\/\*[\s\S]*?\*\//g, '');
        existingVideos = JSON.parse(cleaned);
      } catch (e) {}
    }
  } catch (e) {}
  
  // Unificar pelo ID do arquivo
  const videoMap = new Map();
  // Primeiro adiciona os existentes antigos
  for (const v of existingVideos) {
    if (v.id) videoMap.set(v.id, v);
  }
  // Sobrescreve e complementa com a nova varredura oficial e completa
  for (const v of allVideos) {
    videoMap.set(v.id, {
      d: v.d,
      t: v.t,
      id: v.id,
      course: v.course,
      path: v.path
    });
  }
  
  const materialMap = new Map();
  for (const m of existingMaterials) {
    if (m.id) materialMap.set(m.id, m);
  }
  for (const m of allMaterials) {
    materialMap.set(m.id, {
      d: m.d,
      t: m.t,
      id: m.id,
      course: m.course,
      path: m.path
    });
  }
  
  const finalVideos = Array.from(videoMap.values());
  const finalMaterials = Array.from(materialMap.values());
  
  // Formato compatível: JSON estruturado que parseAcervoPayload aceita
  const manifestPayload = {
    generatedAt: new Date().toISOString(),
    totalVideos: finalVideos.length,
    totalMaterials: finalMaterials.length,
    videos: finalVideos,
    materials: finalMaterials,
    courses: [
      { id: '1a9BmCm6eTp2B6NSn7DaQ91B1NayXoIQM', name: 'MEDCURSO' },
      { id: '1Orhj_sPZ7DGMV_XlUlhE42A5pkC-IoDA', name: 'Estratégia' },
      { id: '1_0CD_TghyXhwK1DTxJu6HKdsHfGEEoXb', name: 'SANAR' },
      { id: '1LXvHaPsaH3MjudMZxa_b9-VOZpXaGWdO', name: 'APOSTILAS' },
      { id: '1FB99TgDxh08jWkC4h3A-fGiH-CGk8wS9', name: 'QUESTÕES EM PDF' },
      { id: '1WtvXN3AfWwAnyLbbvK9QStMySnJsev0J', name: 'APS' }
    ]
  };
  
  fs.writeFileSync(manifestPath, JSON.stringify(manifestPayload, null, 2), 'utf8');
  console.log(`💾 Salvo com sucesso em acervo-manifest.json (${finalVideos.length} vídeos, ${finalMaterials.length} materiais)!`);
  
  // Salvar também snapshot em JSON dos diretórios para busca offline e navegação ultra-rápida
  const snapshotPath = path.join(__dirname, '..', 'drive-tree-snapshot.json');
  fs.writeFileSync(snapshotPath, JSON.stringify({
    timestamp: Date.now(),
    folders: allFolders,
    videoCount: finalVideos.length,
    materialCount: finalMaterials.length
  }, null, 2), 'utf8');
  console.log(`💾 Salvo snapshot da árvore em drive-tree-snapshot.json!`);
}

main().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
