// popup/popup.js
/**
 * Savega Popup JS v8
 *
 * - All session data from background service worker (single shared store)
 * - "Ask Savega" is local TF-IDF search — zero network calls
 * - Platform keys: chatgpt | claude | gemini | perplexity
 * - All event handlers via addEventListener — no inline onclick
 * - Escape closes popup
 * - pointer-events: auto only
 * - Pill hide/show via .hide CSS class
 * - Session bar: "● saving to #Name" — never "* remembering"
 * - User text always via textContent
 * - Trust bar always last, always visible
 */

'use strict';

const TAB_KEYS = ['chatgpt', 'claude', 'gemini', 'perplexity'];

const PLATFORM_LABELS = {
  chatgpt: 'GPT',
  claude: 'Claude',
  gemini: 'Gemini',
  perplexity: 'Perp'
};

// Model lists per spec (June 2026)
const MODELS = {
  chatgpt: ['GPT-4o', 'GPT-4o mini', 'o1', 'o1 mini', 'o3', 'o3 mini', 'GPT-4.5'],
  claude: ['Claude Sonnet 4.6', 'Claude Opus 4.6', 'Claude Haiku 4.5', 'Claude Sonnet 4.5', 'Claude Opus 4.5'],
  gemini: ['Gemini 1.5 Pro', 'Gemini 1.5 Flash', 'Gemini 2.0 Flash', 'Gemini 2.5 Pro', 'Gemini 2.5 Flash'],
  perplexity: ['Sonar Pro', 'Sonar', 'Sonar Reasoning Pro', 'Sonar Reasoning']
};

const DEFAULT_MODELS = {
  chatgpt: 'GPT-4o',
  claude: 'Claude Sonnet 4.6',
  gemini: 'Gemini 1.5 Pro',
  perplexity: 'Sonar Pro'
};

const DEMO_DESCRIPTIONS = [
  'Start any conversation on ChatGPT like normal — nothing extra to set up.',
  'Chat as you normally would. Savega watches the page in the background.',
  'After a few exchanges, Savega saves that conversation to your device.',
  'Open a new chat on Claude, Gemini, or Perplexity — anywhere.',
  'Savega notices it\u2019s a fresh chat and offers your last conversation.',
  'One click drops a compressed summary into the input box.',
  'Review it before sending — Savega never sends anything for you.',
  'Pick up exactly where you left off, on a different AI, with full context.'
];

// ── State ─────────────────────────────────────────────────────────────────────

let activeTab = 'chatgpt';
let allSessions = [];
let savedModels = { ...DEFAULT_MODELS };
let activeChromeTabId = null;
let maxHistoryAge = 7 * 24 * 60 * 60 * 1000;

let demoOpen = false;
let demoTimerInterval = null;
let demoTimerSeconds = 15;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const elTabs        = document.getElementById('p-tabs');
const elSaveCount   = document.getElementById('p-savecount');
const elClose       = document.getElementById('p-close');
const elModelSelect = document.getElementById('model-select');
const elDemoToggle  = document.getElementById('demo-toggle');
const elDemoChevron = document.getElementById('demo-chevron');
const elDemoBody    = document.getElementById('demo-body');
const elDemoSteps   = document.getElementById('demo-steps');
const elDemoDesc    = document.getElementById('demo-desc');
const elDemoTimerBar= document.getElementById('demo-timer-bar');
const elSessions    = document.getElementById('p-sessions');
const elSavingName  = document.getElementById('saving-name');
const elSavingCount = document.getElementById('saving-count');
const elChatMessages= document.getElementById('p-chat-messages');
const elInput       = document.getElementById('p-input');
const elSend        = document.getElementById('p-send');
const elFooterStats = document.getElementById('p-footer-stats');
const elClear       = document.getElementById('p-clear');

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

async function init() {
  await detectActiveTab();
  wireTabs();
  wireDemo();
  wireFooterAndInput();
  await loadTier();
  await loadModels();
  await refresh();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'SAVEGA_SESSION_UPDATED') refresh();
  });
}

function mkEl(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function sendBg(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(resp);
    });
  });
}

// ── Active tab detection ──────────────────────────────────────────────────────

function platformFromUrl(url) {
  if (!url) return null;
  if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) return 'chatgpt';
  if (url.includes('claude.ai')) return 'claude';
  if (url.includes('gemini.google.com')) return 'gemini';
  if (url.includes('perplexity.ai')) return 'perplexity';
  return null;
}

function detectActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      activeChromeTabId = tab ? tab.id : null;
      const platform = tab ? platformFromUrl(tab.url) : null;
      if (platform) activeTab = platform;
      resolve();
    });
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function wireTabs() {
  if (!elTabs) return;
  elTabs.querySelectorAll('.p-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.platform;
      highlightActiveTab();
      populateModelSelect();
      updateSessionBar();
    });
  });
  highlightActiveTab();
  if (elClose) elClose.addEventListener('click', () => window.close());
}

function highlightActiveTab() {
  if (!elTabs) return;
  elTabs.querySelectorAll('.p-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.platform === activeTab);
  });
}

