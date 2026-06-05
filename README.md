# PiArgus

**Two-tier browser + search + PiDocs extension for Pi** — Obscura (light) + Docker/Chromium (heavy) + SearXNG search + package documentation resolver.

Named for Argus Panoptes, the hundred-eyed giant of Greek myth who sees all.

## Architecture

| Tier | Engine | Use Case |
|------|--------|----------|
| Light | Obscura (V8) via Docker | Fetch, scrape, eval, links, text |
| Heavy | Docker + Chromium | Screenshots, clicks, forms, GPU rendering |
| Search | Docker + SearXNG | Web search, research with page extraction |
| Docs | Registry resolvers + SearXNG fallback | Package/app documentation & install commands |

All services run inside a single Docker container. Works on **Windows, Mac, and Linux**.

Routes automatically — no manual tier selection needed.

## Quick Start

### 1. Build the Docker image

```bash
docker build -t piargus .
```

### 2. Start the container

```bash
docker run -d --name piargus \
  -p 127.0.0.1:9222:9222 \
  -p 127.0.0.1:8888:8080 \
  piargus
```

This starts:
- **Obscura** on port 9222 (light tier — fetch, scrape, eval)
- **SearXNG** on port 8888 (metasearch engine)
- **Chromium** available on-demand for heavy-tier operations

### 3. Install the Pi extension

```bash
pi install git:github.com/genegulanesjr/PiArgus
```

Or, once published to npm:

```bash
pi install npm:piargus
```

## Search (SearXNG + DuckDuckGo)

`web_search` searches the web using DuckDuckGo (routed through the Obscura container for isolation) and returns titles, URLs, and snippets.

`web_research` performs deep research: search → fetch top results → keyword-extract relevant content. Returns scored paragraphs with source URLs.

SearXNG is also available for metasearch across multiple providers (Google, Brave, DuckDuckGo, etc.):

```bash
SEARXNG_URL=http://localhost:8888
```

If unset, defaults to `http://localhost:8888`.

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
  "searxngUrl": "http://localhost:8888",
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

- **Docker** — the only requirement. Install: https://docs.docker.com/get-docker/
- Works on Windows, Mac, and Linux

## Test

```bash
npm test
```

## Tools

| Tool | Tier | Description |
|------|------|-------------|
| `web_search` | Search | DuckDuckGo search (titles, URLs, snippets) |
| `web_research` | Search | Deep research: search → fetch → keyword-extract |
| `pidocs_lookup` | Docs | Find documentation URLs for packages & apps |
| `pidocs_install` | Docs | Get install commands organized by platform |
| `browser_fetch` | Light | Fetch page as text/html/links/eval |
| `browser_navigate` | Light | Navigate & get page metadata |
| `browser_scrape` | Light | Bulk parallel scraping |
| `browser_screenshot` | Heavy | Full-page screenshots via Puppeteer + Chromium |
| `browser_action` | Dual | JS eval (light) or click/fill/hover (heavy) via CDP |
| `browser_vm_status` | Both | Status check / pre-warm Docker container |

## Source Structure

| File | Purpose |
|------|---------|
| `index.ts` | Extension entry point, browser tool registration |
| `obscura.ts` | Light tier — Obscura V8 browser bindings (via docker exec) |
| `docker.ts` | Heavy tier — Docker container management + Chromium + SearXNG |
| `tier-router.ts` | Auto-routes actions to light or heavy tier |
| `web-search-core.ts` | DuckDuckGo + SearXNG search + research logic |
| `web-search.ts` | web_search + web_research tool registration |
| `pidocs-resolvers.ts` | 11 built-in registry resolvers + type detection |
| `pidocs-install-extract.ts` | Install command extraction from page text |
| `pidocs-core.ts` | Resolver pipeline orchestration (built-in → SearXNG → fetch → extract) |
| `pidocs.ts` | pidocs_lookup + pidocs_install tool registration + before_agent_start hook |
| `types.ts` | Shared TypeScript types |
| `Dockerfile` | Single container: Obscura + Chromium + SearXNG |
| `docker/supervisord.conf` | Process manager for container services |
| `docker/searxng-settings.yml` | SearXNG configuration (JSON format enabled) |
