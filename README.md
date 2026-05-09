# PiArgus

**Two-tier browser + search + PiDocs extension for Pi** — Obscura (light) + smolvm/Chromium (heavy) + SearXNG search + package documentation resolver.

Named for Argus Panoptes, the hundred-eyed giant of Greek myth who sees all.

## Architecture

| Tier | Engine | Use Case |
|------|--------|----------|
| Light | Obscura (V8, 30MB) | Fetch, scrape, eval, links, text |
| Heavy | smolvm + Chromium | Screenshots, clicks, forms, GPU rendering |
| Search | SearXNG | Web search, research with page extraction |
| Docs | Registry resolvers + SearXNG fallback | Package/app documentation & install commands |

Routes automatically — no manual tier selection needed.

![PiArgus Architecture](docs/architecture.png)

## Search (SearXNG)

`WEB_Search` queries a self-hosted [SearXNG](https://github.com/searxng/searxng) instance and returns ranked results (title, URL, snippet, source engines) from multiple search providers (Google, Brave, DuckDuckGo, etc.).

`WEB_Research` performs deep research: search → fetch top results → keyword-extract relevant content. Returns scored paragraphs with source URLs.

Set the environment variable to configure your instance:
```bash
SEARXNG_URL=http://localhost:8080
```

If unset, the tool falls back to `http://192.168.100.105:30053`. Without a reachable SearXNG server, the tool returns a helpful configuration error.

## PiDocs (Package & App Documentation)

Two tools for resolving documentation URLs and install commands for any software — developer packages, desktop apps, and system services.

**`pidocs_lookup`** — Find documentation URLs for a package or application:
```
pidocs_lookup(name: "ffmpeg", type: "brew")
→ Resolver: brew, URLs: formulae.brew.sh/formula/ffmpeg, formulae.brew.sh/cask/ffmpeg

pidocs_lookup(name: "@types/node", type: "npm")
→ Resolver: npm, URLs: npmjs.com/package/@types/node
```

**`pidocs_install`** — Get install commands organized by platform:
```
pidocs_install(name: "nginx", platform: "linux")
→ [linux/apt] sudo apt install nginx
→ [cross-platform/docker] docker pull nginx
```

**Supported registries** (11 built-in + custom):
| Registry | Key | Example |
|----------|-----|---------|
| npm | `npm` | `lodash`, `@types/node` |
| GitHub | `github` | `octocat/Hello-World` |
| PyPI | `pip` | `flask` |
| crates.io | `cargo` | `tokio` |
| Homebrew | `brew` | `ffmpeg` (formula + cask) |
| Docker Hub | `docker` | `nginx` |
| VS Code Marketplace | `vscode` | `ms-python.python` |
| Go packages | `go` | `github.com/gin-gonic/gin` |
| AUR | `aur` | `yay-bin` |
| Flatpak | `flatpak` | `org.gimp.GIMP` |
| Snap | `snap` | `code` |

**Fallback**: If no built-in resolver matches, SearXNG search finds the documentation page.

**Auto-invocation**: When the agent detects install intent (`"how to install ffmpeg"`, `"npm install lodash"`, `"add octocat/lib"`), it automatically injects a system prompt suggesting `pidocs_install` usage.

**User config** (`~/.pidocs.json`) — disable specific resolvers or add custom ones:
```json
{
  "searxngUrl": "http://localhost:8080",
  "resolvers": {
    "npm": { "enabled": true },
    "brew": { "enabled": false },
    "custom": [
      { "name": " helm", "pattern": "^helm-/\\w+", "urlTemplate": "https://helm.sh/docs/helm/{name}", "type": "brew" }
    ]
  }
}
```

## Requirements

- **Light tier**: [Obscura](https://github.com/obscura-browser/obscura) (`~/.local/bin/obscura`)
- **Heavy tier**: [smolvm](https://smolmachines.com) (`~/.local/bin/smolvm`)
- **Search**: SearXNG instance (local or remote)

Heavy tier and search are optional — light tier works standalone.

## Install

```bash
pi install git:github.com/genegulanesjr/PiArgus
```

Or, once published to npm:

```bash
pi install npm:piargus
```

## Test

```bash
npm test
```

## Tools

| Tool | Tier | Description |
|------|------|-------------|
| `WEB_Search` | Search | SearXNG metasearch (titles, URLs, snippets, engines) |
| `WEB_Research` | Search | Deep research: search → fetch → keyword-extract |
| `pidocs_lookup` | Docs | Find documentation URLs for packages & apps |
| `pidocs_install` | Docs | Get install commands organized by platform |
| `browser_fetch` | Light | Fetch page as text/html/links/eval |
| `browser_navigate` | Light | Navigate & get page metadata |
| `browser_scrape` | Light | Bulk parallel scraping |
| `browser_screenshot` | Heavy | Full-page screenshots via Puppeteer + Chromium |
| `browser_action` | Dual | JS eval (light) or click/fill/hover (heavy) via CDP |
| `browser_vm_status` | Both | Status check / pre-warm heavy VM |

## Source Structure

| File | Purpose |
|------|---------|
| `index.ts` | Extension entry point, browser tool registration |
| `obscura.ts` | Light tier — Obscura V8 browser bindings |
| `smolvm.ts` | Heavy tier — smolvm + Chromium + SearXNG VM management |
| `tier-router.ts` | Auto-routes actions to light or heavy tier |
| `web-search-core.ts` | SearXNG search + research logic |
| `web-search.ts` | WEB_Search + WEB_Research tool registration |
| `pidocs-resolvers.ts` | 11 built-in registry resolvers + type detection |
| `pidocs-install-extract.ts` | Install command extraction from page text |
| `pidocs-core.ts` | Resolver pipeline orchestration (built-in → SearXNG → fetch → extract) |
| `pidocs.ts` | pidocs_lookup + pidocs_install tool registration + before_agent_start hook |
| `types.ts` | Shared TypeScript types |