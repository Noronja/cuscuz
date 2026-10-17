/* ==========================================================================
   MEDREADER — Core (classe MedReaderCore)
   Dashboard pessoal Cuscuz-MED
   - Renderiza conteúdo HTML de apostilas
   - Temas, tamanho e família de fonte
   - Anotações vinculadas a trechos
   - Persistência em localStorage (com fallback)
   - Comentários em português
   ========================================================================== */

// Fallback de localStorage (se o navegador não suportar ou estiver desativado)
const LocalStorageFallback = (() => {
  const store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
})();

function safeLocalStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem) {
      // Testa gravabilidade
      const testKey = '__medreader_ls_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return localStorage;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[MedReaderCore] localStorage indisponível, usando fallback em memória:', e.message);
  }
  return LocalStorageFallback;
}

const LS = safeLocalStorage();

/**
 * MedReaderCore — controla leitura, tema, fonte e anotações de uma apostila.
 *
 * @param {object} opts
 * @param {string|HTMLElement} opts.container - Seletor CSS ou elemento do container
 * @param {string} [opts.theme='default'] - 'default' | 'sepia' | 'night'
 * @param {string} [opts.fontSize='medium'] - 'small' | 'medium' | 'large' | 'extra-large'
 * @param {string} [opts.fontFamily='sans'] - 'serif' | 'sans' | 'mono'
 * @param {string} [opts.storagePrefix='medreader'] - prefixo para chaves do localStorage
 */
class MedReaderCore {
  constructor(opts = {}) {
    this.container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container || null;
    if (!this.container) {
      throw new Error('[MedReaderCore] Container não encontrado ou inválido.');
    }

    this.theme = opts.theme || 'default';
    this.fontSize = opts.fontSize || 'medium';
    this.fontFamily = opts.fontFamily || 'sans';
    this.storagePrefix = opts.storagePrefix || 'medreader';
    this.contentHtml = '';
    this.annotations = []; // { id, texto, trecho, posicao, atualizadoEm }
    this.highlights = [];  // { id, annotationId, rangeStart, rangeEnd, texto }

    this._loadSettings();
    this._loadAnnotations();

    // Aplica configurações iniciais no container
    this.applyTheme();
    this.applyFontSize();
    this.applyFontFamily();
  }

  /* ── Persistência de configurações ── */
  _storageKey(sufixo) {
    return `${this.storagePrefix}:${sufixo}`;
  }

  _loadSettings() {
    try {
      const tema = LS.getItem(this._storageKey('tema'));
      const tamanho = LS.getItem(this._storageKey('tamanho'));
      const familia = LS.getItem(this._storageKey('familia'));
      if (tema) this.theme = tema;
      if (tamanho) this.fontSize = tamanho;
      if (familia) this.fontFamily = familia;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[MedReaderCore] Falha ao carregar configurações:', e.message);
    }
  }

  _saveSettings() {
    try {
      LS.setItem(this._storageKey('tema'), this.theme);
      LS.setItem(this._storageKey('tamanho'), this.fontSize);
      LS.setItem(this._storageKey('familia'), this.fontFamily);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[MedReaderCore] Falha ao salvar configurações:', e.message);
    }
  }

  /* ── Carregamento de conteúdo ── */
  /**
   * Carrega uma string HTML no container do leitor.
   * @param {string} html
   */
  loadContent(html) {
    if (!this.container) return;
    if (typeof html !== 'string') {
      throw new Error('[MedReaderCore] loadContent espera uma string HTML.');
    }
    this.contentHtml = html;

    // Limpa e insere o conteúdo
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'medreader-content medreader-html';
    wrapper.innerHTML = html;

    // Adiciona classes de corpo para estilização
    this.container.classList.add('medreader-body');
    this.container.appendChild(wrapper);

    // Aplica tema e fonte atuais
    this.applyTheme();
    this.applyFontSize();
    this.applyFontFamily();

    // Re-renderiza anotações (destaques) se houver
    this.renderHighlights();
  }

  /* ── Tema ── */
  setTheme(theme) {
    const validos = ['default', 'sepia', 'night'];
    if (!validos.includes(theme)) {
      // eslint-disable-next-line no-console
      console.warn(`[MedReaderCore] Tema inválido: ${theme}. Use um de ${validos.join(', ')}.`);
      return;
    }
    this.theme = theme;
    this.applyTheme();
    this._saveSettings();
  }

  applyTheme() {
    // Remove classes de tema anteriores
    ['default', 'sepia', 'night'].forEach((t) => {
      this.container.classList.remove(`medreader-theme-${t}`);
      this.container.style.removeProperty('--medreader-bg');
      this.container.style.removeProperty('--medreader-text');
      this.container.style.removeProperty('--medreader-border');
    });

    // Adiciona classe do tema atual
    if (this.theme) {
      this.container.classList.add(`medreader-theme-${this.theme}`);
    }
  }

