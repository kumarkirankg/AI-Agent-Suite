// src/licence.js
/**
 * Savega Licence — content script IIFE.
 * Sets window.savegaLicence.
 * Reads tier flag from chrome.storage.local (written by background.js).
 * Zero network calls. All validation is local.
 */
(() => {
  'use strict';

  class SavegaLicence {
    constructor() {
      this._tier = 'free';
      this._ready = this._init();
    }

    async _init() {
      try {
        const data = await new Promise(resolve =>
          chrome.storage.local.get(['savega_tier'], resolve)
        );
        this._tier = data.savega_tier || 'free';
      } catch (err) {
        console.error('[Savega] Licence init error:', err);
        this._tier = 'free';
      }
    }

    async ready() { return this._ready; }

    getTier() { return this._tier; }

    isPro() { return this._tier === 'pro' || this._tier === 'team'; }

    maxHistoryAge() {
      return this.isPro() ? Infinity : 7 * 24 * 60 * 60 * 1000;
    }
  }

  window.savegaLicence = new SavegaLicence();
  console.log('[Savega] licence ready');
})();
