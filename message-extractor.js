// src/message-extractor.js — extracts conversation turns from DOM for all platforms
/**
 * SELECTOR NOTES:
 * These are the spec-verified selectors for each platform (June 2026).
 * If turns stop being captured, open DevTools on the live site and inspect
 * one user message + one AI message to verify current selectors.
 * The console.warn below will tell you when nothing is matching.
 *
 * Claude: ONLY [data-testid="human-turn"] and [data-testid="ai-turn"] are valid.
 * Never use: user-message, assistant-message — those are banned per spec.
 */
(function () {
  'use strict';

  function queryShadowAll(root, selector) {
    const results = [];
    function walk(node) {
      try {
        node.querySelectorAll(selector).forEach(el => results.push(el));
      } catch (e) { /* ignore bad selector */ }
      node.querySelectorAll('*').forEach(child => {
        if (child.shadowRoot) walk(child.shadowRoot);
      });
    }
    walk(root);
    return results;
  }

  function getTextContent(el) {
    return (el.innerText || el.textContent || '').trim();
  }

  function sortByDomOrder(items) {
    return items.sort((a, b) => {
      try {
        const pos = a.el.compareDocumentPosition(b.el);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      } catch (e) { return 0; }
    });
  }

  function buildTurns(userEls, asstEls) {
    const all = [];
    userEls.forEach(el => all.push({ role: 'user', el }));
    asstEls.forEach(el => all.push({ role: 'assistant', el }));
    sortByDomOrder(all);
    const turns = [];
    all.forEach(({ role, el }) => {
      const text = getTextContent(el);
      if (text) turns.push({ role, text });
    });
    return turns;
  }

  /** Tries each {user, assistant} selector pair in order, uses the first that finds anything. */
  function tryExtract(selectorSets, useShadow) {
    for (const set of selectorSets) {
      const query = useShadow
        ? (sel) => queryShadowAll(document, sel)
        : (sel) => Array.from(document.querySelectorAll(sel));
      const userEls = query(set.user);
      const asstEls = query(set.assistant);
      if (userEls.length > 0 || asstEls.length > 0) {
        return buildTurns(userEls, asstEls);
      }
    }
    return [];
  }

  function extractChatGPT() {
    // Primary: data-message-author-role attribute on each message
    const primary = document.querySelectorAll('[data-message-author-role]');
    if (primary.length > 0) {
      const turns = [];
      primary.forEach(msg => {
        const role = msg.getAttribute('data-message-author-role');
        const text = getTextContent(msg);
        if (text) turns.push({ role: role === 'user' ? 'user' : 'assistant', text });
      });
      return turns;
    }
    // Fallback: alternating conversation-turn nodes
    const convTurns = document.querySelectorAll('[data-testid^="conversation-turn"]');
    const turns = [];
    convTurns.forEach((turn, i) => {
      const text = getTextContent(turn);
      if (text) turns.push({ role: i % 2 === 0 ? 'user' : 'assistant', text });
    });
    if (turns.length === 0) {
      console.warn('[Savega] extractChatGPT: no turns matched any known selector — DOM may have changed');
    }
    return turns;
  }

  function extractClaude() {
    // ONLY valid selectors per spec — never use user-message or assistant-message
    const turns = tryExtract([
      { user: '[data-testid="human-turn"]', assistant: '[data-testid="ai-turn"]' }
    ], false);
    if (turns.length === 0) {
      console.warn('[Savega] extractClaude: no turns matched [data-testid="human-turn"] / [data-testid="ai-turn"] — DOM may have changed');
    }
    return turns;
  }

  function extractGemini() {
    // Angular custom elements inside shadow DOM
    const turns = tryExtract([
      { user: 'user-query', assistant: 'model-response' }
    ], true);
    if (turns.length === 0) {
      console.warn('[Savega] extractGemini: no turns matched user-query / model-response — DOM may have changed');
    }
    return turns;
  }

  function extractPerplexity() {
    const turns = tryExtract([
      { user: '[class*="UserMessage"]', assistant: '[data-testid="answer"]' }
    ], false);
    if (turns.length === 0) {
      console.warn('[Savega] extractPerplexity: no turns matched — DOM may have changed');
    }
    return turns;
  }

  function extractTurns() {
    const platform = window.savegaGetCurrentPlatform ? window.savegaGetCurrentPlatform() : null;
    if (!platform) return [];
    try {
      switch (platform.key) {
        case 'chatgpt':    return extractChatGPT();
        case 'claude':     return extractClaude();
        case 'gemini':     return extractGemini();
        case 'perplexity': return extractPerplexity();
        default:           return [];
      }
    } catch (err) {
      console.error('[Savega] extractTurns error:', err);
      return [];
    }
  }

  window.savegaExtractTurns = extractTurns;
  console.log('[Savega] message-extractor ready');
})();
