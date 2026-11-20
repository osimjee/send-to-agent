/**
 * Send-to-Agent — background service worker (Manifest V3)
 *
 * Responsibilities:
 *  - Build the right-click menu (rebuilt whenever agent tabs open/close/are relabeled)
 *  - Route highlighted text: new web chat (URL injection), an existing labeled agent tab,
 *    or the Background API (streamed into an injected sidebar)
 *  - Own every API key: keys are read here only and never sent to content scripts
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants & settings
// ---------------------------------------------------------------------------

const AGENTS = {
  chatgpt: {
    name: 'ChatGPT',
    newChatUrl: 'https://chatgpt.com/',
    queryUrl: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`,
    queryAutoSends: true, // ?q= sends on its own
    patterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    hosts: ['chatgpt.com', 'chat.openai.com'],
  },
  claude: {
    name: 'Claude',
    newChatUrl: 'https://claude.ai/new',
    queryUrl: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}`,
    queryAutoSends: false, // ?q= only fills the prompt box
    patterns: ['https://claude.ai/*'],
    hosts: ['claude.ai'],
  },
};
const AGENT_PATTERNS = Object.values(AGENTS).flatMap((a) => a.patterns);

/**
 * How we find each agent's prompt box and send button. These are the sites' internal markup
 * and can change without notice. `primary` is what the site uses today. `fallback` entries are
 * generic guesses: a send that only works through one is recorded as "degraded", the early
 * warning that a primary selector has stopped matching.
 */
const SELECTORS = {
  chatgpt: {
    composer: {
      primary: ['#prompt-textarea'],
      fallback: ['div.ProseMirror[contenteditable="true"]', '[contenteditable="true"][role="textbox"]', 'textarea'],
    },
    send: {
      primary: ['button[data-testid="send-button"]', '#composer-submit-button'],
      fallback: ['button[aria-label="Send prompt"]', 'button[aria-label="Send"]', 'form button[type="submit"]'],
    },
    stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
  },
  claude: {
    composer: {
      primary: ['div.ProseMirror[contenteditable="true"]'],
      fallback: ['[contenteditable="true"][role="textbox"]', '[contenteditable="true"]', 'textarea'],
    },
    send: {
      primary: ['button[aria-label="Send message"]'],
      fallback: ['button[aria-label="Send"]', 'button[aria-label*="Send" i]', 'form button[type="submit"]'],
    },
    stop: ['button[aria-label*="Stop" i]'],
  },
};

const HEALTH_KEY = 'selectorHealth';
const SELECTOR_STAGES = ['composer', 'insert', 'send']; // failures that point at the site's markup

const PROVIDERS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  custom: 'Custom API',
};

// Above this URL length, open a blank chat and type the text into the composer instead.
const MAX_QUERY_URL_LENGTH = 6000;
const MAX_LABEL_LENGTH = 32;

const DEFAULT_SETTINGS = {
  routeMethod: 'url', // 'url' | 'api'
  urlTarget: 'chatgpt', // 'chatgpt' | 'claude'
  apiProvider: 'anthropic', // 'openai' | 'anthropic' | 'custom'
  openaiModel: 'gpt-5-mini',
  anthropicModel: 'claude-opus-5-5',
  customBaseUrl: '',
  customModel: '',
  systemPrompt:
    'You are a concise, helpful assistant. The user highlighted text on a webpage and sent it to you. ' +
    'Explain, summarize, or answer questions about it clearly. Use Markdown. Keep answers focused.',
  promptPrefix: '',
  includeSource: false,
  autoSubmit: false, // off: text waits in the prompt box so the user can add instructions
  maxTokens: 16000,
  compactMenu: false, // right-click shows one item that sends to the quick target
};
const QUICK_KEY = 'quickTarget'; // { kind: 'tab', agent, label, tabId } | { kind: 'new', agent } | { kind: 'api' }
const SECRET_KEYS = ['openaiKey', 'anthropicKey', 'customKey'];

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...stored };
}

// ---------------------------------------------------------------------------
// Agent tabs & labels (labels live in storage.session: tab ids don't survive a restart)
// ---------------------------------------------------------------------------

function agentOf(url) {
  if (!url) return null;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const [key, agent] of Object.entries(AGENTS)) {
    if (agent.hosts.includes(host)) return key;
  }
  return null;
}

async function getLabels() {
  const { labels = {} } = await chrome.storage.session.get('labels');
  return labels;
}

async function saveLabels(labels) {
  await chrome.storage.session.set({ labels });
}

function stripLabelPrefix(title = '', label = '') {
  const prefix = label ? `[${label}] ` : '';
  return prefix && title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

/** All open ChatGPT/Claude tabs, with a stable display name ("Claude #2") when unlabeled. */
async function listAgentTabs() {
  const [tabs, labels] = await Promise.all([chrome.tabs.query({ url: AGENT_PATTERNS }), getLabels()]);
  tabs.sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  const counts = {};
  return tabs
    .map((t) => {
      const agent = agentOf(t.url);
      if (!agent) return null;
      counts[agent] = (counts[agent] || 0) + 1;
      const label = labels[t.id] || '';
      return {
        tabId: t.id,
        windowId: t.windowId,
        agent,
        agentName: AGENTS[agent].name,
        label,
        fallbackName: `${AGENTS[agent].name} #${counts[agent]}`,
        title: stripLabelPrefix(t.title || '', label),
        active: t.active,
      };
    })
    .filter(Boolean);
}

async function setLabel(tabId, rawLabel) {
  const label = String(rawLabel || '')
    .replace(/[\[\]\n\r]/g, '')
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
  const labels = await getLabels();
  if (label) labels[tabId] = label;
  else delete labels[tabId];
  await saveLabels(labels);
  await applyLabelToTab(tabId, label);
  scheduleMenuRebuild();
  return label;
}

/** Shows the label in the tab's title ("[Research] Claude") and on the toolbar badge. */
async function applyLabelToTab(tabId, label) {
  try {
    await chrome.action.setBadgeText({ tabId, text: label ? label.slice(0, 4) : '' });
    if (label) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#5b5bd6' });
  } catch {
    /* tab may be gone */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: titleLabeler, args: [label] });
  } catch {
    /* tab still loading or not an agent page anymore; reapplied on load */
  }
}

