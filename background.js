// background.js
/**
 * Savega Background Service Worker — Manifest V3
 *
 * Self-contained: all DB, compiler, search, and licence logic lives here
 * in the service worker, which has a single stable origin
 * (chrome-extension://<id>) shared across all AI platforms.
 *
 * Content scripts communicate via chrome.runtime.sendMessage.
 */

'use strict';

// ── IndexedDB ─────────────────────────────────────────────────────────────────

const DB_NAME = 'SavegaDB';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_INDEX = 'search_index';

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
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
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => { console.error('[Savega] IDB open error:', e.target.error); reject(e.target.error); };
  });
}

async function dbSaveSession(session) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SESSIONS, 'readwrite');
      const req = tx.objectStore(STORE_SESSIONS).put(session);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => { console.error('[Savega] saveSession error:', e.target.error); reject(e.target.error); };
    } catch (err) { console.error('[Savega] saveSession tx error:', err); reject(err); }
  });
}

async function dbGetSession(sessionKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).get(sessionKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => { console.error('[Savega] getSession error:', e.target.error); reject(e.target.error); };
    } catch (err) { console.error('[Savega] getSession tx error:', err); reject(err); }
  });
}

async function dbGetAllSessions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        all.sort((a, b) => (b.lastActiveAt || b.startedAt || 0) - (a.lastActiveAt || a.startedAt || 0));
        resolve(all);
      };
      req.onerror = (e) => { console.error('[Savega] getAllSessions error:', e.target.error); reject(e.target.error); };
    } catch (err) { console.error('[Savega] getAllSessions tx error:', err); reject(err); }
  });
}

async function dbCountSessions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = (e) => { console.error('[Savega] countSessions error:', e.target.error); reject(e.target.error); };
    } catch (err) { console.error('[Savega] countSessions tx error:', err); reject(err); }
  });
}

async function dbClearSessions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SESSIONS, 'readwrite');
      const req = tx.objectStore(STORE_SESSIONS).clear();
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => { console.error('[Savega] clearSessions error:', e.target.error); reject(e.target.error); };
    } catch (err) { console.error('[Savega] clearSessions tx error:', err); reject(err); }
  });
}

async function dbClearSearchIndex() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_INDEX, 'readwrite');
      const req = tx.objectStore(STORE_INDEX).clear();
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => { console.error('[Savega] clearSearchIndex error:', e.target.error); reject(e.target.error); };
    } catch (err) { console.error('[Savega] clearSearchIndex tx error:', err); reject(err); }
  });
}

async function dbGetTotalSize() {
  try {
    const all = await dbGetAllSessions();
    return Math.round(JSON.stringify(all).length / 1024);
  } catch (err) { console.error('[Savega] getTotalSize error:', err); return 0; }
}

// ── Compiler ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','it','this','that','was','are','be','as','i','you','he','she',
  'we','they','have','had','has','do','did','will','would','could','should',
  'can','may','might','shall','not','no','yes','what','how','why','when',
  'where','who','which','if','then','so','just','also','about','from','by'
]);

