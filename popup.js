'use strict';

const SETTING_FIELDS = [
  'urlTarget',
  'apiProvider',
  'openaiModel',
  'anthropicModel',
  'customBaseUrl',
  'customModel',
  'systemPrompt',
  'promptPrefix',
  'maxTokens',
];
const CHECKBOXES = ['includeSource', 'autoSubmit'];
const SECRET_KEYS = ['openaiKey', 'anthropicKey', 'customKey'];

const $ = (id) => document.getElementById(id);
let statusTimer;

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = kind;
  clearTimeout(statusTimer);
  if (kind === 'ok') statusTimer = setTimeout(() => (el.textContent = ''), 2500);
}

// --------------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------------

function syncVisibility() {
  const route = document.querySelector('input[name="routeMethod"]:checked')?.value || 'url';
  $('urlSettings').hidden = route !== 'url';
  $('apiSettings').hidden = route !== 'api';
  const provider = $('apiProvider').value;
  document.querySelectorAll('[data-provider]').forEach((el) => {
    el.hidden = el.dataset.provider !== provider;
  });
}

function renderKeyHint(name, value) {
  const hint = $(`${name}Hint`);
  hint.replaceChildren();
  if (!value) {
    hint.className = 'hint';
    hint.textContent = name === 'customKey' ? 'No key saved.' : 'No key saved yet.';
    return;
  }
  hint.className = 'hint ok';
  hint.append(`Saved · ends in …${value.slice(-4)} `);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'link';
  clear.textContent = 'Remove';
  clear.addEventListener('click', async () => {
    await chrome.storage.local.remove(name);
    renderKeyHint(name, '');
    setStatus('Key removed.', 'ok');
  });
  hint.append(clear);
}

async function loadSettings() {
  const data = await chrome.storage.local.get([
    'routeMethod',
    ...SETTING_FIELDS,
    ...CHECKBOXES,
    ...SECRET_KEYS,
  ]);
  const route = data.routeMethod === 'api' ? 'api' : 'url';
  $(`route-${route}`).checked = true;
  for (const f of SETTING_FIELDS) if (data[f] !== undefined) $(f).value = data[f];
  for (const f of CHECKBOXES) $(f).checked = !!data[f];
  // Never echo keys back into inputs; show a masked hint instead.
  for (const k of SECRET_KEYS) renderKeyHint(k, data[k]);
  syncVisibility();
}

