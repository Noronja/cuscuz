/* ==========================================================================
   MEDREADER — Exportação (FlashcardExport)
   Dashboard pessoal Cuscuz-MED
   - toText(): retorna string formatada (TXT)
   - toCSV(): retorna string CSV (pergunta,resposta,trecho,etapa,proxima_revisao)
   - downloadText(filename), downloadCSV(filename): dispara download no navegador
   - Comentários em português
   ========================================================================== */

/**
 * FlashcardExport — exporta flashcards para TXT e CSV.
 */
class FlashcardExport {
  constructor(flashcards = []) {
    this.flashcards = Array.isArray(flashcards) ? [...flashcards] : [];
  }

  /**
   * Define a lista de flashcards a exportar.
   * @param {Array} flashcards
   */
  setFlashcards(flashcards) {
    this.flashcards = Array.isArray(flashcards) ? [...flashcards] : [];
  }

  /**
   * Escapa um campo para CSV (aspas duplas internas, quebra de linha, vírgula).
   * @param {string} valor
   * @returns {string}
   */
  _csvEscape(valor) {
    const s = valor == null ? '' : String(valor);
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  /**
   * Formata um flashcard para exibição em TXT.
   * @param {object} card
   * @param {number} indice
   * @returns {string}
   */
  _formatarTxt(card, indice) {
    const proxima = card.proxima_revisao ? new Date(card.proxima_revisao).toLocaleString('pt-BR') : '—';
    return [
      `Flashcard #${indice + 1}`,
      `ID: ${card.id}`,
      `Pergunta: ${card.pergunta}`,
      `Resposta: ${card.resposta}`,
      card.trecho ? `Trecho: ${card.trecho}` : '',
      `Etapa: ${card.etapa}`,
      `Próxima revisão: ${proxima}`,
      '─'.repeat(40),
      '',
    ].filter((linha) => linha !== '').join('\n');
  }

  /**
   * Retorna todos os flashcards formatados como texto legível.
   * @returns {string}
   */
  toText() {
    if (this.flashcards.length === 0) {
      return 'Nenhum flashcard para exportar.\n';
    }
    const linhas = this.flashcards.map((card, i) => this._formatarTxt(card, i));
    const cabecalho = [
      'MEDREADER — Exportação de Flashcards (TXT)',
      `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
      `Total de flashcards: ${this.flashcards.length}`,
      '═'.repeat(50),
      '',
    ].join('\n');
    return cabecalho + linhas.join('\n');
  }

  /**
   * Retorna todos os flashcards no formato CSV.
   * Colunas: pergunta,resposta,trecho,etapa,proxima_revisao
   * @returns {string}
   */
  toCSV() {
    const cabecalho = 'pergunta,resposta,trecho,etapa,proxima_revisao';
    const linhas = this.flashcards.map((card) => [
      this._csvEscape(card.pergunta),
      this._csvEscape(card.resposta),
      this._csvEscape(card.trecho),
      card.etapa != null ? String(card.etapa) : '',
      card.proxima_revisao ? String(card.proxima_revisao) : '',
    ].join(','));
    return [cabecalho, ...linhas].join('\n') + '\n';
  }

  /**
   * Dispara download de arquivo de texto no navegador.
   * @param {string} [filename='medreader-flashcards.txt']
   * @returns {boolean}
   */
  downloadText(filename = 'medreader-flashcards.txt') {
    return this._download(this.toText(), filename, 'text/plain; charset=utf-8');
  }

  /**
   * Dispara download de arquivo CSV no navegador.
   * @param {string} [filename='medreader-flashcards.csv']
   * @returns {boolean}
   */
  downloadCSV(filename = 'medreader-flashcards.csv') {
    const csv = '\uFEFF' + this.toCSV(); // BOM para UTF-8 no Excel
    return this._download(csv, filename, 'text/csv; charset=utf-8');
  }

  /**
   * Cria um Blob, dispara download via URL temporária e limpa.
   * @param {string} conteúdo
   * @param {string} nomeArquivo
   * @param {string} mimeType
   * @returns {boolean}
   */
  _download(conteúdo, nomeArquivo, mimeType) {
    try {
      const blob = new Blob([conteúdo], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = nomeArquivo;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      // Limpeza
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[FlashcardExport] Falha ao fazer download:', e.message);
      return false;
    }
  }
}

export { FlashcardExport };