// ── Model select ──────────────────────────────────────────────────────────────

async function loadModels() {
  const stored = await new Promise((resolve) => {
    chrome.storage.local.get('savega_models', (r) => resolve(r || {}));
  });
  if (stored.savega_models) savedModels = { ...DEFAULT_MODELS, ...stored.savega_models };
  populateModelSelect();

  if (elModelSelect) {
    elModelSelect.addEventListener('change', () => {
      savedModels[activeTab] = elModelSelect.value;
      chrome.storage.local.set({ savega_models: savedModels });
    });
  }
}

function populateModelSelect() {
  if (!elModelSelect) return;
  elModelSelect.innerHTML = '';
  for (const m of (MODELS[activeTab] || [])) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    if (m === savedModels[activeTab]) opt.selected = true;
    elModelSelect.appendChild(opt);
  }
}

// ── Tier ──────────────────────────────────────────────────────────────────────

async function loadTier() {
  const resp = await sendBg({ type: 'SAVEGA_GET_TIER' });
  if (resp && typeof resp.maxHistoryAge === 'number') maxHistoryAge = resp.maxHistoryAge;
}

// ── Data + render ─────────────────────────────────────────────────────────────

async function refresh() {
  const resp = await sendBg({ type: 'SAVEGA_GET_ALL_SESSIONS' });
  allSessions = (resp && resp.sessions) || [];
  renderSessions();
  updateSessionBar();
  await updateFooterStats();
  updateSaveCount();
  pushPillUpdate();
}

function updateSaveCount() {
  if (elSaveCount) elSaveCount.textContent = String(allSessions.length);
}

function updateSessionBar() {
  if (elSavingName) {
    // Show the active platform name as the session target
    const label = PLATFORM_LABELS[activeTab] || activeTab;
    elSavingName.textContent = '#' + label;
  }
  if (elSavingCount) {
    const count = allSessions.filter(s => s.platform === activeTab).length;
    elSavingCount.textContent = count + ' saved';
  }
}

async function updateFooterStats() {
  const resp = await sendBg({ type: 'SAVEGA_GET_STATS' });
  const count = (resp && typeof resp.count === 'number') ? resp.count : allSessions.length;
  const kb = (resp && typeof resp.kb === 'number') ? resp.kb : 0;
  if (elFooterStats) elFooterStats.textContent = count + ' session' + (count !== 1 ? 's' : '') + ' \u00b7 ' + kb + 'kb';
}

function pushPillUpdate() {
  if (!activeChromeTabId) return;
  chrome.tabs.sendMessage(activeChromeTabId, {
    type: 'SAVEGA_UPDATE_PILL',
    count: allSessions.length
  }).catch(() => {});
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return mins + 'm ago';
  if (hours < 24) return hours + 'h ago';
  return days + 'd ago';
}

// ── Session rendering ─────────────────────────────────────────────────────────

function renderSessions() {
  if (!elSessions) return;
  elSessions.innerHTML = '';

  if (allSessions.length === 0) {
    const empty = mkEl('div', 'p-empty');
    empty.textContent = 'No sessions yet. Start a conversation on any AI platform.';
    elSessions.appendChild(empty);
    return;
  }

  const now = Date.now();

  for (const session of allSessions) {
    const card = mkEl('div', 'p-session-card');
    card.dataset.sessionKey = session.sessionKey;

    const isGated = (now - (session.lastActiveAt || session.startedAt || now)) > maxHistoryAge;
    if (isGated) card.classList.add('blurred');

    // Card content (blurred when gated)
    const content = mkEl('div', 'card-content');

    const top = mkEl('div', 'p-session-top');
    const chipKey = session.platform || 'unknown';
    const chip = mkEl('span', 'p-platform-chip chip-' + chipKey);
    chip.textContent = PLATFORM_LABELS[chipKey] || chipKey.toUpperCase();
    top.appendChild(chip);

    const titleEl = mkEl('span', 'p-session-title');
    titleEl.textContent = session.title || 'Untitled session';
    top.appendChild(titleEl);

    const injectBtn = mkEl('button', 'card-inject-btn');
    injectBtn.textContent = 'Inject';
    injectBtn.title = 'Inject this context into the active AI tab';
    top.appendChild(injectBtn);

    content.appendChild(top);

    const meta = mkEl('div', 'p-session-meta');
    const turnCount = (session.turns || []).length;
    meta.textContent = formatTimeAgo(session.lastActiveAt || session.startedAt || now) +
      ' \u00b7 ' + turnCount + ' turn' + (turnCount !== 1 ? 's' : '');
    content.appendChild(meta);

    const keywords = (session.keywords || []).slice(0, 3);
    if (keywords.length > 0) {
      const kwWrap = mkEl('div', 'p-session-keywords');
      keywords.forEach((kw) => {
        const kwEl = mkEl('span', 'p-kw');
        kwEl.textContent = kw;
        kwWrap.appendChild(kwEl);
      });
      content.appendChild(kwWrap);
    }

    card.appendChild(content);

    if (isGated) {
      const overlay = mkEl('div', 'pro-gate-overlay');
      overlay.textContent = '\ud83d\udd12 Older than 7 days \u2014 upgrade to Pro for full history';
      card.appendChild(overlay);
    } else {
      injectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        injectSession(session.sessionKey, injectBtn);
      });
    }

    elSessions.appendChild(card);
  }
}

