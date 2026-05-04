# PiArgus

**Two-tier browser extension for Pi** — Obscura (light) + smolvm/Chromium (heavy).

Named for Argus Panoptes, the hundred-eyed giant of Greek myth who sees all.

## Architecture

| Tier | Engine | Use Case |
|------|--------|----------|
| Light | Obscura (V8, 30MB) | Fetch, scrape, eval, links, text, search |
| Heavy | smolvm + Chromium | Screenshots, clicks, forms, GPU rendering |

Routes automatically — no manual tier selection needed.

![PiArgus Architecture](docs/architecture.png)

## Search (SearXNG)

`WEB_Search` queries a self-hosted [SearXNG](https://github.com/searxng/searxng) instance and returns ranked results (title, URL, snippet, source engines) from multiple search providers (Google, Brave, DuckDuckGo, etc.).

Set the environment variable to configure your instance:
```bash
SEARXNG_URL=http://localhost:8080
```

If unset, the tool falls back to `http://192.168.100.105:30053`. Without a reachable SearXNG server, the tool returns a helpful configuration error.

**Typical workflow:**
1. `WEB_Search` → discover relevant pages
2. `browser_fetch` → read the best result in detail
3. `browser_screenshot` → visually verify if needed

## Requirements

- **Light tier**: [Obscura](https://github.com/obscura-browser/obscura) (`~/.local/bin/obscura`)
- **Heavy tier**: [smolvm](https://smolmachines.com) (`~/.local/bin/smolvm`)

Heavy tier is optional — light tier works standalone.

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
| `WEB_Search` | Search | SearXNG metasearch (titles, URLs, snippets) |
| `browser_fetch` | Light | Fetch page as text/html/links/eval |
| `browser_navigate` | Light | Navigate & get page metadata |
| `browser_scrape` | Light | Bulk parallel scraping |
| `browser_screenshot` | Heavy | Full-page screenshots via Chromium |
| `browser_action` | Dual | JS eval (light) or click/fill/hover (heavy) |
| `browser_obscura_serve` | Both | Status check / pre-warm heavy VM |
