// src/idb-wrapper.js
/**
 * Savega IDB Wrapper — content script IIFE.
 * Sets window.contextDB for use by other content scripts.
 *
 * NOTE: In the content script context, this DB is per-origin (the AI site's
 * origin). Capture data flows to the background service worker via
 * chrome.runtime.sendMessage (SAVEGA_CAPTURE_TURNS), where the single
 * shared SavegaDB lives. This content-script DB is kept for legacy
 * compatibility and local caching only.
 */
(() => {
  'use strict';

  const DB_NAME = 'SavegaDB';
  const DB_VERSION = 1;
  const STORE_SESSIONS = 'sessions';
  const STORE_INDEX = 'search_index';

  class ContextDB {
    constructor() {
      this._db = null;
      this._ready = this._open();
    }

    _open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
            db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionKey' });
          }
          if (!db.objectStoreNames.contains(STORE_INDEX)) {
            db.createObjectStore(STORE_INDEX, { keyPath: 'word' });
          }
        };
        req.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
        req.onerror = (e) => {
          console.error('[Savega] IDB open error:', e.target.error);
          reject(e.target.error);
        };
      });
    }

    async _getDB() {
      if (this._db) return this._db;
      return this._ready;
    }

    async saveSession(session) {
      try {
        const db = await this._getDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_SESSIONS, 'readwrite');
          const req = tx.objectStore(STORE_SESSIONS).put(session);
          req.onsuccess = () => resolve(req.result);
          req.onerror = (e) => { console.error('[Savega] saveSession error:', e.target.error); reject(e.target.error); };
        });
      } catch (err) { console.error('[Savega] saveSession error:', err); }
    }

    async getSession(sessionKey) {
      try {
        const db = await this._getDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_SESSIONS, 'readonly');
          const req = tx.objectStore(STORE_SESSIONS).get(sessionKey);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = (e) => { console.error('[Savega] getSession error:', e.target.error); reject(e.target.error); };
        });
      } catch (err) { console.error('[Savega] getSession error:', err); return null; }
    }

    async getAllSessions() {
      try {
        const db = await this._getDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_SESSIONS, 'readonly');
          const req = tx.objectStore(STORE_SESSIONS).getAll();
          req.onsuccess = () => {
            const all = req.result || [];
            all.sort((a, b) => (b.lastActiveAt || b.startedAt || 0) - (a.lastActiveAt || a.startedAt || 0));
            resolve(all);
          };
          req.onerror = (e) => { console.error('[Savega] getAllSessions error:', e.target.error); reject(e.target.error); };
        });
      } catch (err) { console.error('[Savega] getAllSessions error:', err); return []; }
    }

    async countSessions() {
      try {
        const db = await this._getDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_SESSIONS, 'readonly');
          const req = tx.objectStore(STORE_SESSIONS).count();
          req.onsuccess = () => resolve(req.result || 0);
          req.onerror = (e) => { console.error('[Savega] countSessions error:', e.target.error); reject(e.target.error); };
        });
      } catch (err) { console.error('[Savega] countSessions error:', err); return 0; }
    }

    async clearAllSessions() {
      try {
        const db = await this._getDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_SESSIONS, 'readwrite');
          const req = tx.objectStore(STORE_SESSIONS).clear();
          req.onsuccess = () => resolve(true);
          req.onerror = (e) => { console.error('[Savega] clearAllSessions error:', e.target.error); reject(e.target.error); };
        });
      } catch (err) { console.error('[Savega] clearAllSessions error:', err); }
    }

    async getTotalSize() {
      try {
        const all = await this.getAllSessions();
        return Math.round(JSON.stringify(all).length / 1024);
      } catch (err) { console.error('[Savega] getTotalSize error:', err); return 0; }
    }

    async saveSearchEntry(entry) {
      try {
        const db = await this._getDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_INDEX, 'readwrite');
          const req = tx.objectStore(STORE_INDEX).put(entry);
          req.onsuccess = () => resolve(true);
          req.onerror = (e) => { console.error('[Savega] saveSearchEntry error:', e.target.error); reject(e.target.error); };
        });
      } catch (err) { console.error('[Savega] saveSearchEntry error:', err); }
    }

    async getSearchEntry(word) {
      try {
        const db = await this._getDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_INDEX, 'readonly');
          const req = tx.objectStore(STORE_INDEX).get(word);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = (e) => { console.error('[Savega] getSearchEntry error:', e.target.error); reject(e.target.error); };
        });
      } catch (err) { console.error('[Savega] getSearchEntry error:', err); return null; }
    }

    async clearSearchIndex() {
      try {
        const db = await this._getDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_INDEX, 'readwrite');
          const req = tx.objectStore(STORE_INDEX).clear();
          req.onsuccess = () => resolve(true);
          req.onerror = (e) => { console.error('[Savega] clearSearchIndex error:', e.target.error); reject(e.target.error); };
        });
      } catch (err) { console.error('[Savega] clearSearchIndex error:', err); }
    }
  }

  window.contextDB = new ContextDB();
  console.log('[Savega] idb-wrapper ready');
})();
