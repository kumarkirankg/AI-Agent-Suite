// src/index.js
/**
 * Savega index.js — content script entry point.
 *
 * Responsibilities:
 * 1. Creates the floating pill on the AI page
 * 2. Registers mutation watcher callback to relay captured turns to background
 * 3. Listens for SAVEGA_UPDATE_PILL from popup to sync badge count
 */

(() => {
  'use strict';

  // ── Floating Pill ───────────────────────────────────────────────────────────
  // v8 design: white glass, vertically centred, indigo/violet accent.
  // Position: fixed top:50% transform:translateY(-50%) — NEVER top:60px.
  // Hide: .hide class with composed transform — NEVER inline style.

  function createPill() {
    if (document.querySelector('.savega-pill')) return; // already injected

    // Load DM Serif Display for the pill label
    // (spec: @import only in popup.css; content script injects a <link> instead)
    if (!document.getElementById('savega-font-dmserif')) {
      const link = document.createElement('link');
      link.id = 'savega-font-dmserif';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap';
      document.head.appendChild(link);
    }

    const style = document.createElement('style');
    style.textContent = `
      .savega-pill {
        position: fixed;
        top: 50%;
        right: 0;
        transform: translateY(-50%);
        z-index: 2147483647;
        transition: transform 0.22s ease, opacity 0.22s ease;
        filter: drop-shadow(-3px 2px 12px rgba(0,0,0,.18));
      }

      .savega-pill.hide {
        transform: translateY(-50%) translateX(110%);
        opacity: 0;
        pointer-events: none;
      }

      .pill-btn {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 12px 16px 12px 13px;
        background: rgba(255,255,255,.96);
        border-radius: 14px 0 0 14px;
        border: 1px solid rgba(0,0,0,.09);
        border-right: none;
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        transition: transform 0.15s ease;
      }

      .pill-btn:hover {
        transform: translateX(-4px);
      }

      .pill-accent {
        width: 4px;
        align-self: stretch;
        border-radius: 2px;
        background: linear-gradient(180deg, #6366f1, #a855f7);
        flex-shrink: 0;
      }

      .pill-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #22c55e;
        animation: gpulse 2s infinite;
        flex-shrink: 0;
      }

      @keyframes gpulse {
        0%   { box-shadow: 0 0 0 0 rgba(34,197,94,0.55); }
        60%  { box-shadow: 0 0 0 5px rgba(34,197,94,0); }
        100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
      }

      .pill-label {
        font-family: 'DM Serif Display', Georgia, serif;
        font-size: 15px;
        font-weight: 400;
        color: #1c1917;
        white-space: nowrap;
        line-height: 1;
      }

      .pill-count {
        font-size: 11px;
        font-weight: 700;
        background: linear-gradient(135deg, #6366f1, #a855f7);
        color: #fff;
        padding: 2px 6px;
        border-radius: 8px;
        min-width: 18px;
        text-align: center;
        line-height: 1.4;
      }
    `;
    document.head.appendChild(style);

    const pill = document.createElement('div');
    pill.className = 'savega-pill hide'; // start hidden until we have sessions

    const btn = document.createElement('div');
    btn.className = 'pill-btn';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', 'Savega — open memory panel');

    const accent = document.createElement('div');
    accent.className = 'pill-accent';

    const dot = document.createElement('div');
    dot.className = 'pill-dot';

    const label = document.createElement('span');
    label.className = 'pill-label';
    label.textContent = 'Savega';

    const count = document.createElement('span');
    count.className = 'pill-count';
    count.textContent = '0';

    btn.appendChild(accent);
    btn.appendChild(dot);
    btn.appendChild(label);
    btn.appendChild(count);
    pill.appendChild(btn);
    document.body.appendChild(pill);

    // Click opens the extension popup (keyboard accessible too)
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SAVEGA_OPEN_POPUP' }).catch(() => {});
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
    });
  }

  function updatePillCount(count) {
    const pill = document.querySelector('.savega-pill');
    if (!pill) return;
    const badge = pill.querySelector('.pill-count');
    if (badge) badge.textContent = String(count);
    // Show pill when there is at least one session; hide when empty
    pill.classList.toggle('hide', count <= 0);
  }

  // ── Capture pipeline ─────────────────────────────────────────────────────────

  async function handleNewTurns(turns) {
    const platform = window.savegaGetCurrentPlatform ? window.savegaGetCurrentPlatform() : null;
    if (!platform) return;

    const sessionKey = window.location.hostname + window.location.pathname;

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'SAVEGA_CAPTURE_TURNS',
        platform: platform.key,
        sessionKey,
        turns
      });
      if (resp && resp.ok) {
        updatePillCount(resp.count);
        // Notify popup if open so it can refresh its session list
        chrome.runtime.sendMessage({ type: 'SAVEGA_SESSION_UPDATED' }).catch(() => {});
      }
    } catch (err) {
      if (!String(err).includes('Extension context invalidated')) {
        console.warn('[Savega] capture relay failed:', err);
      }
    }
  }

  // ── Wire mutation watcher ────────────────────────────────────────────────────

  if (window.savegaMutationWatcher) {
    window.savegaMutationWatcher.onNewTurns(handleNewTurns);
  } else {
    console.warn('[Savega] index: mutation watcher not found — capture pipeline will not run');
  }

  // ── Pill badge updates from popup (e.g. after Clear All) ─────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'SAVEGA_UPDATE_PILL') {
      if (typeof msg.count === 'number') updatePillCount(msg.count);
      sendResponse({ ok: true });
    }
  });

  // ── Boot ─────────────────────────────────────────────────────────────────────

  function boot() {
    createPill();
    // Sync badge with current stored session count on page load
    chrome.runtime.sendMessage({ type: 'SAVEGA_GET_STATS' }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (resp && typeof resp.count === 'number') updatePillCount(resp.count);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function checkGlobals() {
    const required = [
      'savegaGetCurrentPlatform', 'savegaExtractTurns', 'savegaMutationWatcher',
      'savegaStreamGuard', 'savegaCompressor', 'savegaInjector', 'savegaDetector'
    ];
    const missing = required.filter(k => !window[k]);
    if (missing.length > 0) console.warn('[Savega] index: missing globals:', missing.join(', '));
  }
  setTimeout(checkGlobals, 500);

  console.log('[Savega] index ready');
})();