/** Injected into agent tabs. Keeps "[label] " at the front of the title as the SPA renames itself. */
function titleLabeler(label) {
  const prev = window.__staLabel || '';
  window.__staTitleObserver?.disconnect();
  window.__staLabel = label;
  const strip = (t, l) => (l && t.startsWith(`[${l}] `) ? t.slice(l.length + 3) : t);
  const apply = () => {
    const base = strip(strip(document.title, prev), label);
    const next = label ? `[${label}] ${base}` : base;
    if (document.title !== next) document.title = next;
  };
  apply();
  if (!label) return;
  const observer = new MutationObserver(apply);
  observer.observe(document.head || document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  window.__staTitleObserver = observer;
}

async function reapplyAllLabels() {
  const labels = await getLabels();
  await Promise.all(Object.entries(labels).map(([id, label]) => applyLabelToTab(Number(id), label)));
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

const MENU_ROOT = 'sta-root';
let rebuildTimer = null;
let rebuildChain = Promise.resolve();
let menuTabIds = new Set();

function scheduleMenuRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildChain = rebuildChain.then(rebuildMenus).catch((e) => console.error('[Send-to-Agent] menu', e));
  }, 150);
}

function menuText(s, max = 48) {
  const clean = String(s).replace(/\s+/g, ' ').trim();
  const cut = clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  return cut.replace(/&/g, '&&'); // '&' is a mnemonic marker on some platforms
}

function describeDefault(s) {
  return s.routeMethod === 'api'
    ? `${PROVIDERS[s.apiProvider] || 'API'} sidebar`
    : `new ${AGENTS[s.urlTarget]?.name || 'ChatGPT'} chat`;
}

async function quickShortcut() {
  try {
    const cmds = await chrome.commands.getAll();
    return cmds.find((c) => c.name === QUICK_COMMAND)?.shortcut || '';
  } catch {
    return '';
  }
}

async function rebuildMenus() {
  const [s, tabs, quick, shortcut] = await Promise.all([
    getSettings(),
    listAgentTabs(),
    getQuickTarget(),
    quickShortcut(),
  ]);
  await chrome.contextMenus.removeAll();

  const add = (props) =>
    chrome.contextMenus.create({ contexts: ['selection'], ...props }, () => void chrome.runtime.lastError);
  const hint = shortcut ? `   ${shortcut}` : '';

  const labelItem = () =>
    add({
      id: 'label-tab',
      title: 'Send-to-Agent: label this tab…',
      contexts: ['page'],
      documentUrlPatterns: AGENT_PATTERNS,
    });

  // Compact: a single top-level item, so right-click → one click sends.
  if (s.compactMenu) {
    add(
      quick
        ? { id: 'quick', title: menuText(`Send to ${describeQuick(quick, s)}`, 60) + hint }
        : { id: 'quick', title: 'Send to Agent… (choose where)' + hint }
    );
    labelItem();
    menuTabIds = new Set(tabs.map((t) => t.tabId));
    return;
  }

  add({ id: MENU_ROOT, title: 'Send to Agent' });
  if (quick) add({ id: 'quick', parentId: MENU_ROOT, title: menuText(`Send to ${describeQuick(quick, s)}`, 60) + hint });
  else add({ id: 'default', parentId: MENU_ROOT, title: `Send to default (${describeDefault(s)})` });
  add({ id: 'sep-1', parentId: MENU_ROOT, type: 'separator' });
  add({ id: 'new:chatgpt', parentId: MENU_ROOT, title: 'New ChatGPT chat' });
  add({ id: 'new:claude', parentId: MENU_ROOT, title: 'New Claude chat' });
  add({ id: 'api', parentId: MENU_ROOT, title: `Ask ${PROVIDERS[s.apiProvider]} API (sidebar)` });

  if (tabs.length) {
    add({ id: 'sep-2', parentId: MENU_ROOT, type: 'separator' });
    for (const t of tabs) {
      const title = t.label
        ? `→ ${menuText(t.label, 32)}  (${t.agentName})`
        : `→ ${t.fallbackName} — ${menuText(t.title || 'Untitled', 36)}`;
      add({ id: `tab:${t.tabId}`, parentId: MENU_ROOT, title });
    }
  }

  // Right-click anywhere on a ChatGPT/Claude page to name that tab.
  labelItem();

  menuTabIds = new Set(tabs.map((t) => t.tabId));
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** selectionText from the menu collapses newlines; read the real selection when we can. */
async function readSelection(info, tab) {
  const fallback = (info.selectionText || '').trim();
  if (!tab?.id) return fallback;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
      func: () => String(window.getSelection?.() || ''),
    });
    const text = (res?.result || '').trim();
    return text.length >= fallback.length ? text : fallback;
  } catch {
    return fallback; // PDFs, chrome:// pages, the Web Store, etc.
  }
}

function composeWebPrompt(text, s, tab) {
  const parts = [];
  if (s.promptPrefix.trim()) parts.push(s.promptPrefix.trim());
  parts.push(text);
  if (s.includeSource && tab?.url) parts.push(`Source: ${tab.title ? `${tab.title} — ` : ''}${tab.url}`);
  return parts.join('\n\n');
}

