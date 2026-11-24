# Roadmap

Order: **browser first, then Mac, then Windows.**

## 1.x: Chrome extension (now)

- **1.0:** quick send, labeled tabs, API sidebar, selector health. Publish to the Chrome Web Store.
- **1.1 (built, ready to upload after 1.0 is approved):** selector health Phase 2 ([plan](next-step-selector-health.md)):
  - a read-only check when an agent tab loads
  - a **Test now** button
  - **Copy diagnostic report**
  - a prefilled GitHub issue link

## 2.x: Mac desktop

A small helper app the Chrome extension talks to through Chrome native messaging. It's installed separately (Homebrew or a signed .pkg). The extension keeps working fully without it.

1. **Highlights inbox over MCP.** The extension saves highlights to the helper, which is also an MCP server ("get my latest highlight", "list today's highlights").
   - Works in Claude Desktop (installed as a one-click desktop extension), Cursor, Claude Code and VS Code.
   - ChatGPT desktop only where its MCP support allows.
   - This is the reliable path, because it uses documented interfaces on both sides.
2. **Push into desktop apps.**
   - First, check which apps accept a link that opens them with a prompt filled in (Cursor, Claude Desktop, ChatGPT desktop). Build the ones that work.
   - For apps without one, an experimental option: copy, bring the app forward and paste. This needs macOS Accessibility permission.

**Pricing test:** sell the Mac helper for about $10 one-time, through Lemon Squeezy, Paddle or Gumroad, with an offline-checked license key so there's still no server. If sales are tiny, make it free too. The Chrome extension stays free either way.

## 3.x: Windows

The same helper on Windows: native messaging registration through the registry, the MCP server, and push where the apps support it.

## Later

- A daily automated test against the live ChatGPT and Claude sites (selector health Phase 3). It needs a decision on how the test signs in to claude.ai.
- Firefox and Edge builds if there's demand. Edge can use the Chrome package as is.
