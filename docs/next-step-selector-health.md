# Next step: detecting when ChatGPT or Claude breaks our selectors

**Status:** Phases 1 and 2 are built (Phase 2 in version 1.1.0). Phase 3 is planned, not started.

Phase 1 differs from the original plan in one way: a single failed send marks the agent **broken** right away, not after 2 failures in a row. Each failure means the user lost a send, so the warning should come immediately. The popup also shows the failure count, and the next successful send clears the status.

## Problem

Sending text into an open ChatGPT or Claude tab depends on CSS selectors for their prompt box and send button (`agentComposerInject` in `background.js`). When either site changes its markup, this breaks without any warning:

- **Prompt box not found:** after about 15 s the function returns `{ ok: false, reason: 'composer-not-found' }`. The only trace is a `console.warn` in the service worker. The user sees the tab switch, nothing typed, and the selected text is lost.
- **Send button not found:** the extension falls back to a simulated Enter key, which may or may not send. Nothing records that the fallback was used.
- **Fallback selectors in use:** if the specific selector stops matching but the generic `textarea` or `[contenteditable]` one still does, sending keeps working. That's the earliest warning we could get, and today we throw it away.

**Goal:** the user finds out right away when a send fails and doesn't lose their text. Maintainers find out that a site changed, ideally before users do.

## Phase 1: tell the user and record it (inside the extension, no new permissions)

1. **Keep selectors per agent in one table.** Replace the flat `COMPOSERS` / `SEND_BUTTONS` arrays with a `SELECTORS` table: `{ chatgpt: { composer: [...], send: [...] }, claude: {...} }`. Mark each entry `primary` or `fallback`. Pass the agent's own list into the injected function so ChatGPT's selectors never match on Claude's page.
2. **Return richer results** from `agentComposerInject`:
   `{ ok, stage: 'composer' | 'insert' | 'send', composerMatch, sendMatch, usedFallback, submitted, elapsedMs }`.
   - `composerMatch` / `sendMatch`: the selector string that matched, or `null`.
   - `insert` failure: an element was found, but the text didn't appear after both the paste attempt and the `execCommand` attempt.
   - Confirm the send: after clicking, check that the prompt box emptied or a new user message appeared within about 3 s. If not, report `submitted: false`.
3. **Never lose the text.** On any failure, copy the prompt to the clipboard from the target tab and show a small banner inside that tab: "Send-to-Agent couldn't find the prompt box. Your text is on the clipboard, press ⌘V." The extension already has the scripting access it needs for this.
4. **Health record** in `chrome.storage.local`, under the key `selectorHealth`:
   ```json
   { "claude": { "status": "ok|degraded|broken", "lastOk": 0, "lastFail": 0,
                 "lastFailStage": "composer", "lastMatch": "div.ProseMirror…",
                 "failStreak": 0, "extVersion": "1.0.0" } }
   ```
   - `degraded`: the send worked, but only through a fallback selector or the Enter-key fallback.
   - `broken`: 2 or more failures in a row.
   - Store only selectors, timings and versions, never the user's text or the page content.
5. **Warn on the toolbar.** Set the action badge to `!` (amber when degraded, red when broken) on every tab while any agent is degraded or broken. Add a **Health** row to the popup with each agent's status, when it last worked, and the failing stage.

## Phase 2: catch breakage before the user sends anything (built)

As built: the page check can only mark a site **degraded** (amber), never **broken**. A slow page, a login wall or a challenge page shouldn't raise a red alarm; only a failed send does. A send that finds the prompt box through its primary selector clears a page-check warning. Buttons found away from the prompt box are recorded without their `aria-label`, since those can name chats.

6. **Read-only probe.** A small `probeAgentPage()` function finds the prompt box and send button, touches nothing, and returns which selectors matched.
   - Run it when an agent tab finishes loading (we already listen for `tabs.onUpdated` with `status: 'complete'`). Debounce it to at most once per agent every 30 minutes.
   - The send button often only shows up after text is typed. If it's missing, record that as unknown, not as a failure.
7. **"Test now" button** in the popup's Health row. It runs the probe against every open agent tab and shows the results in place.
8. **"Copy diagnostic report" button.** Copies extension version, Chrome version, agent, host, failing stage and which selectors matched. It also lists a few candidate elements on the page (tag, `id`, `aria-label`, `data-testid`, `role` of visible editable elements and buttons) so a maintainer can write a new selector without reproducing the bug. It never includes text.
9. **"Report a problem" link** that opens a prefilled GitHub issue with the diagnostic report. The user reviews and submits it themselves; the extension never sends anything automatically.

## Phase 3: maintainer-side alerts (optional, needs decisions)

10. **Scheduled CI canary.** A GitHub Action runs daily with Playwright and Chromium: it loads the unpacked extension, opens chatgpt.com and claude.ai, runs `probeAgentPage()`, and opens or updates a GitHub issue when a primary selector stops matching.
    - Open problem: claude.ai needs a login, and both sites may block headless browsers. Options are a dedicated test account with stored session cookies as a CI secret, or covering only logged-out ChatGPT. Needs a decision before building.
11. **Remote selector list (optional).** Fetch a signed or pinned `selectors.json` from the project's GitHub repo, with a 24 h cache and the built-in table as a fallback. A selector fix then reaches users without a Chrome Web Store release. It's data, not code, so MV3 allows it, but it needs one more host permission and raises supply-chain review questions. Decide only if store review times become a pain.

## Done means

- A forced failure (add a bogus selector at the top of the list, delete the real one, reload the extension) produces, within one send:
  - a banner in the tab
  - the text on the clipboard
  - a red `!` badge
  - **broken** in the popup's Health row
- Reaching a page only through a fallback selector shows **degraded** with an amber badge.
- Opening an agent tab whose primary selector is missing flags it through the probe before any send.
- The diagnostic report contains no selection text and no page text (check with a test).

## Rough size

| Phase | Files | Effort |
|---|---|---|
| 1 | `background.js`, `popup.html/js` | ~1 day |
| 2 | same, plus a small probe function | ~0.5 day |
| 3 | `.github/workflows/canary.yml`, `tests/canary.spec.js` | ~1 day, plus the login decision |

Start with Phase 1 on its own. It's the only phase that keeps users from losing text, and Phases 2 and 3 build on its result format.
