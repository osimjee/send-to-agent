# Chrome Web Store listing

Copy these into the Chrome Web Store Developer Dashboard. Fields appear in the order the dashboard asks for them.

## Package

- **Upload:** `dist/send-to-agent-1.0.0.zip` (build it with `scripts/package.sh`)
- **Visibility for the first release:** consider **Unlisted** for a week. It works by link only, so you can share it with a few people before it shows up in search.

## Store listing tab

**Name** (75 characters max)

```
Send-to-Agent
```

**Summary** (132 characters max; this is also the manifest `description`)

```
Highlight text and send it to ChatGPT, Claude, or your own API key in one keystroke, with your instructions added before it sends.
```

**Category:** Productivity → Tools
**Language:** English

**Description**

```
Highlight text on any page and send it to the AI assistant you actually use, without copy, switch tab, paste.

QUICK SEND
Highlight text and press ⌥⇧S (Alt+Shift+S on Windows). The first time, pick where it goes: one of your open ChatGPT or Claude tabs, a new chat, or the API sidebar. After that, one keystroke sends it there.

YOUR TEXT WAITS FOR YOUR INSTRUCTIONS
By default the text lands in the prompt box without sending, so you can add "explain this simply" or "turn this into a checklist" before you press Enter. Prefer it sent right away? Turn on Send automatically.

SEND TO THE RIGHT TAB
Working in several chats at once? Label them ("Research", "Code review") and pick the one you want from the right-click menu. Labels show in the tab title so you can spot them.

ANSWERS RIGHT ON THE PAGE
Use your own OpenAI or Anthropic API key, or any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter, a company gateway). Answers stream into a sidebar next to what you're reading. Ask follow-ups, add more highlights to the same conversation, then move the whole thing into a ChatGPT or Claude chat with one click.

DOESN'T LOSE YOUR TEXT
If ChatGPT or Claude changes their page and a send can't go through, your text is copied to the clipboard and a notice tells you what happened. A health panel shows whether each site is working.

PRIVATE BY DESIGN
• No account, no servers, no analytics. The developer never sees your text.
• The extension reads the page only when you send something.
• API keys stay on your device and go only to the provider you chose.
• Open source (MIT): github.com/osimjee/send-to-agent

Not affiliated with OpenAI or Anthropic. ChatGPT is a trademark of OpenAI. Claude is a trademark of Anthropic.
```

**Graphic assets** (all in `docs/store/`)

| Asset | File | Size |
|---|---|---|
| Store icon | `icons/icon128.png` | 128×128 |
| Screenshot 1: quick-send picker | `screenshot-1-quick-send.png` | 1280×800 |
| Screenshot 2: API sidebar | `screenshot-2-sidebar.png` | 1280×800 |
| Screenshot 3: right-click menu with labeled tabs | `screenshot-3-menu.png` | 1280×800 |
| Screenshot 4: settings popup | `screenshot-4-popup.png` | 1280×800 |
| Small promo tile | `promo-small-440x280.png` | 440×280 |
| Marquee promo tile (optional) | `promo-marquee-1400x560.png` | 1400×560 |

**Additional fields**

- **Official URL:** none (needs a verified domain, so leave empty)
- **Homepage URL:** `https://github.com/osimjee/send-to-agent`
- **Support URL:** `https://github.com/osimjee/send-to-agent/issues`
- **Mature content:** No

## Privacy tab

**Single purpose description**

```
Send text the user highlights on a web page to an AI assistant the user chooses (ChatGPT or Claude in a browser tab, or an AI API using the user's own key), and show the API's answer in a sidebar on the page.
```

**Permission justifications**

| Permission | Justification |
|---|---|
| `activeTab` | Reads the text the user highlighted, and shows the answer sidebar or a notice on that page. Granted only when the user clicks a menu item or presses the extension's shortcut. |
| `scripting` | Runs the small functions that read the user's selection, show the sidebar, the destination picker and notices, and type the text into a ChatGPT or Claude prompt box. Only on the active tab after a user action, or on the ChatGPT/Claude tab the user sends to. |
| `contextMenus` | Adds the "Send to Agent" items to the right-click menu when text is selected, and a "label this tab" item on ChatGPT and Claude pages. |
| `storage` | Saves the user's settings, API keys, tab labels and a local record of whether sends worked. Everything stays on the device. |
| Host permission: `chatgpt.com`, `chat.openai.com`, `claude.ai` | Types the user's text into the prompt box of the ChatGPT or Claude tab the user chose, and keeps the user's label in that tab's title. |
| Host permission: `api.openai.com`, `api.anthropic.com` | Sends the user's text to the OpenAI or Anthropic API with the user's own key when they use the sidebar, and streams back the answer. |
| Optional host permission: `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | Requested at runtime only when the user enters a custom OpenAI-compatible API endpoint (such as a local Ollama server or a company gateway), and only for that endpoint's origin. Never requested otherwise. |

**Remote code:** No, I am not using remote code. (All JavaScript is in the package. Nothing is fetched and run.)

**Data usage: what the extension collects.** The Web Store counts sending data off the device as collecting it, even to a third party the user chose. Tick:

- [x] **Website content:** the text the user highlights, and optionally the page title and URL, sent to the AI service the user selects.
- [x] **Authentication information:** the user's own API keys, stored locally and sent only to that provider to authenticate API requests.

Leave everything else unticked: personal identity, health, financial, communications, location, web history, user activity.

**Certifications** (tick all three)

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**

```
https://github.com/osimjee/send-to-agent/blob/main/PRIVACY.md
```

## Distribution tab

- **Payments:** Free
- **Regions:** All regions

## Before you submit

- [ ] Developer account registered ($5 one-time fee), with a contact email verified in the dashboard
- [ ] `scripts/package.sh` run, and the zip loads cleanly via Load unpacked from an unzipped copy
- [ ] Repository is public, so the privacy policy URL works when the reviewers open it
