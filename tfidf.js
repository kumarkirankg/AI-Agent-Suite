// src/tfidf.js
/**
 * Savega TF-IDF — content script IIFE.
 * Sets window.tiloTfIdf for use by search-index.js.
 */
(() => {
  'use strict';

  class TfIdf {
    constructor() {
      this._docs = [];
    }

    _tokenize(text) {
      return (text || '').toLowerCase().match(/\b[a-z0-9]{3,}\b/g) || [];
    }

    addDocument(id, text) {
      const tokens = this._tokenize(text);
      this._docs = this._docs.filter(d => d.id !== id);
      this._docs.push({ id, tokens });
    }

    removeDocument(id) {
      this._docs = this._docs.filter(d => d.id !== id);
    }

    _tf(term, tokens) {
      const count = tokens.filter(t => t === term).length;
      return count / (tokens.length || 1);
    }

    _idf(term) {
      const n = this._docs.length;
      const df = this._docs.filter(d => d.tokens.includes(term)).length;
      return Math.log((n + 1) / (df + 1)) + 1;
    }

    search(query, topN) {
      const terms = this._tokenize(query);
      if (terms.length === 0) return [];
      const scores = this._docs.map(doc => {
        const score = terms.reduce((sum, term) => sum + this._tf(term, doc.tokens) * this._idf(term), 0);
        return { id: doc.id, score };
      });
      const results = scores.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
      return (topN ? results.slice(0, topN) : results).map(s => s.id);
    }

    clear() {
      this._docs = [];
    }
  }

  window.tiloTfIdf = new TfIdf();
  console.log('[Savega] tfidf ready');
})();