function composeApiPrompt(text, s, tab) {
  const instruction = s.promptPrefix.trim() || 'Explain or summarize the following text.';
  let prompt = `${instruction}\n\n<highlighted_text>\n${text}\n</highlighted_text>`;
  if (s.includeSource && tab?.url) prompt += `\n\nSource page: ${tab.title || ''} (${tab.url})`;
  return prompt;
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => t.status === 'complete' && done(), done);
  });
}

/**
 * Opens a new chat with the prompt. The fast ?q= URL is used only when that site's own
 * behaviour (sends vs. only fills) matches the Auto-send setting; otherwise the text is typed in.
 * `opts.typeIn` always types; `opts.autoSubmit` overrides the setting.
 */
async function openNewChat(agentKey, prompt, s, sourceTab, opts = {}) {
  const key = AGENTS[agentKey] ? agentKey : 'chatgpt';
  const agent = AGENTS[key];
  const autoSubmit = !!(opts.autoSubmit ?? s.autoSubmit);
  const queryUrl = opts.typeIn || agent.queryAutoSends !== autoSubmit ? '' : agent.queryUrl(prompt);
  const createProps = {};
  if (sourceTab?.id !== undefined && sourceTab.id >= 0) {
    createProps.windowId = sourceTab.windowId;
    createProps.index = sourceTab.index + 1;
    createProps.openerTabId = sourceTab.id;
  }

  if (queryUrl && queryUrl.length <= MAX_QUERY_URL_LENGTH) {
    return chrome.tabs.create({ ...createProps, url: queryUrl });
  }
  // Too long for a URL (or typeIn): open a fresh chat and type it in once the composer exists.
  const tab = await chrome.tabs.create({ ...createProps, url: agent.newChatUrl });
  opts.onTab?.(tab);
  await waitForTabComplete(tab.id);
  await deliverToAgentTab(tab.id, key, prompt, autoSubmit);
  return tab;
}

