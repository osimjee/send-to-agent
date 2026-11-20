# Send-to-Agent

Highlight text on any page, right-click, and send it to ChatGPT, Claude, a **specific labeled agent tab**, or your own API key (answer streams into a sidebar on the page).

Manifest V3, vanilla JavaScript, no build step and no dependencies.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder (the one with `manifest.json`).
4. Pin **Send-to-Agent** from the puzzle-piece menu so the settings popup is one click away.

After editing any file, click the reload icon on the extension's card. Reload pages that were already open before you use the sidebar on them.

## Using it

### Quick send (fastest)

Highlight text and press **⌥⇧S** (Alt+Shift+S on Windows and Linux).

- The first time, a small picker on the page asks where quick send should go: one of your open agent tabs, a new Claude or ChatGPT chat, or the API sidebar. Press a number or click. After that, the shortcut sends straight there.
- By default the text is typed into the prompt box but **not sent**, so you can add instructions ("explain this simply") before pressing Enter. Turn on **Send automatically** in the popup to send right away. This applies to every send into ChatGPT or Claude, from the shortcut or the menu.
- If the chosen tab was closed, quick send opens a new chat on the same site, gives it the same label, and uses that tab from then on.
- Change the target in the popup's **Quick send** section. Change the key combination at `chrome://extensions/shortcuts` (the popup links there).
- The quick-send target is also the first item in the right-click menu. Turn on **One-click right-click menu** in the popup to make it the only item, so right-click → one click sends.

### Right-click menu

Highlight text, right-click, then pick **Send to Agent**:

| Menu item | What happens |
|---|---|
| Send to Research (Claude) | Your quick-send target, when one is set |
| Send to default (…) | Shown instead when no quick-send target is set. Uses the default action from the popup. |
| New ChatGPT chat / New Claude chat | Opens a new tab with `chatgpt.com/?q=…` or `claude.ai/new?q=…`. Long selections open a blank chat and the text is typed in. |
| Ask … API (sidebar) | Sends the text to your API key and streams the answer into a sidebar. You can ask follow-ups there, and more highlights from the same page join the same conversation. |
| → Research (Claude), → ChatGPT #2 — … | Switches to that open tab and types the text into its prompt box (and presses send if **Send automatically** is on). |

### The API sidebar

- Each new highlight you send from a page is added to the sidebar's current conversation, so the model sees what came before. Click **+** in the sidebar header to start a new chat.
- Closing the sidebar hides it and keeps the conversation. Reloading or leaving the page clears it.
- **Continue in Claude / ChatGPT** (under the conversation) opens a new web chat with the whole conversation typed in, left unsent so you can add your next question.

### Several agent tabs open

Every open ChatGPT and Claude tab is listed in the popup and in the right-click menu. To tell them apart:

- **Popup:** type a label next to each tab (e.g. "Research", "Code review"). It saves as you type.
- **On the agent page:** right-click anywhere and choose **Send-to-Agent: label this tab…**

The label is added to the tab's title (`[Research] Claude`) and its toolbar badge, so you can spot it in the tab strip too. Unlabeled tabs show as "Claude #1", "Claude #2" and so on. Labels last until the tab closes or the browser restarts.

### When sending into a tab fails

Each send into an open ChatGPT or Claude tab is checked: the prompt box was found, the text went in, and the message actually sent. If any step fails, a banner in that tab tells you what happened and copies your text to the clipboard, so nothing is lost.

The popup's **Health** section shows each site's status:

- **OK:** the last send worked.
- **Degraded:** it worked, but only through a backup selector or by pressing Enter. The site may be changing.
- **Broken:** the last send failed.

The toolbar icon shows an amber or red `!` when anything isn't OK. Labeled agent tabs show their label on the badge instead. Only selectors, timings and the extension version are stored, never your text.

## Settings

- **Default action:** web chat (ChatGPT or Claude) or API sidebar.
- **Provider:** Anthropic (default model `claude-opus-5-5`), OpenAI (default `gpt-5-mini`), or any OpenAI-compatible `/chat/completions` endpoint (Ollama, LM Studio, OpenRouter, a company gateway). For a custom endpoint Chrome asks once for permission to reach that host.
- **Prompt options:** a prefix added before your text, the system prompt, max response tokens, and whether to include the page title and URL.
- **Send automatically** (in Quick send): off by default, so text waits in the ChatGPT or Claude prompt box for you to add instructions.

On Claude Opus 5.5, Opus 5, Fable 5 and Sonnet 5.5, Anthropic requests include `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). If a safety classifier declines a request, the API retries it on a fallback model within the same call instead of returning nothing.

## Security notes

- API keys are stored in `chrome.storage.local` on this device only (never `storage.sync`). Chrome doesn't encrypt this storage, so anyone with access to your Chrome profile can read it. Use a key with a spending limit.
- Only the background service worker reads keys. The sidebar code on the page never gets them.
- Once saved, a key is never shown in the popup again; you only see its last 4 characters.
- The sidebar runs inside a closed Shadow DOM. Model output is HTML-escaped before Markdown formatting is applied, so a response can't inject markup into the page.
- The extension only gets access to the page you right-click (`activeTab`), plus chatgpt.com, claude.ai and the two API hosts. It doesn't need the broad `tabs` permission.

## Limitations

- Typing into ChatGPT and Claude depends on how their pages are built today (`#prompt-textarea`, ProseMirror editors, send-button labels). When the Health section shows **Broken** or **Degraded**, update the `SELECTORS` table at the top of `background.js`. Planned follow-ups (a check when an agent tab loads, a diagnostic report, a CI canary) are in [docs/next-step-selector-health.md](docs/next-step-selector-health.md).
- `chatgpt.com/?q=` sends the prompt on its own and `claude.ai/new?q=` only fills it in, so the fast link is used only when it matches **Send automatically**. Otherwise the chat opens blank and the text is typed in, which takes a second longer.
- Chrome doesn't let extensions run on `chrome://` pages, the Chrome Web Store or the built-in PDF viewer. If you pick the API sidebar on one of those, it opens a web chat instead.

## Files

```
manifest.json   permissions, service worker, popup
background.js   context menu, routing, tab labels, streaming API calls
popup.html/js   settings and the agent-tab list
content.js      sidebar (injected only when you use it)
content.css     sidebar styles (loaded inside the Shadow DOM)
icons/          16/48/128 px icons
```

## License

MIT, see `LICENSE`.
