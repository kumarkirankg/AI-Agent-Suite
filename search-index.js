// src/search-index.js
/**
 * Savega SearchIndex — content script IIFE.
 * Sets window.savegaSearchIndex for use by other content scripts.
 * Depends on window.tiloTfIdf (tfidf.js) and window.contextDB (idb-wrapper.js).
 */
(() => {
  'use strict';

  class SearchIndex {
    constructor() {
      this._initialized = false;
      this._initPromise = null;
    }

    async ready() {
      if (this._initialized) return;
      if (this._initPromise) return this._initPromise;
      this._initPromise = this._init();
      return this._initPromise;
    }

    async _init() {
      try {
        if (!window.contextDB || !window.tiloTfIdf) {
          console.warn('[Savega] SearchIndex: contextDB or tiloTfIdf not available yet');
          return;
        }
        const sessions = await window.contextDB.getAllSessions();
        sessions.forEach(s => this._addToIndex(s));
        this._initialized = true;
        console.log('[Savega] SearchIndex ready, sessions indexed:', sessions.length);
      } catch (err) {
        console.error('[Savega] SearchIndex init error:', err);
      }
    }

    _addToIndex(session) {
      if (!window.tiloTfIdf) return;
      const text = [session.title, ...(session.keywords || []), ...(session.turns || []).map(t => t.text)].join(' ');
      window.tiloTfIdf.addDocument(session.sessionKey, text);
    }

    indexSession(session) {
      this._addToIndex(session);
    }

    removeSession(sessionKey) {
      if (window.tiloTfIdf) window.tiloTfIdf.removeDocument(sessionKey);
    }

    search(query, topN) {
      if (!window.tiloTfIdf) return [];
      return window.tiloTfIdf.search(query, topN || 5);
    }

    clear() {
      if (window.tiloTfIdf) window.tiloTfIdf.clear();
      this._initialized = false;
      this._initPromise = null;
    }
  }

  window.savegaSearchIndex = new SearchIndex();
  // Kick off init in the background — don't block content script load
  window.savegaSearchIndex.ready().catch(err => console.error('[Savega] SearchIndex ready error:', err));
  console.log('[Savega] search-index ready');
})();