/** Moves a sidebar conversation into a new web chat so the user can keep going there. */
async function continueInChat(agentKey, messages, sourceTab) {
  const turns = messages
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'Me'}:\n${m.content.trim()}`);
  if (!turns.length) return;
  const prompt =
    "Here's a conversation I started in another assistant. Read it, then continue it with me.\n\n" +
    `---\n\n${turns.join('\n\n---\n\n')}\n\n---\n\n`;
  const s = await getSettings();
  // Typed in and left unsent, so the user can add their next question first.
  await openNewChat(agentKey, prompt, s, sourceTab, { typeIn: true, autoSubmit: false });
}

async function sendToExistingTab(tabId, prompt, s, sourceTab) {
  let target;
  try {
    target = await chrome.tabs.get(tabId);
  } catch {
    target = null;
  }
  const agentKey = agentOf(target?.url);
  if (!agentKey) {
    scheduleMenuRebuild(); // stale menu entry
    return openNewChat(s.urlTarget, prompt, s, sourceTab);
  }
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(target.windowId, { focused: true });
  await deliverToAgentTab(tabId, agentKey, prompt, s.autoSubmit);
}

/**
 * Types the prompt into an agent tab, records how well the selectors worked, and on any
 * failure makes sure the user keeps their text (clipboard + banner in the tab).
 */
async function deliverToAgentTab(tabId, agentKey, prompt, autoSubmit) {
  const result = await injectIntoAgentTab(tabId, agentKey, prompt, autoSubmit);
  if (SELECTOR_STAGES.includes(result.stage) || result.ok) await recordHealth(agentKey, result);
  if (!result.ok) {
    console.warn('[Send-to-Agent] delivery failed', agentKey, result);
    await showRecovery(tabId, agentKey, prompt, result);
  }
  return result;
}

async function injectIntoAgentTab(tabId, agentKey, prompt, autoSubmit) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: agentComposerInject,
      args: [prompt, !!autoSubmit, SELECTORS[agentKey]],
    });
    return res?.result || { ok: false, stage: 'inject', reason: 'no-result' };
  } catch (e) {
    return { ok: false, stage: 'inject', reason: e.message };
  }
}

/**
 * Injected into a ChatGPT/Claude tab. Finds the prompt box, inserts text, optionally sends and
 * confirms the send went through. Must be fully self-contained (it is serialized into the page).
 *
 * Returns { ok, stage, reason, composerMatch, sendMatch, usedFallback, submitted, submitMethod,
 *           insertVerified, elapsedMs }. `stage` is where it failed: composer | insert | send.
 */
async function agentComposerInject(text, autoSubmit, selectors) {
  const started = performance.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => el && el.getClientRects().length > 0;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const find = (group) => {
    for (const [tier, list] of [['primary', group.primary], ['fallback', group.fallback]]) {
      for (const sel of list) {
        let el;
        try {
          el = [...document.querySelectorAll(sel)].find(visible);
        } catch {
          continue; // invalid selector: skip it rather than abort
        }
        if (el) return { el, selector: sel, fallback: tier === 'fallback' };
      }
    }
    return null;
  };
  const findAny = (list) => {
    for (const sel of list) {
      try {
        const el = [...document.querySelectorAll(sel)].find(visible);
        if (el) return el;
      } catch {
        /* skip invalid */
      }
    }
    return null;
  };
  const textOf = (el) => (el instanceof HTMLTextAreaElement ? el.value : el?.innerText || '');

  const result = {
    ok: false,
    stage: 'composer',
    reason: '',
    composerMatch: null,
    sendMatch: null,
    usedFallback: false,
    submitted: false,
    submitMethod: null,
    insertVerified: false,
  };
  const done = (patch) => Object.assign(result, patch, { elapsedMs: Math.round(performance.now() - started) });

  // 1. Find the prompt box (the page may still be rendering). Give up after ~5 s.
  let hit = null;
  for (let i = 0; i < 20 && !(hit = find(selectors.composer)); i++) await sleep(250);
  if (!hit) return done({ reason: 'composer-not-found' });
  const el = hit.el;
  result.composerMatch = hit.selector;
  result.usedFallback = hit.fallback;

  // 2. Insert the text and check it landed.
  result.stage = 'insert';
  const snippet = norm(text).slice(0, 60);
  const container = el.closest('form') || el.parentElement?.parentElement || el;
  const htmlBefore = container.innerHTML;
  el.focus();
  if (el instanceof HTMLTextAreaElement) {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setValue.call(el, (el.value.trim() ? `${el.value}\n\n` : '') + text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // Caret to the end, then paste (rich editors handle paste + newlines best).
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    await sleep(250);
    // Large pastes can become an attachment chip instead of text, so any change in the
    // composer's form counts as "something happened"; only retry when nothing changed.
    if (!norm(textOf(el)).includes(snippet) && container.innerHTML === htmlBefore) {
      document.execCommand('insertText', false, text);
      await sleep(150);
    }
  }
  if (norm(textOf(el)).includes(snippet)) result.insertVerified = true;
  else if (container.innerHTML === htmlBefore) return done({ reason: 'text-not-inserted' });

  if (!autoSubmit) return done({ ok: true, stage: null });

  // 3. Send: wait for the button to enable, else fall back to the Enter key.
  result.stage = 'send';
  const urlBefore = location.href;
  const htmlBeforeSend = container.innerHTML;
  let button = null;
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const b = find(selectors.send);
    if (b && !b.el.disabled && b.el.getAttribute('aria-disabled') !== 'true') {
      button = b;
      break;
    }
  }
  if (button) {
    result.sendMatch = button.selector;
    result.usedFallback = result.usedFallback || button.fallback;
    result.submitMethod = 'button';
    button.el.click();
  } else {
    result.usedFallback = true;
    result.submitMethod = 'enter-key';
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
    );
  }

  // 4. Confirm it went through: navigation, a Stop button, or the text leaving the prompt box.
  for (let i = 0; i < 15; i++) {
    await sleep(200);
    const now = find(selectors.composer)?.el;
    const confirmed =
      location.href !== urlBefore ||
      !!findAny(selectors.stop) ||
      !now ||
      (result.insertVerified ? !norm(textOf(now)).includes(snippet) : container.innerHTML !== htmlBeforeSend);
    if (confirmed) return done({ ok: true, stage: null, submitted: true });
  }
  return done({ reason: button ? 'send-not-confirmed' : 'send-button-not-found' });
}

// ---------------------------------------------------------------------------
// Selector health: stored per agent, drives the toolbar badge and the popup's Health row
// ---------------------------------------------------------------------------

async function getHealth() {
  const { [HEALTH_KEY]: health = {} } = await chrome.storage.local.get(HEALTH_KEY);
  return health;
}

/** Stores selectors, timings and versions only, never the user's text or page content. */
async function recordHealth(agentKey, result) {
  const health = await getHealth();
  const prev = health[agentKey] || {};
  const now = Date.now();
  const entry = {
    ...prev,
    extVersion: chrome.runtime.getManifest().version,
    lastAttempt: now,
    lastElapsedMs: result.elapsedMs ?? null,
    lastComposerMatch: result.composerMatch,
    lastSendMatch: result.sendMatch,
    lastSubmitMethod: result.submitMethod,
    // Which parts only worked through a backup, so the popup can say what to fix.
    fallbackUsed: [
      SELECTORS[agentKey]?.composer.fallback.includes(result.composerMatch) && 'composer',
      SELECTORS[agentKey]?.send.fallback.includes(result.sendMatch) && 'send',
      result.submitMethod === 'enter-key' && 'enter-key',
    ].filter(Boolean),
  };
  if (result.ok) {
    entry.status = result.usedFallback ? 'degraded' : 'ok';
    entry.lastOk = now;
    entry.failStreak = 0;
  } else {
    entry.status = 'broken';
    entry.lastFail = now;
    entry.lastFailStage = result.stage;
    entry.lastFailReason = result.reason;
    entry.failStreak = (prev.failStreak || 0) + 1;
  }
  health[agentKey] = entry;
  await chrome.storage.local.set({ [HEALTH_KEY]: health }); // storage.onChanged updates the badge
}

const STATUS_RANK = { ok: 0, degraded: 1, broken: 2 };

/** Global badge: amber "!" if any agent is degraded, red "!" if any is broken. */
async function updateHealthBadge() {
  const health = await getHealth();
  let worst = 'ok';
  const problems = [];
  for (const [key, entry] of Object.entries(health)) {
    const status = entry?.status || 'ok';
    if (STATUS_RANK[status] > STATUS_RANK[worst]) worst = status;
    if (status !== 'ok') problems.push(`${AGENTS[key]?.name || key}: ${status}`);
  }
  await chrome.action.setBadgeText({ text: worst === 'ok' ? '' : '!' });
  if (worst !== 'ok') {
    await chrome.action.setBadgeBackgroundColor({ color: worst === 'broken' ? '#d93848' : '#e8a10f' });
    await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  }
  await chrome.action.setTitle({
    title: problems.length ? `Send-to-Agent: ${problems.join(', ')}. Open for details.` : 'Send-to-Agent',
  });
}

const RECOVERY_MESSAGES = {
  composer: (name) => `Send-to-Agent couldn't find the ${name} prompt box. The site may have changed.`,
  insert: (name) => `Send-to-Agent couldn't type into the ${name} prompt box. The site may have changed.`,
  send: (name) => `Send-to-Agent typed your text but couldn't confirm ${name} sent it. Press Enter to send it.`,
  inject: (name) => `Send-to-Agent couldn't reach this ${name} tab.`,
};