function compileSession(sessionKey, platform, rawTurns, model, existing) {
  const now = Date.now();
  const turns = (rawTurns || [])
    .filter(t => t && typeof t.text === 'string' && t.text.trim().length > 0)
    .map(t => ({ role: t.role || 'user', text: t.text.trim() }));

  const firstUser = turns.find(t => t.role === 'user');
  const title = firstUser
    ? firstUser.text.slice(0, 80).replace(/\n/g, ' ')
    : 'Untitled session';

  const keywords = extractKeywords(turns);
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

function extractKeywords(turns) {
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

// ── TF-IDF search ─────────────────────────────────────────────────────────────

const _tfidfDocs = [];

function tfidfTokenize(text) {
  return (text || '').toLowerCase().match(/\b[a-z0-9]{3,}\b/g) || [];
}

function tfidfAdd(id, text) {
  const tokens = tfidfTokenize(text);
  const idx = _tfidfDocs.findIndex(d => d.id === id);
  if (idx >= 0) _tfidfDocs.splice(idx, 1);
  _tfidfDocs.push({ id, tokens });
}

function tfidfRemove(id) {
  const idx = _tfidfDocs.findIndex(d => d.id === id);
  if (idx >= 0) _tfidfDocs.splice(idx, 1);
}

function tfidfSearch(query, topN) {
  const terms = tfidfTokenize(query);
  if (terms.length === 0) return [];
  const n = _tfidfDocs.length;
  const scores = _tfidfDocs.map(doc => {
    const score = terms.reduce((sum, term) => {
      const tf = doc.tokens.filter(t => t === term).length / (doc.tokens.length || 1);
      const df = _tfidfDocs.filter(d => d.tokens.includes(term)).length;
      const idf = Math.log((n + 1) / (df + 1)) + 1;
      return sum + tf * idf;
    }, 0);
    return { id: doc.id, score };
  });
  return scores.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, topN || 5).map(s => s.id);
}

function tfidfClear() {
  _tfidfDocs.length = 0;
}

function indexSession(session) {
  const text = [session.title, ...(session.keywords || []), ...(session.turns || []).map(t => t.text)].join(' ');
  tfidfAdd(session.sessionKey, text);
}

// ── Licence ───────────────────────────────────────────────────────────────────

let _tier = 'free';
let _licenceReady = false;

async function initLicence() {
  try {
    const data = await new Promise(resolve => chrome.storage.local.get(['savega_install_id', 'savega_tier'], resolve));
    let installId = data.savega_install_id;
    if (!installId) {
      installId = crypto.randomUUID();
      await new Promise(resolve => chrome.storage.local.set({ savega_install_id: installId }, resolve));
    }
    _tier = data.savega_tier || 'free';
  } catch (err) {
    console.error('[Savega] Licence init error:', err);
    _tier = 'free';
  }
  _licenceReady = true;
}

function maxHistoryAge() {
  const isPro = _tier === 'pro' || _tier === 'team';
  return isPro ? Infinity : 7 * 24 * 60 * 60 * 1000;
}

// ── Search index bootstrap ────────────────────────────────────────────────────

async function bootstrapSearchIndex() {
  try {
    const sessions = await dbGetAllSessions();
    sessions.forEach(s => indexSession(s));
    console.log('[Savega] SearchIndex bootstrapped, sessions:', sessions.length);
  } catch (err) {
    console.error('[Savega] SearchIndex bootstrap error:', err);
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

const AI_HOSTNAMES = [
  'chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com',
  'perplexity.ai', 'www.perplexity.ai'
];

function isAITab(url) {
  if (!url) return false;
  try {
    const h = new URL(url).hostname;
    return AI_HOSTNAMES.some(host => h === host || h.endsWith('.' + host));
  } catch (_) { return false; }
}

function updateBadge(tabId, count) {
  if (!tabId) return;
  const text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ text, tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId }).catch(() => {});
}

async function refreshBadgeForTab(tabId) {
  try {
    const count = await dbCountSessions();
    updateBadge(tabId, count);
  } catch (_) { /* ignore */ }
}

// Initialise on service worker startup
(async () => {
  await initLicence();
  await bootstrapSearchIndex();
  console.log('[Savega] background service worker ready, tier:', _tier);
})();

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {

    case 'SAVEGA_CAPTURE_TURNS': {
      (async () => {
        try {
          const { platform, sessionKey, turns, model } = msg;
          if (!platform || !sessionKey || !Array.isArray(turns)) {
            sendResponse({ ok: false, error: 'bad payload' });
            return;
          }
          const existing = await dbGetSession(sessionKey);
          const session = compileSession(sessionKey, platform, turns, model, existing);
          await dbSaveSession(session);
          indexSession(session);
          const count = await dbCountSessions();
          if (sender.tab && sender.tab.id) updateBadge(sender.tab.id, count);
          sendResponse({ ok: true, count, session });
        } catch (err) {
          console.error('[Savega] capture error:', err);
          sendResponse({ ok: false, error: String(err) });
        }
      })();
      return true;
    }

    case 'SAVEGA_GET_ALL_SESSIONS': {
      dbGetAllSessions()
        .then(sessions => sendResponse({ sessions }))
        .catch(() => sendResponse({ sessions: [] }));
      return true;
    }

    case 'SAVEGA_GET_SESSION': {
      dbGetSession(msg.sessionKey)
        .then(session => sendResponse({ session }))
        .catch(() => sendResponse({ session: null }));
      return true;
    }

    case 'SAVEGA_GET_SUGGESTION': {
      (async () => {
        try {
          const all = await dbGetAllSessions();
          const match = all.find(s => s.sessionKey !== msg.excludeKey) || null;
          sendResponse({ session: match });
        } catch (err) {
          console.error('[Savega] getSuggestion error:', err);
          sendResponse({ session: null });
        }
      })();
      return true;
    }

    case 'SAVEGA_CLEAR_ALL': {
      (async () => {
        try {
          await Promise.all([dbClearSessions(), dbClearSearchIndex()]);
          tfidfClear();
          sendResponse({ ok: true });
        } catch (err) {
          console.error('[Savega] clearAll error:', err);
          sendResponse({ ok: false });
        }
      })();
      return true;
    }

    case 'SAVEGA_SEARCH': {
      (async () => {
        try {
          const ids = tfidfSearch(msg.query, msg.topN || 5);
          const sessions = (await Promise.all(ids.map(id => dbGetSession(id)))).filter(Boolean);
          sendResponse({ results: sessions });
        } catch (err) {
          console.error('[Savega] search error:', err);
          sendResponse({ results: [] });
        }
      })();
      return true;
    }

    case 'SAVEGA_GET_STATS': {
      (async () => {
        try {
          const count = await dbCountSessions();
          const kb = await dbGetTotalSize();
          sendResponse({ count, kb });
        } catch (err) {
          console.error('[Savega] getStats error:', err);
          sendResponse({ count: 0, kb: 0 });
        }
      })();
      return true;
    }

    case 'SAVEGA_GET_TIER': {
      sendResponse({ tier: _tier, maxHistoryAge: maxHistoryAge() });
      break;
    }

    case 'SAVEGA_SESSION_UPDATED': {
      // Popup notifies background; no action needed, just acknowledge
      sendResponse({ ok: true });
      break;
    }
  }
});

// ── Badge lifecycle ────────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isAITab(tab.url)) {
    refreshBadgeForTab(tabId);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    if (tab && isAITab(tab.url)) refreshBadgeForTab(tabId);
  });
});