  /* ── Tamanho de fonte ── */
  setFontSize(size) {
    const validos = ['small', 'medium', 'large', 'extra-large'];
    if (!validos.includes(size)) {
      // eslint-disable-next-line no-console
      console.warn(`[MedReaderCore] Tamanho inválido: ${size}. Use um de ${validos.join(', ')}.`);
      return;
    }
    this.fontSize = size;
    this.applyFontSize();
    this._saveSettings();
  }

  applyFontSize() {
    ['small', 'medium', 'large', 'extra-large'].forEach((s) => {
      this.container.classList.remove(`medreader-font-${s}`);
    });
    if (this.fontSize) {
      this.container.classList.add(`medreader-font-${this.fontSize}`);
    }
  }

  /* ── Família de fonte ── */
  setFontFamily(family) {
    const validos = ['serif', 'sans', 'mono'];
    if (!validos.includes(family)) {
      // eslint-disable-next-line no-console
      console.warn(`[MedReaderCore] Família inválida: ${family}. Use um de ${validos.join(', ')}.`);
      return;
    }
    this.fontFamily = family;
    this.applyFontFamily();
    this._saveSettings();
  }

  applyFontFamily() {
    ['serif', 'sans', 'mono'].forEach((f) => {
      this.container.classList.remove(`medreader-font-${f}`);
    });
    if (this.fontFamily) {
      this.container.classList.add(`medreader-font-${this.fontFamily}`);
    }
  }

  /* ── Anotações ── */
  _loadAnnotations() {
    try {
      const raw = LS.getItem(this._storageKey('anotacoes'));
      if (raw) {
        this.annotations = JSON.parse(raw);
        if (!Array.isArray(this.annotations)) this.annotations = [];
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[MedReaderCore] Falha ao carregar anotações:', e.message);
      this.annotations = [];
    }
  }

  _saveAnnotations() {
    try {
      LS.setItem(this._storageKey('anotacoes'), JSON.stringify(this.annotations));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[MedReaderCore] Falha ao salvar anotações:', e.message);
    }
  }

  _novoId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Adiciona uma anotação vinculada a um trecho/posição.
   * @param {object} dados
   * @param {string} dados.texto - Texto da anotação
   * @param {string} [dados.trecho] - Trecho original do texto
   * @param {object} [dados.posicao] - { inicio, fim } índices de caractere
   * @returns {object} anotação criada
   */
  addAnnotation(dados = {}) {
    if (!dados.texto || String(dados.texto).trim() === '') {
      throw new Error('[MedReaderCore] Texto da anotação é obrigatório.');
    }

    const anotacao = {
      id: this._novoId(),
      texto: String(dados.texto).trim(),
      trecho: dados.trecho ? String(dados.trecho).trim() : '',
      posicao: dados.posicao || null,
      criadoEm: Date.now(),
      atualizadoEm: Date.now(),
    };

    this.annotations.push(anotacao);
    this._saveAnnotations();
    this.renderHighlights();
    return anotacao;
  }

  /**
   * Edita uma anotação existente.
   * @param {string} id
   * @param {object} atualizacoes
   * @returns {object|null}
   */
  editAnnotation(id, atualizacoes = {}) {
    const idx = this.annotations.findIndex((a) => a.id === id);
    if (idx === -1) return null;

    if (atualizacoes.texto !== undefined) this.annotations[idx].texto = String(atualizacoes.texto).trim();
    if (atualizacoes.trecho !== undefined) this.annotations[idx].trecho = String(atualizacoes.trecho).trim();
    if (atualizacoes.posicao !== undefined) this.annotations[idx].posicao = atualizacoes.posicao;
    this.annotations[idx].atualizadoEm = Date.now();

    this._saveAnnotations();
    this.renderHighlights();
    return this.annotations[idx];
  }

  /**
   * Remove uma anotação.
   * @param {string} id
   * @returns {boolean}
   */
  removeAnnotation(id) {
    const idx = this.annotations.findIndex((a) => a.id === id);
    if (idx === -1) return false;

    this.annotations.splice(idx, 1);
    this._saveAnnotations();
    this.renderHighlights();
    return true;
  }

  /**
   * Retorna todas as anotações.
   * @returns {Array}
   */
  getAnnotations() {
    return [...this.annotations];
  }

  /**
   * Renderiza os destaques visuais no texto com base nas posições salvas.
   * Como o conteúdo é HTML dentro de um container, percorremos nós de texto.
   */
  renderHighlights() {
    if (!this.container) return;

    // Remove destaques anteriores
    this.container.querySelectorAll('.medreader-highlight').forEach((el) => {
      const texto = el.textContent;
      el.replaceWith(document.createTextNode(texto));
    });

    const content = this.container.querySelector('.medreader-content');
    if (!content) return;

    // Para cada anotação com posição, tenta destacar o trecho correspondente
    this.annotations.forEach((anotacao) => {
      if (!anotacao.posicao || !anotacao.trecho) return;

      const { inicio, fim } = anotacao.posicao;
      if (inicio == null || fim == null) return;

      this._highlightRange(content, inicio, fim, anotacao.id);
    });
  }

  /**
   * Destaca um intervalo de caracteres dentro de um nó (percorrendo nós de texto).
   * @param {Node} raiz
   * @param {number} inicio
   * @param {number} fim
   * @param {string} annotationId
   */
  _highlightRange(raiz, inicio, fim, annotationId) {
    const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, null, false);
    let pos = 0;
    let inicioNode = null;
    let inicioOffset = 0;
    let fimNode = null;
    let fimOffset = 0;

    // Encontra nós de início e fim
    let node;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (inicioNode === null && pos + len >= inicio) {
        inicioNode = node;
        inicioOffset = inicio - pos;
      }
      if (fimNode === null && pos + len >= fim) {
        fimNode = node;
        fimOffset = fim - pos;
        break;
      }
      pos += len;
    }