async function showRecovery(tabId, agentKey, prompt, result) {
  const name = AGENTS[agentKey]?.name || 'agent';
  const message = (RECOVERY_MESSAGES[result.stage] || RECOVERY_MESSAGES.inject)(name);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: recoveryBanner,
      args: [message, prompt],
    });
  } catch (e) {
    console.warn('[Send-to-Agent] could not show recovery banner:', e.message);
  }
}

/** Injected into the agent tab on failure: puts the text on the clipboard and explains what happened. */
async function recoveryBanner(message, text) {
  document.querySelector('send-to-agent-banner')?.remove();
  let copied = false;
  try {
    // writeText can hang (not reject) when the page isn't focused, so don't wait on it for long.
    copied = await Promise.race([
      navigator.clipboard.writeText(text).then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
    ]);
  } catch {
    /* clipboard blocked: the Copy button below is the fallback */
  }
  const paste = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Ctrl+V';

  const host = document.createElement('send-to-agent-banner');
  host.style.cssText = 'all: initial; position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .b { display: flex; gap: 12px; align-items: center; max-width: min(560px, calc(100vw - 32px));
         padding: 12px 14px; border-radius: 12px; background: #1c1c21; color: #f3f3f6;
         border-left: 4px solid #d93848; box-shadow: 0 10px 30px rgba(0,0,0,.3);
         font: 13.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .t { flex: 1; } .t small { display: block; color: #b4b4c0; margin-top: 2px; }
    button { font: inherit; cursor: pointer; border-radius: 8px; padding: 6px 10px; }
    .copy { background: #8585f0; color: #0f0f14; border: 0; font-weight: 600; }
    .x { background: none; border: 0; color: #b4b4c0; font-size: 18px; line-height: 1; padding: 4px 6px; }
    button:focus-visible { outline: 2px solid #8585f0; outline-offset: 2px; }`;
  const box = document.createElement('div');
  box.className = 'b';
  box.setAttribute('role', 'alert');
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = message;
  const sub = document.createElement('small');
  sub.textContent = copied
    ? `Your text is on the clipboard. Click the prompt box and press ${paste}.`
    : 'Click "Copy text", then paste it into the prompt box.';
  t.append(sub);
  const copy = document.createElement('button');
  copy.className = 'copy';
  copy.textContent = copied ? 'Copy again' : 'Copy text';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
      sub.textContent = `Click the prompt box and press ${paste}.`;
    } catch {
      copy.textContent = 'Copy failed';
    }
  });
  const close = document.createElement('button');
  close.className = 'x';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', () => host.remove());
  box.append(t, copy, close);
  root.append(style, box);
  document.documentElement.append(host);
  setTimeout(() => host.remove(), 45000);
}

async function openSidebar(tab, text, s) {
  const providerLabel = providerDescription(s);
  const message = {
    type: 'sta:open',
    selection: text,
    prompt: composeApiPrompt(text, s, tab),
    providerLabel,
  };
  try {
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (e) {
    // Restricted pages (chrome://, Web Store, PDF viewer) can't host the sidebar.
    console.warn('[Send-to-Agent] sidebar unavailable here, opening a web chat instead:', e.message);
    await openNewChat(s.urlTarget, composeWebPrompt(text, s, tab), s, tab);
  }
}

async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'sta:ping' });
    if (pong?.ok) return;
  } catch {
    /* not injected yet */
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

function providerDescription(s) {
  const model =
    s.apiProvider === 'openai' ? s.openaiModel : s.apiProvider === 'anthropic' ? s.anthropicModel : s.customModel;
  return `${PROVIDERS[s.apiProvider] || 'API'} · ${model || 'default model'}`;
}

async function promptForLabel(tab) {
  if (!tab?.id || !agentOf(tab.url)) return;
  const labels = await getLabels();
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (current) => window.prompt('Label this agent tab (leave empty to clear):', current),
      args: [labels[tab.id] || ''],
    });
    if (res?.result === null || res?.result === undefined) return; // cancelled
    await setLabel(tab.id, res.result);
  } catch (e) {
    console.warn('[Send-to-Agent] label prompt failed:', e.message);
  }
}

async function handleMenuClick(info, tab) {
  const id = String(info.menuItemId);
  if (id === 'label-tab') return promptForLabel(tab);

  const text = await readSelection(info, tab);
  if (!text) return;
  const s = await getSettings();

  if (id === 'quick') return quickSend(tab, text, s);
  if (id === 'default') {
    return s.routeMethod === 'api'
      ? openSidebar(tab, text, s)
      : openNewChat(s.urlTarget, composeWebPrompt(text, s, tab), s, tab);
  }
  if (id === 'api') return openSidebar(tab, text, s);
  if (id.startsWith('new:')) return openNewChat(id.slice(4), composeWebPrompt(text, s, tab), s, tab);
  if (id.startsWith('tab:')) return sendToExistingTab(Number(id.slice(4)), composeWebPrompt(text, s, tab), s, tab);
}

// ---------------------------------------------------------------------------
// Quick send: one remembered target, reached by the keyboard shortcut or the first menu item
// ---------------------------------------------------------------------------

const QUICK_COMMAND = 'quick-send';

async function getQuickTarget() {
  const { [QUICK_KEY]: t } = await chrome.storage.local.get(QUICK_KEY);
  return t && ['tab', 'new', 'api'].includes(t.kind) ? t : null;
}

function describeQuick(t, s) {
  if (t.kind === 'api') return `${PROVIDERS[s.apiProvider] || 'API'} sidebar`;
  const name = AGENTS[t.agent]?.name || 'chat';
  if (t.kind === 'new') return `new ${name} chat`;
  return t.label ? `${t.label} (${name})` : `${name} tab`;
}