function injectSession(sessionKey, btn) {
  if (!activeChromeTabId) {
    btn.textContent = 'No AI tab';
    setTimeout(() => { btn.textContent = 'Inject'; }, 1500);
    return;
  }
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '\u2026';

  chrome.tabs.sendMessage(
    activeChromeTabId,
    { type: 'SAVEGA_INJECT_BY_KEY', sessionKey, mode: 'balanced' },
    (resp) => {
      btn.disabled = false;
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        btn.textContent = 'Failed';
        setTimeout(() => { btn.textContent = original; }, 1500);
        return;
      }
      btn.textContent = 'Done \u2713';
      setTimeout(() => { btn.textContent = original; }, 1500);
    }
  );
}

// ── Demo ──────────────────────────────────────────────────────────────────────

function wireDemo() {
  if (elDemoToggle) elDemoToggle.addEventListener('click', toggleDemo);
  if (elDemoSteps) {
    elDemoSteps.addEventListener('click', (e) => {
      const btn = e.target.closest('.demo-step');
      if (!btn) return;
      highlightStep(parseInt(btn.dataset.step, 10));
      resetDemoTimer();
    });
  }
}

function toggleDemo() {
  demoOpen = !demoOpen;
  if (elDemoBody) elDemoBody.classList.toggle('open', demoOpen);
  if (elDemoChevron) {
    elDemoChevron.classList.toggle('open', demoOpen);
    elDemoChevron.textContent = demoOpen ? '\u25b4' : '\u25be';
  }
  if (demoOpen) {
    highlightStep(0);
    startDemoTimer();
  } else {
    stopDemoTimer();
  }
}

function highlightStep(idx) {
  if (!elDemoSteps) return;
  elDemoSteps.querySelectorAll('.demo-step').forEach((s, i) => {
    s.classList.toggle('active', i === idx);
  });
  if (elDemoDesc) elDemoDesc.textContent = DEMO_DESCRIPTIONS[idx] || '';
}

function startDemoTimer() {
  stopDemoTimer();
  demoTimerSeconds = 15;
  setBarScale(1);
  demoTimerInterval = setInterval(() => {
    demoTimerSeconds -= 0.1;
    setBarScale(Math.max(demoTimerSeconds, 0) / 15);
    if (demoTimerSeconds <= 0) {
      stopDemoTimer();
      if (demoOpen) toggleDemo();
    }
  }, 100);
}

function stopDemoTimer() {
  if (demoTimerInterval) { clearInterval(demoTimerInterval); demoTimerInterval = null; }
}

function resetDemoTimer() {
  demoTimerSeconds = 15;
  setBarScale(1);
  // Restart the countdown
  stopDemoTimer();
  demoTimerInterval = setInterval(() => {
    demoTimerSeconds -= 0.1;
    setBarScale(Math.max(demoTimerSeconds, 0) / 15);
    if (demoTimerSeconds <= 0) {
      stopDemoTimer();
      if (demoOpen) toggleDemo();
    }
  }, 100);
}

function setBarScale(pct) {
  if (elDemoTimerBar) elDemoTimerBar.style.transform = 'scaleX(' + pct + ')';
}

// ── Footer + search input ─────────────────────────────────────────────────────

function wireFooterAndInput() {
  if (elClear) {
    elClear.addEventListener('click', async () => {
      if (!confirm('Clear all saved sessions? This cannot be undone.')) return;
      await sendBg({ type: 'SAVEGA_CLEAR_ALL' });
      await refresh();
    });
  }

  if (elSend) elSend.addEventListener('click', runSearch);
  if (elInput) {
    elInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runSearch(); }
    });
  }
}

async function runSearch() {
  if (!elInput || !elChatMessages) return;
  const query = elInput.value.trim();
  if (!query) return;
  elInput.value = '';

  elChatMessages.hidden = false;
  appendMsg('user', query);

  const resp = await sendBg({ type: 'SAVEGA_SEARCH', query, topN: 4 });
  const results = (resp && resp.results) || [];

  if (results.length === 0) {
    appendMsg('assistant', 'No saved sessions match that. This searches only what Savega has captured on your device — try different keywords from one of your past conversations.');
    return;
  }

  const lines = results.map((s) => {
    const label = PLATFORM_LABELS[s.platform] || s.platform || 'AI';
    return '\u2022 [' + label + '] ' + (s.title || 'Untitled session');
  });
  appendMsg('assistant', 'Found ' + results.length + ' matching session' + (results.length !== 1 ? 's' : '') + ':\n' + lines.join('\n'));
}

function appendMsg(role, text) {
  if (!elChatMessages) return;
  const msg = mkEl('div', 'chat-msg chat-msg-' + role);
  msg.textContent = text; // textContent only — never innerHTML for user content
  elChatMessages.appendChild(msg);
  elChatMessages.scrollTop = elChatMessages.scrollHeight;
}