    if (!inicioNode || !fimNode) return;

    // Se início e fim estão no mesmo nó de texto
    if (inicioNode === fimNode) {
      const texto = inicioNode.textContent;
      const antes = texto.slice(0, inicioOffset);
      const destaque = texto.slice(inicioOffset, fimOffset);
      const depois = texto.slice(fimOffset);

      const span = document.createElement('span');
      span.className = 'medreader-highlight';
      span.dataset.annotationId = annotationId;
      span.textContent = destaque;
      span.title = 'Anotação vinculada';

      const pai = inicioNode.parentNode;
      pai.insertBefore(document.createTextNode(antes), inicioNode);
      pai.insertBefore(span, inicioNode);
      pai.insertBefore(document.createTextNode(depois), inicioNode);
      inicioNode.remove();
      return;
    }

    // Início e fim em nós diferentes — divide o primeiro nó
    const textoInicio = inicioNode.textContent;
    const antesInicio = textoInicio.slice(0, inicioOffset);
    const destaqueInicio = textoInicio.slice(inicioOffset);

    const spanInicio = document.createElement('span');
    spanInicio.className = 'medreader-highlight';
    spanInicio.dataset.annotationId = annotationId;
    spanInicio.textContent = destaqueInicio;

    const paiInicio = inicioNode.parentNode;
    paiInicio.insertBefore(document.createTextNode(antesInicio), inicioNode);
    paiInicio.insertBefore(spanInicio, inicioNode);
    inicioNode.remove();

    // Divide o último nó
    const textoFim = fimNode.textContent;
    const destaqueFim = textoFim.slice(0, fimOffset);
    const depoisFim = textoFim.slice(fimOffset);

    const spanFim = document.createElement('span');
    spanFim.className = 'medreader-highlight';
    spanFim.dataset.annotationId = annotationId;
    spanFim.textContent = destaqueFim;

    const paiFim = fimNode.parentNode;
    paiFim.insertBefore(spanFim, fimNode);
    paiFim.insertBefore(document.createTextNode(depoisFim), fimNode);
    fimNode.remove();

    // Destaca nós de texto inteiros entre início e fim
    const walker2 = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, null, false);
    let started = false;
    let n;
    while ((n = walker2.nextNode())) {
      if (n === spanInicio.firstChild || n === spanFim.firstChild) continue;
      if (n.parentElement === spanInicio || n.parentElement === spanFim) continue;

      // Detecta início do intervalo
      if (!started && n.textContent === destaqueInicio && n.parentElement === spanInicio.parentNode) {
        started = true;
        continue;
      }
      if (started) {
        // Se chegou ao nó de fim, para
        if (n === fimNode) break;
        // Destaca o nó inteiro (exceto os já envolvidos)
        const textoN = n.textContent;
        const span = document.createElement('span');
        span.className = 'medreader-highlight';
        span.dataset.annotationId = annotationId;
        span.textContent = textoN;
        n.parentNode.insertBefore(span, n);
        n.remove();
      }
    }
  }

  /* ── Destruição ── */
  destroy() {
    // Remove eventos e classes se necessário
    this.container.classList.remove('medreader-body');
    ['default', 'sepia', 'night'].forEach((t) => {
      this.container.classList.remove(`medreader-theme-${t}`);
    });
    ['small', 'medium', 'large', 'extra-large'].forEach((s) => {
      this.container.classList.remove(`medreader-font-${s}`);
    });
    ['serif', 'sans', 'mono'].forEach((f) => {
      this.container.classList.remove(`medreader-font-${f}`);
    });
  }
}

export { MedReaderCore };