/** The open tab a 'tab' target points at: same label first, then same tab id, same site either way. */
async function resolveQuickTab(t, tabs) {
  tabs = tabs || (await listAgentTabs());
  const sameSite = tabs.filter((x) => x.agent === t.agent);
  return (t.label && sameSite.find((x) => x.label === t.label)) || sameSite.find((x) => x.tabId === t.tabId) || null;
}

/** Choices for the picker and the popup, as { id, title, subtitle }. */
async function quickOptions(s, tabs) {
  const opts = tabs.map((t) => ({
    id: `tab:${t.tabId}`,
    title: t.label || t.fallbackName,
    subtitle: `${t.agentName} tab · ${t.title || 'Untitled chat'}`,
  }));
  opts.push(
    { id: 'new:claude', title: 'New Claude chat', subtitle: 'Opens a new claude.ai tab each time' },
    { id: 'new:chatgpt', title: 'New ChatGPT chat', subtitle: 'Opens a new chatgpt.com tab each time' },
    { id: 'api', title: `${PROVIDERS[s.apiProvider] || 'API'} sidebar`, subtitle: 'Answers in a sidebar on the page, using your API key' }
  );
  return opts;
}

function targetFromOption(id, tabs) {
  if (id === 'api') return { kind: 'api' };
  if (id.startsWith('new:') && AGENTS[id.slice(4)]) return { kind: 'new', agent: id.slice(4) };
  if (id.startsWith('tab:')) {
    const t = tabs.find((x) => x.tabId === Number(id.slice(4)));
    if (t) return { kind: 'tab', agent: t.agent, label: t.label, tabId: t.tabId };
  }
  return null;
}

async function setQuickTarget(target) {
  if (target) await chrome.storage.local.set({ [QUICK_KEY]: target });
  else await chrome.storage.local.remove(QUICK_KEY);
}

/** For the popup: the options, which one is current, and a description of the saved target. */
async function quickInfo() {
  const [s, tabs, t, shortcut] = await Promise.all([getSettings(), listAgentTabs(), getQuickTarget(), quickShortcut()]);
  let currentId = '';
  if (t?.kind === 'api') currentId = 'api';
  else if (t?.kind === 'new') currentId = `new:${t.agent}`;
  else if (t?.kind === 'tab') {
    const open = await resolveQuickTab(t, tabs);
    currentId = open ? `tab:${open.tabId}` : 'saved';
  }
  return {
    options: await quickOptions(s, tabs),
    currentId,
    savedText: t ? describeQuick(t, s) : '',
    shortcut,
    compactMenu: !!s.compactMenu,
  };
}

/** Reads the selection from every frame of the tab and keeps the longest. */
async function readSelectionAllFrames(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => String(window.getSelection?.() || ''),
    });
    return results.map((r) => (r?.result || '').trim()).sort((a, b) => b.length - a.length)[0] || '';
  } catch {
    return null; // chrome:// pages, the Web Store, the PDF viewer
  }
}

async function onQuickCommand(tab) {
  if (!tab?.id) return;
  const text = await readSelectionAllFrames(tab.id);
  if (text === null) return; // Chrome doesn't let extensions run on this page
  if (!text) return pageToast(tab.id, 'Highlight some text first, then press the shortcut again.');
  return quickSend(tab, text, await getSettings());
}

/** Sends to the saved quick target, asking once (on the page) if there isn't one yet. */
async function quickSend(tab, text, s) {
  let target = await getQuickTarget();
  if (!target) {
    target = await pickQuickTarget(tab, s);
    if (!target) return;
  }
  const prompt = composeWebPrompt(text, s, tab);
  if (target.kind === 'api') return openSidebar(tab, text, s);
  if (target.kind === 'new') return openNewChat(target.agent, prompt, s, tab);

  const open = await resolveQuickTab(target);
  if (open) {
    if (open.tabId !== target.tabId || open.label !== target.label) {
      await setQuickTarget({ ...target, tabId: open.tabId, label: open.label || target.label });
    }
    return sendToExistingTab(open.tabId, prompt, s, tab);
  }
  // The tab was closed: open a new chat on the same site and make it the target, label and all.
  const adopt = async (newTab) => {
    if (!newTab?.id) return;
    await setQuickTarget({ ...target, tabId: newTab.id });
    if (target.label) await setLabel(newTab.id, target.label);
  };
  let adopted = false;
  const newTab = await openNewChat(target.agent, prompt, s, tab, {
    onTab: (t) => {
      adopted = true;
      adopt(t);
    },
  });
  if (!adopted) await adopt(newTab);
}

async function pickQuickTarget(tab, s) {
  const tabs = await listAgentTabs();
  const options = await quickOptions(s, tabs);
  let chosen = null;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: quickPicker,
      args: [options, await quickShortcut()],
    });
    chosen = res?.result || null;
  } catch {
    chosen = null; // page doesn't allow scripts: fall back to the popup
  }
  if (!chosen) return null;
  const target = targetFromOption(chosen, tabs);
  if (target) await setQuickTarget(target);
  return target;
}

