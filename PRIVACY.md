# Send-to-Agent Privacy Policy

**Effective date:** November 19, 2026
**Applies to:** the Send-to-Agent browser extension, version 1.0.0 and later

Send-to-Agent ("the extension", "we") lets you send text you highlight on a web page to an AI assistant of your choice: ChatGPT or Claude in a browser tab, or an AI provider's API using your own API key. This policy explains what the extension handles, where it goes, and what stays on your device.

**The short version:** the extension has no servers of its own. We, the developers, never receive, see, store or sell anything you highlight, type or configure. Your text goes only to the AI service you choose to send it to, and only when you choose to send it.

## 1. Information the extension handles

| What | When | Where it goes |
|---|---|---|
| **Text you highlight** | Only when you choose a Send-to-Agent menu item or press the quick-send shortcut | To the AI service you picked (see section 2) |
| **Page title and address (URL)** of the page you're on | Only if you turn on "Include page title & URL" (off by default) | Added under your text, to the same AI service |
| **Follow-up questions** you type in the sidebar, and the answers | When you use the API sidebar | Sent to your chosen API provider. The conversation is kept in the open page only, and cleared when you reload or leave it |
| **API keys** you enter (OpenAI, Anthropic, or a custom endpoint) | When you save them in the extension's settings | Stored on your device. Sent only to that provider, to authenticate your requests |
| **Settings** (default action, models, prompt options, quick-send target, menu options) | When you change them | Stored on your device only |
| **Tab labels** you give your ChatGPT or Claude tabs | When you set them | Stored in your browser session only, cleared when the browser restarts |
| **Delivery health records** | After each send into a ChatGPT or Claude tab | Stored on your device only. Contains which page elements were found, timings, success or failure, and the extension version. **Never** your text or page content |

The extension does **not** collect or use:

- your browsing history or the content of pages you don't send
- personal identifiers such as your name, email address or location
- analytics, usage statistics, crash reports, advertising identifiers or cookies of its own
- passwords or financial information

The extension reads the page only when you take an action (a menu click or the shortcut). It does not run in the background on the sites you visit.

## 2. Where your text goes

You choose the destination each time, or set a default.

- **ChatGPT or Claude in a browser tab.** The extension opens chatgpt.com or claude.ai, or switches to a tab you already have open, and places your text in the prompt box. Short text may be passed in the page address (for example `chatgpt.com/?q=…`), which also means it can appear in your browser history. You use these sites with your own account, and what you send is handled under their terms and privacy policies: [OpenAI](https://openai.com/policies/privacy-policy) and [Anthropic](https://www.anthropic.com/legal/privacy).
- **API sidebar.** Your text, the conversation so far and your system prompt are sent directly from your browser to the provider you selected (api.openai.com, api.anthropic.com, or a custom endpoint address that you enter), with your API key. That provider's API terms and privacy policy apply. A custom endpoint is whatever server you configure. We don't operate or control it.

No copy is sent to us or to anyone else.

## 3. Clipboard

If the extension can't place your text into a ChatGPT or Claude tab, it copies **your own text** to your clipboard so you don't lose it, and shows a notice in that tab. The Copy buttons in the sidebar and in that notice also write to the clipboard. The extension never reads your clipboard.

## 4. Storage, retention and deletion

All data is kept in your browser's extension storage (`chrome.storage`) on your device. It isn't synced to your Google account.

- **API keys:** kept until you click **Remove** in the settings or uninstall the extension. They're stored unencrypted in your browser profile, like other extension data, so anyone with access to your profile can read them. Use keys with spending limits.
- **Health records:** kept until you click **Reset** in the Health section or uninstall.
- **Tab labels:** cleared when the browser restarts.
- **Sidebar conversations:** cleared when you reload or leave the page.

Uninstalling the extension deletes everything it stored. Data that you sent to an AI service is held by that service under its own policy, and you can manage it there.

## 5. Sharing and sale of data

We don't sell, rent, trade or transfer your data to anyone. We don't use it for advertising, to train models, or to determine creditworthiness or for lending purposes. The only transfers are the ones you start, to the AI service you choose, so the extension can do what you asked.

**Chrome Web Store Limited Use:** Send-to-Agent's use of information received through Chrome extension APIs complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## 6. Permissions and why they're needed

- **activeTab, scripting:** to read the text you highlighted and to show the sidebar or notices on the page, only after you click a menu item or press the shortcut.
- **contextMenus:** to add the "Send to Agent" items to the right-click menu.
- **storage:** to keep your settings, keys, labels and health records on your device.
- **Access to chatgpt.com, chat.openai.com and claude.ai:** to place your text into those tabs and show their labels.
- **Access to api.openai.com and api.anthropic.com:** to send API requests when you use the sidebar.
- **Optional access to other sites:** requested only if you set a custom API endpoint, and only for that endpoint's address. Chrome asks you first.

## 7. Security

The extension's code is included in the package and isn't loaded from the internet. API keys are read only by the extension's background service worker and are never passed to web pages. The sidebar runs in an isolated part of the page, and AI responses are escaped before display so they can't run code on the page. The source code is public at [github.com/osimjee/send-to-agent](https://github.com/osimjee/send-to-agent), so you can check all of this yourself.

## 8. Children

The extension isn't directed at children under 13, and we don't knowingly collect information from anyone, including children.

## 9. Changes to this policy

If this policy changes, we'll update the effective date above and describe the change in the project's release notes. If a change would mean handling data in a new way, we'll ask for your consent in the extension before it happens.

## 10. Contact

Questions about this policy or the extension: open an issue at [github.com/osimjee/send-to-agent/issues](https://github.com/osimjee/send-to-agent/issues).