/** Ask for host access to a custom endpoint (must run inside the click gesture). */
async function requestCustomOrigin(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Custom base URL is not a valid URL.');
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('Custom base URL must use https:// (http:// is allowed only for localhost).');
  }
  const origin = `${url.protocol}//${url.hostname}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error(`Permission to reach ${url.hostname} was declined.`);
}

async function saveSettings() {
  const provider = $('apiProvider').value;
  const customBaseUrl = $('customBaseUrl').value.trim();
  const route = document.querySelector('input[name="routeMethod"]:checked')?.value || 'url';
  setStatus('');

  try {
    // First await in the handler, so Chrome still treats it as a user gesture.
    if (provider === 'custom' && customBaseUrl) await requestCustomOrigin(customBaseUrl);

    const update = { routeMethod: route };
    for (const f of SETTING_FIELDS) update[f] = $(f).value.trim();
    update.systemPrompt = $('systemPrompt').value.trim();
    update.maxTokens = Math.max(256, Math.min(Number($('maxTokens').value) || 16000, 64000));
    for (const f of CHECKBOXES) update[f] = $(f).checked;

    for (const k of SECRET_KEYS) {
      const v = $(k).value.trim();
      if (v) update[k] = v; // empty input = keep the saved key
    }

    if (route === 'api') {
      const existing = await chrome.storage.local.get(SECRET_KEYS);
      const needKey = provider === 'openai' ? 'openaiKey' : provider === 'anthropic' ? 'anthropicKey' : null;
      if (needKey && !update[needKey] && !existing[needKey]) {
        setStatus(`Saved — but add an ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} key to use the API.`, 'error');
      }
    }

    await chrome.storage.local.set(update);
    for (const k of SECRET_KEYS) {
      if (update[k]) {
        renderKeyHint(k, update[k]);
        $(k).value = '';
      }
    }
    if (!$('status').classList.contains('error')) setStatus('Saved.', 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

// --------------------------------------------------------------------------
// Agent tab list
// --------------------------------------------------------------------------

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function renderAgentTabs() {
  const tabs = (await chrome.runtime.sendMessage({ type: 'sta:listAgentTabs' })) || [];
  const list = $('agentTabs');
  list.replaceChildren();
  $('agentTabsEmpty').hidden = tabs.length > 0;

  for (const t of tabs) {
    const row = document.createElement('div');
    row.className = 'tab-row';

    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = t.agentName;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 32;
    input.value = t.label;
    input.placeholder = `Label (shows as “${t.fallbackName}”)`;
    input.setAttribute('aria-label', `Label for ${t.fallbackName}`);
    const save = debounce(async () => {
      await chrome.runtime.sendMessage({ type: 'sta:setLabel', tabId: t.tabId, label: input.value });
      setStatus('Label saved.', 'ok');
      renderQuick(); // tab names in the quick-send list
    }, 400);
    input.addEventListener('input', save);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = t.title || 'Untitled chat';
    title.title = t.title || '';
    meta.append(input, title);

    const go = document.createElement('button');
    go.type = 'button';
    go.textContent = 'Go';
    go.title = 'Switch to this tab';
    go.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'sta:focusTab', tabId: t.tabId }));

    row.append(pill, meta, go);
    list.append(row);
  }
}

// --------------------------------------------------------------------------
// Quick send (keyboard shortcut + first right-click item)
// --------------------------------------------------------------------------

async function renderQuick() {
  const info = await chrome.runtime.sendMessage({ type: 'sta:quickInfo' });
  if (!info) return;
  const select = $('quickTarget');
  select.replaceChildren();
  const add = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    select.append(o);
  };
  add('', 'Ask me the first time');
  if (info.currentId === 'saved') add('saved', `${info.savedText} (closed, opens a new chat)`);
  for (const o of info.options) add(o.id, o.id.startsWith('tab:') ? `${o.title} · ${o.subtitle}` : o.title);
  select.value = info.currentId;

  const row = $('shortcutRow');
  row.replaceChildren();
  row.classList.toggle('unset', !info.shortcut);
  const text = document.createElement('div');
  text.className = 'text';
  const sub = document.createElement('small');
  if (info.shortcut) {
    const key = document.createElement('kbd');
    key.textContent = info.shortcut;
    text.append('Shortcut');
    sub.textContent = 'Highlight text on any page, then press';
    text.append(sub);
    row.append(text, key);
  } else {
    text.append('No keyboard shortcut set');
    sub.textContent = 'Another extension may be using ⌥⇧S. Pick a different one.';
    text.append(sub);
    row.append(text);
  }
  const change = document.createElement('button');
  change.type = 'button';
  change.textContent = info.shortcut ? 'Change' : 'Set shortcut';
  change.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  row.append(change);
  $('compactMenu').checked = info.compactMenu;
}

$('quickTarget').addEventListener('change', async (e) => {
  const res = await chrome.runtime.sendMessage({ type: 'sta:setQuickTarget', optionId: e.target.value });
  setStatus(res?.ok ? 'Quick send updated.' : 'Could not save quick send.', res?.ok ? 'ok' : 'error');
  renderQuick();
});

$('autoSubmit').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ autoSubmit: e.target.checked });
  setStatus(e.target.checked ? 'Text will be sent automatically.' : 'Text will wait for you to press Enter.', 'ok');
});

$('compactMenu').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ compactMenu: e.target.checked });
  setStatus('Menu updated.', 'ok');
});

// --------------------------------------------------------------------------
// Selector health (written by background.js after each send into an agent tab)
// --------------------------------------------------------------------------

const HEALTH_KEY = 'selectorHealth';
const HEALTH_AGENTS = [
  ['chatgpt', 'ChatGPT'],
  ['claude', 'Claude'],
];
const STAGE_WORDS = {
  composer: 'finding the prompt box',
  insert: 'typing into the prompt box',
  send: 'sending',
};
const FALLBACK_WORDS = {
  composer: 'the prompt box only matched a backup selector',
  send: 'the send button only matched a backup selector',
  'enter-key': "the send button wasn't found, so it pressed Enter",
};

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function code(text) {
  const c = document.createElement('code');
  c.textContent = text;
  return c;
}

function healthDetail(entry) {
  const d = document.createElement('div');
  d.className = 'detail';
  if (!entry) {
    d.textContent = 'Not used yet. Checked each time you send to an open tab.';
    return d;
  }
  if (entry.status === 'broken') {
    const streak = entry.failStreak > 1 ? ` (${entry.failStreak} times in a row)` : '';
    d.append(
      `Failed ${ago(entry.lastFail)} while ${STAGE_WORDS[entry.lastFailStage] || 'sending'}${streak}. ` +
        `Last worked: ${ago(entry.lastOk)}. The site may have changed. Update the selectors in background.js.`
    );
    return d;
  }
  d.append(`Worked ${ago(entry.lastOk)}`);
  if (entry.status === 'degraded') {
    const why = (entry.fallbackUsed || []).map((p) => FALLBACK_WORDS[p]).filter(Boolean).join('; ');
    d.append(`, but ${why || 'only through a backup'}. The site may be changing.`);
  } else {
    d.append('.');
  }
  if (entry.lastComposerMatch) d.append(' Prompt box: ', code(entry.lastComposerMatch));
  return d;
}

async function renderHealth() {
  const { [HEALTH_KEY]: health = {} } = await chrome.storage.local.get(HEALTH_KEY);
  const list = $('health');
  list.replaceChildren();
  for (const [key, name] of HEALTH_AGENTS) {
    const entry = health[key];
    const status = entry?.status || 'none';
    const row = document.createElement('div');
    row.className = 'health-row';
    const pill = document.createElement('span');
    pill.className = `status ${status}`;
    pill.textContent = { ok: 'OK', degraded: 'Degraded', broken: 'Broken', none: 'No data' }[status] || status;
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = name;
    body.append(title, healthDetail(entry));
    row.append(pill, body);
    list.append(row);
  }
  $('resetHealth').hidden = Object.keys(health).length === 0;
}

$('resetHealth').addEventListener('click', async () => {
  await chrome.storage.local.remove(HEALTH_KEY);
  setStatus('Health reset.', 'ok');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && HEALTH_KEY in changes) renderHealth();
});

// --------------------------------------------------------------------------
// Wiring
// --------------------------------------------------------------------------

document.querySelectorAll('input[name="routeMethod"]').forEach((r) => r.addEventListener('change', syncVisibility));
$('apiProvider').addEventListener('change', syncVisibility);
$('save').addEventListener('click', saveSettings);
document.querySelectorAll('.reveal').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = $(btn.dataset.for);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
    btn.setAttribute('aria-label', show ? 'Hide key' : 'Show key');
  });
});

loadSettings();
renderQuick();
renderAgentTabs();
renderHealth();
