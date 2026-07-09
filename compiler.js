// src/compiler.js
/**
 * Savega ContextCompiler — content script IIFE.
 * Sets window.contextCompiler for use by other content scripts.
 */
(() => {
  'use strict';

  const STOPWORDS = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with',
    'is','it','this','that','was','are','be','as','i','you','he','she',
    'we','they','have','had','has','do','did','will','would','could','should',
    'can','may','might','shall','not','no','yes','what','how','why','when',
    'where','who','which','if','then','so','just','also','about','from','by'
  ]);

  class ContextCompiler {
    compile(sessionKey, platform, rawTurns, model, existing) {
      const now = Date.now();
      const turns = (rawTurns || [])
        .filter(t => t && typeof t.text === 'string' && t.text.trim().length > 0)
        .map(t => ({ role: t.role || 'user', text: t.text.trim() }));

      const firstUser = turns.find(t => t.role === 'user');
      const title = firstUser
        ? firstUser.text.slice(0, 80).replace(/\n/g, ' ')
        : 'Untitled session';

      const keywords = this._extractKeywords(turns);
      const wordCount = turns.reduce((acc, t) => acc + t.text.split(/\s+/).filter(Boolean).length, 0);

      return {
        sessionKey,
        platform,
        title,
        keywords,
        turns,
        model: model || (existing && existing.model) || '',
        startedAt: (existing && existing.startedAt) || now,
        lastActiveAt: now,
        wordCount
      };
    }

    _extractKeywords(turns) {
      const freq = {};
      for (const turn of turns) {
        const words = (turn.text || '').toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 3 && !STOPWORDS.has(w));
        for (const w of words) freq[w] = (freq[w] || 0) + 1;
      }
      return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
    }
  }

  window.contextCompiler = new ContextCompiler();
  console.log('[Savega] compiler ready');
})();
