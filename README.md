# Second Brain — Shared Memory

**Multi-user shared memory for teams of AI agents and humans.**

[![Built with Cloudflare Workers](https://img.shields.io/badge/Built%20with-Cloudflare%20Workers-F38020?logo=cloudflare\&logoColor=white)](https://workers.cloudflare.com/)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-8B5CF6)](https://modelcontextprotocol.io/)

This is a fork of [Second Brain for AI](https://github.com/rahilp/second-brain-cloudflare) — a persistent memory platform that gives Claude, ChatGPT, Cursor, Codex, and other AI tools access to the same memory. We extended it with **multi-user support**, turning it into a shared team memory.

**Live deployment:** [second-brain.nikolay-trakiyski.workers.dev](https://second-brain.nikolay-trakiyski.workers.dev/)

> **Original project:** [github.com/rahilp/second-brain-cloudflare](https://github.com/rahilp/second-brain-cloudflare) — single-user memory, deploy to your own Cloudflare account in two minutes.
>
> <a href="https://www.producthunt.com/products/second-brain-cloudflare?embed=true&utm_source=badge-top-post-badge&utm_medium=badge&utm_campaign=badge-second-brain-for-ai" target="_blank" rel="noopener noreferrer"><img alt="Second Brain for AI: Persistent memory for Claude, ChatGPT, and Cursor" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/top-post-badge.svg?post_id=1151393&theme=light&period=daily&t=1780357463637"></a>

## What's new in v2

* **Multi-user.** Create separate accounts with per-user API keys. Each user has their own private workspace. Public memories are shared across your team. A **deployment token** lets you connect to the server; then select your account and enter your API key — or generate a new account right from the dashboard.

* **Memory graph.** Memories now connect to each other — automatically as you save, or explicitly with the new `link` and `connections` tools. Recall can follow those connections (the `hops` option) to surface related context that a plain search would miss, and the dashboard has a new **Graph** tab to explore your memory visually.

* **Per-user visibility.** Each entry is owned by a specific user. Private entries (tagged `private`) are only visible to their owner. Public entries are visible to everyone. Filters in the dashboard let you browse by user and visibility.

* **User management.** The deployment owner can create and deactivate accounts. Deactivating an account removes its private memories while keeping public ones.

* **Per-user compression.** Nightly memory compression runs independently for each user, ensuring digests and roll-ups never mix data across users.

* **Cross-user conflict detection.** When you save something similar to another user's public memory, recall surfaces the connection so you can avoid duplicated effort.

* **Notion sync.** Connect your Notion workspace from **Settings → Integrations** in the dashboard. Pages you share with the connection sync into memory, stay updated as they change in Notion, and surface in recall alongside everything else. Nightly automatic sync, or on demand with **Sync now**.

* **Graceful degradation.** If the Vectorize index is missing, recall now falls back to keyword search with a clear notice instead of failing, a new `/health` endpoint reports index status, and the dashboard shows a banner with the exact fix.

## See it in action

**Live deployment:** [https://second-brain.nikolay-trakiyski.workers.dev](https://second-brain.nikolay-trakiyski.workers.dev/)

[![Second Brain Demo](https://img.youtube.com/vi/h0JqRM0UxHE/hqdefault.jpg)](https://youtu.be/h0JqRM0UxHE)

## How it works

Connect Second Brain to the AI tools you already use, then save information as it comes up.

Second Brain retrieves memories by meaning rather than exact wording. Asking:

> What did I decide about the pricing model?

can surface the correct memory even when the original note used completely different words.

### Memory tools

| Tool          | What it does                                             |
| ------------- | -------------------------------------------------------- |
| `remember`    | Store ideas, decisions, preferences, and project context |
| `append`      | Add an update to an existing memory                      |
| `update`      | Replace an existing memory                               |
| `recall`      | Find memories by meaning rather than exact wording       |
| `list_recent` | Browse recently saved memories                           |
| `forget`      | Permanently delete a memory                              |

## Save from anywhere

Memory is most useful when capturing information is easy. Second Brain connects to the tools and moments where context already exists.

* **AI clients:** Use `remember` directly within Claude, ChatGPT, Cursor, Codex, and other MCP clients.

* **Command line:** Run `brain remember`, `brain recall`, and other commands from your terminal.

  ```bash
  npm install -g second-brain-cf-cli
  ```

* **Notion:** Connect your Notion workspace from **Settings → Integrations** in the web dashboard. Create an internal **connection** in the [Notion developer portal](https://app.notion.com/developers/connections) (a connection, not a personal access token — only connections appear in a page's Connections menu), share the pages you want remembered with it, and paste its secret — shared pages sync into memory automatically (nightly, or on demand with **Sync now**) and stay updated as they change in Notion.

* **Obsidian:** Automatically sync notes using the [Second Brain Sync plugin](https://github.com/rahilp/second-brain-obsidian-plugin), also available through [Obsidian Community Plugins](https://community.obsidian.md/plugins/second-brain-sync).

* **Browser extension:** Capture a page or highlighted text using the [Chrome extension](https://github.com/rahilp/second-brain-browser-extension).

* **iPhone and iPad:** Use the Brain Dump, Text Brain Dump, and Save to Brain shortcuts in [`integrations/ios-shortcuts/`](integrations/ios-shortcuts/).

* **Bookmarklet:** Use the lightweight bookmarklet in [`integrations/bookmarklet.js`](integrations/bookmarklet.js).

## Quick Start

Already deployed? Open the dashboard and connect.

### 1. Connect to the dashboard

Go to [second-brain.nikolaytrakiyski.workers.dev](https://second-brain.nikolaytrakiyski.workers.dev/). Enter the URL and your deployment token, then click **Connect**.

### 2. Create or select your account

On the account screen, either:
- **Create a new account** — enter a username and click **Generate API Key**. Copy the key (it won't be shown again) and click **Continue**.
- **Use an existing account** — select your username from the dropdown, enter your API key, and click **Login**.

### 3. Connect your AI tools

Add the MCP server URL with your user credentials to your MCP client config:

```json
{
  "mcp": {
    "second-brain": {
      "type": "remote",
      "url": "https://second-brain.nikolaytrakiyski.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR-DEPLOYMENT-TOKEN",
        "X-Second-Brain-User": "your-username",
        "X-Second-Brain-User-Key": "sbu_your-api-key"
      }
    }
  }
}
```

This scopes all MCP tools (`remember`, `recall`, `list_recent`, etc.) to your user account. Private memories stay private; public memories are shared.

### Deploy your own

To deploy your own instance of Second Brain, follow the original project's instructions at [github.com/rahilp/second-brain-cloudflare](https://github.com/rahilp/second-brain-cloudflare).

## Documentation

* [Project docs](docs/shared-memory/) — PRD, goal, tasks, and current state
* [Contribution guide](docs/CONTRIBUTION.md) — how to build new features
* [CHANGELOG](CHANGELOG.md) — what changed in each version
* [Original project](https://github.com/rahilp/second-brain-cloudflare) — upstream single-user version

## Technology

Second Brain is built with:

* Cloudflare Workers
* D1 SQLite
* Cloudflare Vectorize
* Workers AI
* Cloudflare KV
* Model Context Protocol
* TypeScript

It runs within Cloudflare's free tier at personal scale.

Your data stays in your own Cloudflare account.

[MIT License](LICENSE) · [Discussions](https://github.com/rahilp/second-brain-cloudflare/discussions)
