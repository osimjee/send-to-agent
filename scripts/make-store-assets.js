#!/usr/bin/env node
/**
 * Renders the Chrome Web Store screenshots and promo tiles into docs/store/.
 * Uses the real popup, sidebar and picker code with a stubbed chrome API, inside a
 * mock browser window, and screenshots them with headless Chrome.
 *
 * Usage: node scripts/make-store-assets.js
 * Needs Google Chrome at the default macOS path (or set CHROME=/path/to/chrome).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs/store');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'sta-assets-'));
const url = (p) => 'file://' + p;
const rootUrl = url(ROOT) + '/';

// The picker function, copied out of background.js so the screenshot shows the real UI.
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const start = bg.indexOf('function quickPicker(');
const quickPicker = bg.slice(start, bg.indexOf('\n}\n', start) + 3);

const ARTICLE = `
  <article>
    <p class="kicker">Kitchen science</p>
    <h1>Why your sourdough starter smells like nail polish</h1>
    <p class="by">8 min read</p>
    <p>A starter is a small, hungry ecosystem of wild yeast and lactic acid bacteria. Feed it flour and water and the
    yeast make carbon dioxide while the bacteria make acids, which give sourdough its tang and keep other microbes out.</p>
    <p><mark>When a starter runs out of food, stressed yeast start producing ethyl acetate, the same solvent found in
    nail polish remover. The sharp smell is a hunger signal, not spoilage: a feeding at a higher ratio, such as
    1:5:5 starter to flour to water, usually clears it within a day or two.</mark></p>
    <p>Temperature matters as much as food. Below about 20 °C the bacteria outpace the yeast, so the starter gets
    sour but rises slowly. Above 28 °C everything speeds up and a starter can burn through its flour in a few hours.</p>
    <p>If the smell comes back right after every feeding, try a stiffer starter with less water, or move it somewhere
    a little cooler overnight.</p>
  </article>`;

const ARTICLE_CSS = `
  html, body { margin: 0; background: #fff; color: #1d1d22; }
  body { font: 18px/1.65 Georgia, "Times New Roman", serif; }
  article { max-width: 640px; margin: 0 0 0 64px; padding: 40px 0 60px; }
  .kicker { font: 600 12px/1 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #8a5a2b; margin: 0 0 12px; }
  h1 { font-size: 34px; line-height: 1.2; margin: 0 0 8px; }
  .by { font: 13px system-ui, sans-serif; color: #888; margin: 0 0 24px; }
  mark { background: #b4d5fe; color: inherit; }`;

const STUB = `
<script>
  window.chrome = { runtime: {
    getURL: (p) => ${JSON.stringify(rootUrl)} + p,
    onMessage: { addListener: (f) => (window.__listener = f), removeListener() {} },
    sendMessage: async (m) => {
      if (m.type !== 'sta:ask') return;
      const reply = window.__replies.shift() || '';
      setTimeout(() => window.__listener({ type: 'sta:chunk', requestId: m.requestId, text: reply }), 5);
      setTimeout(() => window.__listener({ type: 'sta:done', requestId: m.requestId }), 10);
    } } };
</script>`;

function page(name, body, extraHead = '') {
  const file = path.join(WORK, name);
  fs.writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${ARTICLE_CSS}</style>${extraHead}</head><body>${body}</body></html>`
  );
  return file;
}

// --- Inner pages (what's inside the mock browser) -------------------------------

const pickerPage = page(
  'picker.html',
  ARTICLE +
    `<script>${quickPicker.replace(/<\//g, '<\\/')}
    quickPicker([
      { id: 'tab:1', title: 'Research', subtitle: 'Claude tab · Fermentation notes' },
      { id: 'tab:2', title: 'Code review', subtitle: 'ChatGPT tab · PR #214 feedback' },
      { id: 'new:claude', title: 'New Claude chat', subtitle: 'Opens a new claude.ai tab each time' },
      { id: 'new:chatgpt', title: 'New ChatGPT chat', subtitle: 'Opens a new chatgpt.com tab each time' },
      { id: 'api', title: 'Anthropic sidebar', subtitle: 'Answers in a sidebar on the page, using your API key' },
    ], '⌥⇧S');
  </script>`
);

const sidebarPage = page(
  'sidebar.html',
  ARTICLE +
    STUB +
    `<script>
    window.__replies = [
      "**Short version:** the smell means the starter is hungry, not spoiled.\\n\\n" +
      "- **Why:** when flour runs out, stressed yeast make *ethyl acetate*, the solvent in nail polish remover.\\n" +
      "- **Fix:** feed at a higher ratio (1:5:5) for a day or two."
    ];
  </script>
  <script src="${rootUrl}content.js"></script>
  <script>
    setTimeout(() => {
      window.__listener({ type: 'sta:open', providerLabel: 'Anthropic · claude-opus-5-5',
        selection: document.querySelector('mark').textContent.replace(/\\s+/g, ' ').trim(), prompt: 'p' });
    }, 50);
  </script>`
  );

const menuPage = page(
  'menu.html',
  ARTICLE +
    `<style>
    .menu { position: absolute; font: 13px/1 system-ui, -apple-system, sans-serif; color: #1d1d22; background: #f6f6f6;
      border: 1px solid rgba(0,0,0,.12); border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.18); padding: 5px; min-width: 210px; }
    .menu div { padding: 6px 10px; border-radius: 5px; display: flex; gap: 24px; justify-content: space-between; white-space: nowrap; }
    .menu .on { background: #2f6fde; color: #fff; }
    .menu hr { border: 0; border-top: 1px solid rgba(0,0,0,.1); margin: 5px 6px; }
    .menu .key { opacity: .6; }
    .menu .on .key { opacity: .9; }
    .menu .arrow::after { content: '›'; }
  </style>
  <div class="menu" style="left: 420px; top: 150px;">
    <div>Copy</div><div>Look Up</div><hr><div>Print…</div><hr>
    <div class="on arrow">Send to Agent</div>
  </div>
  <div class="menu" style="left: 636px; top: 210px;">
    <div class="on">Send to Research (Claude)<span class="key">⌥⇧S</span></div><hr>
    <div>New ChatGPT chat</div><div>New Claude chat</div><div>Ask Anthropic API (sidebar)</div><hr>
    <div>→ Research  (Claude)</div><div>→ Code review  (ChatGPT)</div><div>→ ChatGPT #2 — Trip planning</div>
  </div>`
);

const popupStub = path.join(WORK, 'popup-stub.js');
fs.writeFileSync(
  popupStub,
  `window.chrome = {
    runtime: { sendMessage: async (m) => m.type === 'sta:quickInfo'
      ? { options: [{ id: 'tab:1', title: 'Research', subtitle: 'Claude tab · Fermentation notes' }, { id: 'new:claude', title: 'New Claude chat' }],
          currentId: 'tab:1', savedText: 'Research (Claude)', shortcut: '⌥⇧S', compactMenu: false }
      : m.type === 'sta:listAgentTabs'
      ? [{ tabId: 1, agentName: 'Claude', label: 'Research', fallbackName: 'Claude #1', title: 'Fermentation notes' },
         { tabId: 2, agentName: 'ChatGPT', label: 'Code review', fallbackName: 'ChatGPT #1', title: 'PR #214 feedback' }]
      : null },
    storage: { local: { get: async (k) => (k === 'selectorHealth' ? { selectorHealth: {
        chatgpt: { status: 'ok', lastOk: Date.now() - 120000, lastComposerMatch: '#prompt-textarea' },
        claude: { status: 'ok', lastOk: Date.now() - 40000, lastComposerMatch: 'div.ProseMirror[contenteditable="true"]' } } } : {}),
      set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
    permissions: { request: async () => true }, tabs: { create() {} } };`
);
const popupPage = path.join(WORK, 'popup.html');
fs.writeFileSync(
  popupPage,
  fs
    .readFileSync(path.join(ROOT, 'popup.html'), 'utf8')
    .replace('<script src="popup.js"></script>', `<script src="${url(popupStub)}"></script><script src="${rootUrl}popup.js"></script>`)
    .replace('src="icons/icon48.png"', `src="${rootUrl}icons/icon48.png"`)
    .replace('<body>', '<body style="overflow:hidden">')
);
const popupWithArticle = page(
  'popup-over-article.html',
  ARTICLE +
    `<iframe src="${url(popupPage)}" style="position:absolute; right:14px; top:6px; width:370px; height:500px; border:0;
       border-radius:12px; box-shadow:0 14px 40px rgba(0,0,0,.25); background:#fff"></iframe>`
);

// --- Frames (store-sized images) ------------------------------------------------

const FRAME_CSS = `
  html, body { margin: 0; }
  body { width: 1280px; height: 800px; overflow: hidden; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: radial-gradient(120% 120% at 0% 0%, #6b6be0 0%, #4646c4 55%, #34349e 100%); color: #fff; }
  .cap { position: absolute; left: 80px; right: 80px; top: 44px; }
  .cap h2 { margin: 0 0 8px; font-size: 36px; font-weight: 700; letter-spacing: -0.02em; }
  .cap p { margin: 0; font-size: 18px; opacity: .85; }
  .win { position: absolute; left: 80px; top: 170px; width: 1120px; height: 600px; border-radius: 12px; overflow: hidden;
    background: #fff; box-shadow: 0 30px 80px rgba(10,10,40,.45); }
  .tabs { height: 38px; background: #dfe1e5; display: flex; align-items: flex-end; gap: 2px; padding: 0 10px 0 80px; position: relative; }
  .dots { position: absolute; left: 14px; top: 13px; display: flex; gap: 7px; }
  .dots i { width: 12px; height: 12px; border-radius: 50%; background: #ff5f57; display: block; }
  .dots i:nth-child(2) { background: #febc2e; } .dots i:nth-child(3) { background: #28c840; }
  .tab { font-size: 12px; color: #3c4043; padding: 9px 14px; border-radius: 8px 8px 0 0; width: 190px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tab.on { background: #fff; color: #1d1d22; }
  .bar { height: 42px; background: #fff; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-bottom: 1px solid #e3e3e8; }
  .url { flex: 1; height: 28px; border-radius: 14px; background: #f1f3f4; color: #5f6368; font-size: 13px; display: flex; align-items: center; padding: 0 14px; }
  .ext { position: relative; width: 22px; height: 22px; }
  .ext img { width: 20px; height: 20px; border-radius: 5px; }
  .ext b { position: absolute; right: -8px; bottom: -5px; background: #5b5bd6; color: #fff; font: 700 9px/1 system-ui; padding: 2px 3px; border-radius: 3px; }
  iframe { border: 0; width: 100%; height: 520px; display: block; }`;

function frame(name, caption, sub, inner, tabs = ['Why your sourdough starter smells…']) {
  const file = path.join(WORK, name);
  const tabHtml = tabs.map((t, i) => `<div class="tab${i === 0 ? ' on' : ''}">${t}</div>`).join('');
  fs.writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_CSS}</style></head><body>
      <div class="cap"><h2>${caption}</h2><p>${sub}</p></div>
      <div class="win">
        <div class="tabs"><div class="dots"><i></i><i></i><i></i></div>${tabHtml}</div>
        <div class="bar"><div class="url">kitchen-notes.example/sourdough/starter-smells</div>
          <div class="ext"><img src="${rootUrl}icons/icon48.png"></div></div>
        <iframe src="${url(inner)}"></iframe>
      </div></body></html>`
  );
  return file;
}

const TABS = ['Why your sourdough starter smells…', '[Research] Fermentation notes', '[Code review] PR #214 feedback'];

const shots = [
  ['screenshot-1-quick-send.png', 1280, 800, frame('f1.html', 'Highlight. Press ⌥⇧S. Done.',
    'Pick where it goes once. After that, one keystroke sends your highlight there.', pickerPage, TABS)],
  ['screenshot-2-sidebar.png', 1280, 800, frame('f2.html', 'Answers right next to what you’re reading',
    'Use your own OpenAI or Anthropic key. Ask follow-ups, then continue in ChatGPT or Claude.', sidebarPage)],
  ['screenshot-3-menu.png', 1280, 800, frame('f3.html', 'Label your chats, send to the right one',
    'Several ChatGPT and Claude tabs open? Name them and pick from the right-click menu.', menuPage, TABS)],
  ['screenshot-4-popup.png', 1280, 800, frame('f4.html', 'Your text waits for your instructions',
    'It lands in the prompt box unsent, so you can add “explain this simply” first. Or send it automatically.', popupWithArticle, TABS)],
];

// --- Promo tiles ------------------------------------------------------------------

function tile(name, w, h, scale) {
  const file = path.join(WORK, name);
  fs.writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>
      html, body { margin: 0; }
      body { width: ${w}px; height: ${h}px; overflow: hidden; display: grid; place-items: center; color: #fff;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        background: radial-gradient(120% 140% at 0% 0%, #6b6be0 0%, #4646c4 55%, #34349e 100%); }
      .wrap { display: flex; align-items: center; gap: ${28 * scale}px; }
      img { width: ${96 * scale}px; height: ${96 * scale}px; border-radius: ${22 * scale}px; box-shadow: 0 ${10 * scale}px ${30 * scale}px rgba(0,0,0,.3); }
      h1 { margin: 0; font-size: ${44 * scale}px; letter-spacing: -0.02em; }
      p { margin: ${8 * scale}px 0 0; font-size: ${18 * scale}px; opacity: .9; display: flex; align-items: center; gap: ${8 * scale}px; }
      kbd { font: 700 ${16 * scale}px/1 ui-monospace, Menlo, monospace; background: #fff; color: #34349e; padding: ${5 * scale}px ${8 * scale}px;
        border-radius: ${6 * scale}px; box-shadow: 0 ${3 * scale}px 0 rgba(0,0,0,.25); }
    </style></head><body><div class="wrap"><img src="${rootUrl}icons/icon128.png">
      <div><h1>Send-to-Agent</h1><p>Highlight <kbd>⌥⇧S</kbd> to ChatGPT or Claude</p></div></div></body></html>`
  );
  return file;
}
shots.push(['promo-small-440x280.png', 440, 280, tile('t1.html', 440, 280, 0.62)]);
shots.push(['promo-marquee-1400x560.png', 1400, 560, tile('t2.html', 1400, 560, 1.5)]);

// --- Render -----------------------------------------------------------------------

for (const [out, w, h, file] of shots) {
  const target = path.join(OUT, out);
  execFileSync(CHROME, [
    '--headless=new', `--user-data-dir=${path.join(WORK, 'profile')}`, '--allow-file-access-from-files',
    '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=3000',
    `--window-size=${w},${h}`, `--screenshot=${target}`, url(file),
  ], { stdio: 'ignore' });
  console.log('wrote', path.relative(ROOT, target));
}
fs.rmSync(WORK, { recursive: true, force: true });
