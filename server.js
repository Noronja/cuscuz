// Busca materiais (PDFs e apostilas HTML) no Drive navegando na estrutura:
// curso > disciplina > aula > subpasta "Apostila" (ou arquivos soltos na aula)
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
        const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,shortcutDetails,webViewLink)');
        const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
        const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=folder,name_natural&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageParam}`;
        const r = await driveFetch(url, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) break;
        const data = await r.json();
        if (data.files) files.push(...data.files);
        pageToken = data.nextPageToken || '';
      } while (pageToken);
      return files;
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

    // Se um aula específica foi solicitada, filtrar apenas essa
    let targetAulaPastas = aulaPastas;
    if (aula) {
      const aulaNorm = norm(aula);
      targetAulaPastas = aulaPastas.filter(f => {
        const nome = String(f.name || '').toLowerCase();
        const nNorm = norm(nome);
        return nNorm.includes(aulaNorm) || aulaNorm.includes(nNorm) || limpaTnome(f.name) === limpaTnome(aula);
      });
      if (targetAulaPastas.length === 0) {
        return res.json({ materials: [], hint: 'Aula não encontrada na disciplina', course, disc, aula });
      }
    }

    const materials = [];
    const pdfExt = /\.(pdf|doc|docx)$/i;
    const htmlExt = /\.(html?|htm)$/i;

    // 4. Para cada aula, procurar subpasta "Apostila" ou arquivos soltos
    for (const aulaPasta of targetAulaPastas) {
      const aulaFolderId = aulaPasta.shortcutDetails?.targetId || aulaPasta.id;
      const aulaNome = aulaPasta.name || 'Aula sem nome';

      // 4a. Procurar subpasta "Apostila" dentro da aula
      const aulaFiles = await listFolder(aulaFolderId);
      const apostilaPasta = aulaFiles.find(f => (f.mimeType === 'application/vnd.google-apps.folder' || f.isFolder) && isApostilaFolder(f.name));

      let arquivosParaProcessar = [];

      if (apostilaPasta) {
        // Entrou na subpasta "Apostila"
        const apostilaFolderId = apostilaPasta.shortcutDetails?.targetId || apostilaPasta.id;
        const apostilaFiles = await listFolder(apostilaFolderId);
        arquivosParaProcessar = apostilaFiles;
      } else {
        // Sem subpasta "Apostila", pega arquivos PDF/HTML diretamente na pasta da aula
        arquivosParaProcessar = aulaFiles.filter(f => {
          const { isFolder, isPdf, isHtml } = classifyFile(f);
          return !isFolder && (isPdf || isHtml);
        });
      }

      // 5. Classificar e adicionar materiais encontrados
      for (const f of arquivosParaProcessar) {
        const { nome, nomeNorm, isShortcut, effectiveId, effectiveMime, isFolder, isPdf, isHtml } = classifyFile(f);
        if (isFolder) continue;
        if (!isPdf && !isHtml) continue;

        materials.push({
          id: effectiveId,
          nome: nome.replace(/\.(pdf|html?|htm|doc|docx)$/i, '').trim(),
          rawName: nome,
          mimeType: effectiveMime,
          isFolder: false,
          isPdf,
          isHtml,
          curso,
          disc,
          aulaId: aulaPasta.id,
          aulaNome,
          webViewLink: f.webViewLink || `https://drive.google.com/file/d/${effectiveId}/preview`
        });
      }
    }

    // Remove duplicados por id
    const uniq = materials.filter((m, idx, self) => idx === self.findIndex(m2 => m2.id === m.id));
    return res.json({ materials: uniq, total: uniq.length, course, disc, aula, source: 'drive-recursive' });
  } catch (err) {
    console.error('[Drive Materials]', err.message);
    return res.status(500).json({ error: err.message, materials: [] });
  }
});
