/**
 * Send-to-Agent — response sidebar.
 * Injected on demand (activeTab) only when the user picks the API route.
 * Renders inside a closed Shadow DOM so page styles can't leak in or out.
 * Never sees API keys: it only sends messages to the background worker.
 */
(() => {
  'use strict';

  // Re-injection (e.g. after the extension reloads) replaces the old instance cleanly.
  try {
    window.__staTeardown?.();
  } catch {
    /* old context invalidated */
  }

  const state = {
    messages: [], // [{ role: 'user'|'assistant', content }]
    requestId: null,
    buffer: '',
    assistantEl: null,
    renderQueued: false,
  };
  let host = null;
  let ui = null;

  // ------------------------------------------------------------------------
  // Markdown (minimal, escape-first: every byte of model output is HTML-escaped
  // before any formatting tags are added, so responses can't inject markup)
  // ------------------------------------------------------------------------

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);

  function inline(raw) {
    // Split out code spans first so their contents aren't formatted.
    return raw
      .split(/(`[^`\n]+`)/g)
      .map((part) => {
        if (/^`[^`\n]+`$/.test(part)) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
        return escapeHtml(part)
          .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
          .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
          .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
          .replace(
            /\[([^\]\n]+)\]\((https?:\/\/[^\s)"]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
          );
      })
      .join('');
  }

  function renderMarkdown(src) {
    const lines = src.replace(/\r/g, '').split('\n');
    const out = [];
    let para = [];
    let list = null; // { tag, items: [] }
    let quote = [];

    const flushPara = () => {
      if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
      list = null;
    };
    const flushQuote = () => {
      if (quote.length) out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      quote = [];
    };
    const flushAll = () => {
      flushPara();
      flushList();
      flushQuote();
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
      if (fence) {
        flushAll();
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
        const lang = fence[1] ? ` data-lang="${escapeHtml(fence[1])}"` : '';
        out.push(`<pre${lang}><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }
      if (!line.trim()) {
        flushAll();
        continue;
      }
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushAll();
        const level = Math.min(m[1].length + 2, 6); // h1 -> h3 … keeps the sidebar compact
        out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flushAll();
        out.push('<hr>');
      } else if ((m = line.match(/^\s*>\s?(.*)$/))) {
        flushPara();
        flushList();
        quote.push(m[1]);
      } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara();
        flushQuote();
        const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
        if (!list || list.tag !== tag) {
          flushList();
          list = { tag, items: [] };
        }
        list.items.push(m[1]);
      } else if (list && /^\s{2,}\S/.test(line)) {
        list.items[list.items.length - 1] += ` ${line.trim()}`; // wrapped list item
      } else {
        flushList();
        flushQuote();
        para.push(line.trim());
      }
    }
    flushAll();
    return out.join('');
  }

  // ------------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------------

  const ICONS = {
    close:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    copy:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    send:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7-8-1z" fill="currentColor"/></svg>',
    newChat:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  const EMPTY_HINT = 'Highlight text on the page and pick “Ask … API”, or type a question below.';

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function buildSidebar() {
    host = document.createElement('send-to-agent-sidebar');
    host.style.cssText = 'all: initial; position: fixed; inset: 0 0 0 auto; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'closed' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content.css');

    const panel = el('aside', 'panel');
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'Send-to-Agent response');
    panel.tabIndex = -1;

    const header = el('header', 'header');
    const brand = el('div', 'brand');
    brand.append(el('span', 'dot'), el('span', 'name'));
    brand.lastChild.textContent = 'Send-to-Agent';
    const provider = el('div', 'provider');
    const titles = el('div', 'titles');
    titles.append(brand, provider);
    const newChatBtn = el('button', 'icon-btn', ICONS.newChat);
    newChatBtn.type = 'button';
    newChatBtn.title = 'New chat';
    newChatBtn.setAttribute('aria-label', 'Start a new chat');
    const closeBtn = el('button', 'icon-btn', ICONS.close);
    closeBtn.type = 'button';
    closeBtn.title = 'Close (Esc). The conversation is kept until you reload the page.';
    closeBtn.setAttribute('aria-label', 'Close sidebar');
    header.append(titles, newChatBtn, closeBtn);

    const thread = el('div', 'thread');
    thread.setAttribute('aria-live', 'polite');

    // "Continue in" moves the whole conversation into a real web chat.
    const actions = el('div', 'actions');
    const actionsLabel = el('span', 'actions-label');
    actionsLabel.textContent = 'Continue in';
    const continueBtns = [
      ['claude', 'Claude'],
      ['chatgpt', 'ChatGPT'],
    ].map(([agent, name]) => {
      const b = el('button', 'chip');
      b.type = 'button';
      b.textContent = name;
      b.title = `Open this conversation in a new ${name} chat`;
      b.addEventListener('click', () => continueIn(agent));
      return b;
    });
    actions.append(actionsLabel, ...continueBtns);
    actions.hidden = true;

    const form = el('form', 'composer');
    const textarea = document.createElement('textarea');
    textarea.rows = 1;
    textarea.placeholder = 'Ask a follow-up…';
    textarea.setAttribute('aria-label', 'Follow-up question');
    const sendBtn = el('button', 'send-btn', ICONS.send);
    sendBtn.type = 'submit';
    sendBtn.setAttribute('aria-label', 'Send follow-up');
    const stopBtn = el('button', 'stop-btn');
    stopBtn.type = 'button';
    stopBtn.textContent = 'Stop';
    stopBtn.hidden = true;
    form.append(textarea, stopBtn, sendBtn);

    panel.append(header, thread, actions, form);
    root.append(link, panel);
    // Avoid a flash of unstyled content while the stylesheet loads.
    panel.style.visibility = 'hidden';
    link.addEventListener('load', () => (panel.style.visibility = ''), { once: true });
    link.addEventListener('error', () => (panel.style.visibility = ''), { once: true });

    closeBtn.addEventListener('click', close);
    newChatBtn.addEventListener('click', newChat);
    stopBtn.addEventListener('click', stop);
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
      // Keep page shortcuts (e.g. "/" for search) from firing while typing here.
      e.stopPropagation();
    });
    textarea.addEventListener('input', () => autosize(textarea));
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = textarea.value.trim();
      if (!q || state.requestId) return;
      textarea.value = '';
      autosize(textarea);
      addUserBubble(q);
      state.messages.push({ role: 'user', content: q });
      ask();
    });

    document.documentElement.append(host);
    ui = { panel, provider, thread, actions, continueBtns, textarea, sendBtn, stopBtn };
  }

  function updateActions() {
    if (!ui) return;
    ui.actions.hidden = !state.messages.some((m) => m.role === 'assistant');
    for (const b of ui.continueBtns) b.disabled = !!state.requestId;
  }

  function showEmptyHint() {
    const hint = el('p', 'empty');
    hint.textContent = EMPTY_HINT;
    ui.thread.append(hint);
  }

  function autosize(t) {
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
  }

  function nearBottom() {
    const t = ui.thread;
    return t.scrollHeight - t.scrollTop - t.clientHeight < 80;
  }

  function scrollToEnd(force = false) {
    if (force || nearBottom()) ui.thread.scrollTop = ui.thread.scrollHeight;
  }

  function addSelectionBubble(text) {
    const wrap = el('div', 'msg user selection');
    const label = el('div', 'msg-label');
    label.textContent = 'Highlighted text';
    const quote = el('blockquote', 'quote clamped');
    quote.textContent = text;
    wrap.append(label, quote);
    if (text.length > 280 || text.split('\n').length > 5) {
      const more = el('button', 'text-btn');
      more.type = 'button';
      more.textContent = 'Show all';
      more.addEventListener('click', () => {
        const clamped = quote.classList.toggle('clamped');
        more.textContent = clamped ? 'Show all' : 'Show less';
      });
      wrap.append(more);
    }
    ui.thread.append(wrap);
  }

  function addUserBubble(text) {
    const wrap = el('div', 'msg user');
    const body = el('div', 'bubble');
    body.textContent = text;
    wrap.append(body);
    ui.thread.append(wrap);
    scrollToEnd(true);
  }

  function addAssistantBubble() {
    const wrap = el('div', 'msg assistant');
    const body = el('div', 'md');
    body.append(el('span', 'typing', '<i></i><i></i><i></i>'));
    const tools = el('div', 'msg-tools');
    const copy = el('button', 'icon-btn small', ICONS.copy);
    copy.type = 'button';
    copy.title = 'Copy response';
    copy.setAttribute('aria-label', 'Copy response');
    copy.hidden = true;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(wrap.dataset.raw || body.innerText);
        copy.classList.add('done');
        setTimeout(() => copy.classList.remove('done'), 1200);
      } catch {
        /* clipboard blocked by page policy */
      }
    });
    tools.append(copy);
    wrap.append(body, tools);
    ui.thread.append(wrap);
    scrollToEnd(true);
    return wrap;
  }

  function setBusy(busy) {
    ui.stopBtn.hidden = !busy;
    ui.sendBtn.disabled = busy;
    ui.textarea.placeholder = busy
      ? 'Waiting for the response…'
      : state.messages.length
        ? 'Ask a follow-up…'
        : 'Ask a question…';
    updateActions();
  }

  function queueRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      if (!state.assistantEl) return;
      const stick = nearBottom();
      state.assistantEl.querySelector('.md').innerHTML = renderMarkdown(state.buffer);
      state.assistantEl.dataset.raw = state.buffer;
      if (stick) scrollToEnd(true);
    });
  }

  // ------------------------------------------------------------------------
  // Conversation
  // ------------------------------------------------------------------------

  function ask() {
    ui.thread.querySelector(':scope > .empty')?.remove();
    state.requestId = crypto.randomUUID();
    state.buffer = '';
    state.assistantEl = addAssistantBubble();
    setBusy(true);
    chrome.runtime
      .sendMessage({ type: 'sta:ask', requestId: state.requestId, messages: state.messages })
      .catch(() => fail('Lost connection to the extension. Reload the page and try again.'));
  }

  function finish(note) {
    const wrap = state.assistantEl;
    if (wrap) {
      if (state.buffer) {
        state.messages.push({ role: 'assistant', content: state.buffer });
        wrap.querySelector('.md').innerHTML = renderMarkdown(state.buffer);
        wrap.dataset.raw = state.buffer;
        wrap.querySelector('.msg-tools .icon-btn').hidden = false;
      } else {
        wrap.querySelector('.md').replaceChildren();
      }
      if (note) {
        const n = el('div', 'note');
        n.textContent = note;
        wrap.append(n);
      }
    }
    state.requestId = null;
    state.assistantEl = null;
    setBusy(false);
    ui.textarea.focus();
  }

  function fail(message) {
    const wrap = state.assistantEl;
    if (wrap) {
      if (state.buffer) state.messages.push({ role: 'assistant', content: state.buffer });
      const body = wrap.querySelector('.md');
      if (!state.buffer) body.replaceChildren();
      const err = el('div', 'error');
      const text = el('span');
      text.textContent = message;
      const retry = el('button', 'text-btn');
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => {
        wrap.remove();
        if (state.messages.at(-1)?.role === 'assistant') state.messages.pop();
        ask();
      });
      err.append(text, retry);
      wrap.append(err);
    }
    state.requestId = null;
    state.assistantEl = null;
    setBusy(false);
  }

  function stop() {
    if (state.requestId) chrome.runtime.sendMessage({ type: 'sta:cancel', requestId: state.requestId }).catch(() => {});
  }

  /** Ends an in-flight answer locally, keeping whatever already streamed in. */
  function stopAndKeep() {
    if (!state.requestId) return;
    stop();
    finish('Stopped.');
  }

  /** A new highlight is added to the current conversation; "New chat" starts over. */
  function open({ selection, prompt, providerLabel }) {
    if (!host || !host.isConnected) buildSidebar();
    host.style.display = '';
    stopAndKeep();
    ui.provider.textContent = providerLabel || '';
    // Earlier Retry buttons would re-send an old turn into the new one.
    ui.thread.querySelectorAll('.error .text-btn').forEach((b) => b.remove());
    const last = state.messages.at(-1);
    if (last?.role === 'user') last.content += `\n\n${prompt}`; // unanswered turn: merge, keep roles alternating
    else state.messages.push({ role: 'user', content: prompt });
    addSelectionBubble(selection);
    scrollToEnd(true);
    ask();
    ui.panel.focus({ preventScroll: true });
  }

  function newChat() {
    stop();
    state.messages = [];
    state.requestId = null;
    state.assistantEl = null;
    state.buffer = '';
    ui.thread.replaceChildren();
    showEmptyHint();
    setBusy(false);
    ui.textarea.focus();
  }

  function continueIn(agent) {
    if (state.requestId || !state.messages.length) return;
    chrome.runtime
      .sendMessage({ type: 'sta:continueInChat', agent, messages: state.messages })
      .catch(() => fail('Lost connection to the extension. Reload the page and try again.'));
  }

  /** Hides the sidebar but keeps the conversation for the next send from this page. */
  function close() {
    stopAndKeep();
    if (host) host.style.display = 'none';
  }

  // ------------------------------------------------------------------------
  // Messaging
  // ------------------------------------------------------------------------

  function onMessage(msg, _sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'sta:ping') {
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === 'sta:open') {
      open(msg);
      return false;
    }
    if (!ui || msg.requestId !== state.requestId) return false;
    if (msg.type === 'sta:chunk') {
      state.buffer += msg.text;
      queueRender();
    } else if (msg.type === 'sta:done') {
      finish(msg.note);
    } else if (msg.type === 'sta:error') {
      fail(msg.message);
    }
    return false;
  }

  chrome.runtime.onMessage.addListener(onMessage);

  window.__staTeardown = () => {
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      /* context invalidated */
    }
    host?.remove();
  };
})();