/** Injected: asks where quick send should go. Resolves to an option id, or null if dismissed. */
function quickPicker(options, shortcut) {
  document.querySelector('send-to-agent-picker')?.remove();
  return new Promise((resolve) => {
    const host = document.createElement('send-to-agent-picker');
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { --bg:#fff; --surface:#f5f5f8; --border:#e2e2e8; --text:#1c1c21; --muted:#6b6b76; --accent:#5b5bd6; }
      @media (prefers-color-scheme: dark) { :host { --bg:#1b1b20; --surface:#25252c; --border:#34343c; --text:#ececf1; --muted:#9a9aa6; --accent:#8585f0; } }
      * { box-sizing: border-box; }
      .scrim { position: fixed; inset: 0; background: rgba(10,10,20,.35); display: grid; place-items: center; padding: 16px;
        font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text); }
      .box { width: min(420px, 100%); max-height: 80vh; overflow: auto; background: var(--bg); border: 1px solid var(--border);
        border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.25); padding: 18px; }
      h2 { margin: 0 0 4px; font-size: 16px; font-weight: 650; }
      p { margin: 0 0 14px; color: var(--muted); font-size: 13px; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
      button.opt { width: 100%; text-align: left; display: grid; grid-template-columns: 22px 1fr; gap: 2px 10px; align-items: baseline;
        padding: 9px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: inherit; font: inherit; cursor: pointer; }
      button.opt:hover, button.opt:focus-visible { border-color: var(--accent); outline: none; }
      .key { grid-row: span 2; color: var(--muted); font-size: 12px; font-weight: 600; }
      .title { font-weight: 600; }
      .sub { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .foot { margin: 14px 0 0; font-size: 12px; }
      .cancel { float: right; border: 0; background: none; color: var(--muted); font: inherit; cursor: pointer; padding: 0; }`;
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    const box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Choose where quick send goes');
    const h = document.createElement('h2');
    h.textContent = 'Where should quick send go?';
    const p = document.createElement('p');
    p.textContent = `Pick once. After this, ${shortcut || 'the shortcut'} sends highlighted text straight there.`;
    const list = document.createElement('ul');
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey, true);
      host.remove();
      resolve(value);
    };
    options.forEach((o, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = i < 9 ? String(i + 1) : '';
      const t = document.createElement('span');
      t.className = 'title';
      t.textContent = o.title;
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = o.subtitle || '';
      b.append(key, t, sub);
      b.addEventListener('click', () => finish(o.id));
      li.append(b);
      list.append(li);
    });
    const foot = document.createElement('p');
    foot.className = 'foot';
    foot.textContent = 'Change it any time in the Send-to-Agent popup.';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => finish(null));
    foot.append(cancel);
    box.append(h, p, list, foot);
    scrim.append(box);
    scrim.addEventListener('click', (e) => e.target === scrim && finish(null));
    root.append(style, scrim);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (/^[1-9]$/.test(e.key) && options[Number(e.key) - 1]) {
        e.preventDefault();
        e.stopPropagation();
        finish(options[Number(e.key) - 1].id);
      }
    };
    document.addEventListener('keydown', onKey, true);
    const timer = setTimeout(() => finish(null), 120000);
    document.documentElement.append(host);
    root.querySelector('button.opt')?.focus();
  });
}

/** Injected: a short message at the top of the page. */
async function pageToast(tabId, message) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [message],
      func: (text) => {
        document.querySelector('send-to-agent-toast')?.remove();
        const host = document.createElement('send-to-agent-toast');
        host.style.cssText = 'all: initial; position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647;';
        const root = host.attachShadow({ mode: 'closed' });
        const box = document.createElement('div');
        box.textContent = text;
        box.setAttribute('role', 'status');
        box.style.cssText =
          'font: 13px/1.4 system-ui, -apple-system, sans-serif; background: #1c1c21; color: #fff; padding: 9px 14px; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.25);';
        root.append(box);
        document.documentElement.append(host);
        setTimeout(() => host.remove(), 3500);
      },
    });
  } catch {
    /* restricted page */
  }
}

// ---------------------------------------------------------------------------
// Background API (streaming)
// ---------------------------------------------------------------------------

class UserFacingError extends Error {}
const inflight = new Map(); // requestId -> AbortController

function supportsServerFallback(model) {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model || '');
}

function buildRequest(s, secrets, messages) {
  const maxTokens = Math.max(256, Math.min(Number(s.maxTokens) || 16000, 64000));

  if (s.apiProvider === 'anthropic') {
    if (!secrets.anthropicKey) throw new UserFacingError('Add your Anthropic API key in the Send-to-Agent popup.');
    const model = s.anthropicModel || DEFAULT_SETTINGS.anthropicModel;
    const headers = {
      'content-type': 'application/json',
      'x-api-key': secrets.anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body = { model, max_tokens: maxTokens, system: s.systemPrompt, messages, stream: true };
    if (supportsServerFallback(model)) {
      // If a safety classifier declines, retry on a fallback model inside the same call.
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }
    return { url: 'https://api.anthropic.com/v1/messages', headers, body, format: 'anthropic' };
  }

  // OpenAI and OpenAI-compatible custom endpoints (Chat Completions).
  const isCustom = s.apiProvider === 'custom';
  const key = isCustom ? secrets.customKey : secrets.openaiKey;
  if (!isCustom && !key) throw new UserFacingError('Add your OpenAI API key in the Send-to-Agent popup.');
  if (isCustom && !s.customBaseUrl) throw new UserFacingError('Set a base URL for your custom API in the popup.');
  const base = isCustom ? s.customBaseUrl.replace(/\/+$/, '') : 'https://api.openai.com/v1';
  const model = isCustom ? s.customModel : s.openaiModel || DEFAULT_SETTINGS.openaiModel;
  if (!model) throw new UserFacingError('Set a model name for your API in the popup.');

  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  const body = {
    model,
    stream: true,
    messages: [{ role: 'system', content: s.systemPrompt }, ...messages],
  };
  if (isCustom) body.max_tokens = maxTokens; // OpenAI's own reasoning models reject max_tokens
  return { url: `${base}/chat/completions`, headers, body, format: 'openai' };
}

async function* readSSE(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r/g, '');
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = rawEvent
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) yield data;
    }
  }
}

async function describeHttpError(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || j?.message || '';
  } catch {
    /* non-JSON body */
  }
  if (res.status === 401 || res.status === 403) return `The API rejected your key (${res.status}). ${detail}`.trim();
  if (res.status === 429) return `Rate limited or out of credits (429). ${detail}`.trim();
  return `API error ${res.status}${detail ? `: ${detail}` : ''}`;
}

async function streamCompletion(tabId, requestId, messages) {
  const controller = new AbortController();
  inflight.set(requestId, controller);
  // Extension API calls reset the service worker idle timer during long generations.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  const post = (type, extra = {}) =>
    chrome.tabs.sendMessage(tabId, { type, requestId, ...extra }).catch(() => controller.abort());

  try {
    const [s, secrets] = await Promise.all([getSettings(), chrome.storage.local.get(SECRET_KEYS)]);
    const req = buildRequest(s, secrets, messages);
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    if (!res.ok) throw new UserFacingError(await describeHttpError(res));

    let note = '';
    for await (const data of readSSE(res.body)) {
      if (data === '[DONE]') break;
      let evt;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }

      if (req.format === 'anthropic') {
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          post('sta:chunk', { text: evt.delta.text });
        } else if (evt.type === 'message_delta') {
          const reason = evt.delta?.stop_reason;
          if (reason === 'max_tokens') note = 'Response cut off at the max token limit.';
          if (reason === 'refusal') note = 'The model declined to answer this request.';
        } else if (evt.type === 'error') {
          throw new UserFacingError(evt.error?.message || 'The API returned an error mid-stream.');
        }
      } else {
        if (evt.error) throw new UserFacingError(evt.error.message || 'The API returned an error mid-stream.');
        const choice = evt.choices?.[0];
        if (choice?.delta?.content) post('sta:chunk', { text: choice.delta.content });
        if (choice?.finish_reason === 'length') note = 'Response cut off at the max token limit.';
        if (choice?.finish_reason === 'content_filter') note = 'The response was stopped by a content filter.';
      }
    }
    post('sta:done', { note });
  } catch (e) {
    if (e.name === 'AbortError') {
      post('sta:done', { note: 'Stopped.' });
    } else {
      const message =
        e instanceof UserFacingError
          ? e.message
          : `Network error: ${e.message}. Check your connection and API base URL.`;
      post('sta:error', { message });
    }
  } finally {
    clearInterval(keepAlive);
    inflight.delete(requestId);
  }
}

// ---------------------------------------------------------------------------
// Event wiring (all listeners registered synchronously at top level)
// ---------------------------------------------------------------------------

const SETTINGS_VERSION = 2;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get([...Object.keys(DEFAULT_SETTINGS), 'settingsVersion']);
  // v2: Auto-send now defaults to off. Earlier installs saved the old default (on), so reset it once.
  if ((current.settingsVersion || 1) < 2) delete current.autoSubmit;
  delete current.settingsVersion;
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...current, settingsVersion: SETTINGS_VERSION });
  scheduleMenuRebuild();
  reapplyAllLabels();
  updateHealthBadge();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleMenuRebuild();
  updateHealthBadge();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleMenuClick(info, tab).catch((e) => console.error('[Send-to-Agent]', e));
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === QUICK_COMMAND) onQuickCommand(tab).catch((e) => console.error('[Send-to-Agent] quick send', e));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (['routeMethod', 'urlTarget', 'apiProvider', 'compactMenu', QUICK_KEY].some((k) => k in changes)) {
    scheduleMenuRebuild();
  }
  if (HEALTH_KEY in changes) updateHealthBadge(); // also fires when the popup resets health
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  const relevant = agentOf(tab.url) || menuTabIds.has(tabId);
  if (!relevant) return;
  if (info.url || info.title !== undefined || info.status === 'complete') scheduleMenuRebuild();
  if (info.status === 'complete') {
    const labels = await getLabels();
    if (labels[tabId]) {
      if (agentOf(tab.url)) applyLabelToTab(tabId, labels[tabId]);
      else setLabel(tabId, ''); // navigated away from the agent
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const labels = await getLabels();
  if (labels[tabId]) {
    delete labels[tabId];
    await saveLabels(labels);
  }
  if (menuTabIds.has(tabId)) scheduleMenuRebuild();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'sta:ask':
      if (sender.tab?.id !== undefined && Array.isArray(msg.messages)) {
        streamCompletion(sender.tab.id, msg.requestId, msg.messages);
      }
      return false;
    case 'sta:cancel':
      inflight.get(msg.requestId)?.abort();
      return false;
    case 'sta:continueInChat':
      if (sender.tab?.id !== undefined && AGENTS[msg.agent] && Array.isArray(msg.messages)) {
        continueInChat(msg.agent, msg.messages, sender.tab).catch((e) =>
          console.warn('[Send-to-Agent] continue in chat failed:', e)
        );
      }
      return false;
    case 'sta:listAgentTabs':
      listAgentTabs().then(sendResponse, () => sendResponse([]));
      return true;
    case 'sta:quickInfo':
      quickInfo().then(sendResponse, () => sendResponse(null));
      return true;
    case 'sta:setQuickTarget':
      (async () => {
        if (msg.optionId === 'saved') return; // unchanged
        const target = msg.optionId ? targetFromOption(String(msg.optionId), await listAgentTabs()) : null;
        await setQuickTarget(target);
      })().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'sta:setLabel':
      setLabel(msg.tabId, msg.label).then(
        (label) => sendResponse({ ok: true, label }),
        (e) => sendResponse({ ok: false, error: e.message })
      );
      return true;
    case 'sta:focusTab':
      chrome.tabs
        .update(msg.tabId, { active: true })
        .then((t) => chrome.windows.update(t.windowId, { focused: true }))
        .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
      return true;
    default:
      return false;
  }
});
