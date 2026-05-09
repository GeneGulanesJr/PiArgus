# PiDocs Design Spec — Package/App Documentation & Install Resolver

> **Feature in:** PiArgus extension  
> **Date:** 2026-05-09  
> **Status:** Approved

## Goal

Add a PiDocs feature to PiArgus that automatically resolves package and application names to documentation URLs and install commands, using built-in registry resolvers first, SearXNG search as fallback, and Obscura page fetching for install command extraction. When the user's message contains install intent, a prompt guideline nudges the LLM to call the tools.

## Architecture

PiDocs lives entirely within PiArgus. It adds two tools (`pidocs_lookup` and `pidocs_install`) and one `before_agent_start` event hook. The tools share a resolver pipeline: built-in URL resolvers → SearXNG search → Obscura fetch + extraction. The pipeline reuses PiArgus' existing `searchSearXNG()` (from `web-search-core.ts`), `ensureSearXNG()` (from `web-search.ts`), and `fetchText()` (from `obscura.ts`).

## Tech Stack

- PiArgus extension (TypeScript, same as existing tools)
- SearXNG JSON API (already integrated in `web-search-core.ts`)
- Obscura fetch (already integrated in `obscura.ts`)
- No new npm dependencies

## New Files

| File | Responsibility |
|------|---------------|
| `pidocs-core.ts` | Resolver pipeline: orchestrate built-in → SearXNG → fetch → extract |
| `pidocs-resolvers.ts` | Built-in registry resolver functions + config loading |
| `pidocs-install-extract.ts` | Install command extraction from fetched page HTML/text |
| `pidocs.ts` | Tool registration (`pidocs_lookup`, `pidocs_install`) + `before_agent_start` hook |

## Modified Files

| File | Change |
|------|--------|
| `index.ts` | Import and call `registerPidocs(pi)` |
| `package.json` | Update description/keywords to mention pidocs |

## Resolver Pipeline

### Step 1: Built-in resolvers (zero network, instant)

Each resolver takes a name string and optional type hint, returns `null` (no match) or a `ResolverResult`:

```typescript
interface ResolverResult {
  urls: string[];           // Documentation/homepage URLs
  installUrl?: string;      // URL specifically for install docs
  description?: string;     // Short description if inferrable
  resolver: string;         // Which resolver matched (e.g., "npm", "github")
}
```

| Resolver | Pattern | URL Template(s) |
|----------|---------|-----------------|
| npm (unscoped) | `lodash`, `react` | `https://www.npmjs.com/package/{name}` |
| npm (scoped) | `@scope/name` | `https://www.npmjs.com/package/{name}` |
| GitHub | `owner/repo` | `https://github.com/{owner}/{repo}` |
| PyPI | `flask`, `requests` | `https://pypi.org/project/{name}` |
| Cargo | `tokio`, `serde` | `https://crates.io/crates/{name}` |
| Homebrew (formula) | `ffmpeg`, `node` | `https://formulae.brew.sh/formula/{name}` |
| Homebrew (cask) | `firefox`, `vlc` | `https://formulae.brew.sh/cask/{name}` |
| Docker Hub | `nginx`, `postgres` | `https://hub.docker.com/_/{name}` |
| VS Code ext | `ms-python.python` | `https://marketplace.visualstudio.com/items?itemName={name}` |
| Go module | `github.com/gin-gonic/gin` | `https://pkg.go.dev/{name}` |
| Arch AUR | `yay-bin`, `paru-bin` | `https://aur.archlinux.org/packages/{name}` |
| Flatpak | `org.gimp.GIMP` | `https://flathub.org/apps/{name}` |
| Snap | `code`, `firefox` | `https://snapcraft.io/{name}` |

Resolvers run in priority order. If the user provides a `type` hint, that resolver runs first. If no resolver matches, fall through to SearXNG.

### Step 2: SearXNG fallback (for unknown apps)

Craft search queries:
- `"install {name}"` (general)
- `"install {name}" site:{inferred-domain}` (if type hint known, e.g., `site:pypi.org`)
- `"how to install {name}"` (broader fallback)

Uses `searchSearXNG()` from `web-search-core.ts`.

### Step 3: Obscura fetch + install extraction (pidocs_install only)

For `pidocs_install`, fetch the top resolved URL(s) using `fetchText()` from `obscura.ts`, then extract install commands using pattern matching in `pidocs-install-extract.ts`.

Extraction patterns (platform-specific):

| Platform | Patterns |
|----------|----------|
| npm | `npm install {name}`, `yarn add {name}`, `pnpm add {name}` |
| pip | `pip install {name}`, `pip3 install {name}`, `python -m pip install {name}` |
| Homebrew | `brew install {name}`, `brew install --cask {name}` |
| apt | `apt install {name}`, `apt-get install {name}`, `sudo apt install {name}` |
| Cargo | `cargo add {name}` |
| Docker | `docker pull {name}` |
| Go | `go get {name}`, `go install {name}` |
| Snap | `snap install {name}` |
| Flatpak | `flatpak install {name}` |
| pacman | `pacman -S {name}` |
| dnf | `dnf install {name}` |
| choco | `choco install {name}` |
| Generic | `curl ... \| sh`, `make install`, any code block starting with `$` |

Extraction also captures prerequisites (e.g., "requires Node.js 18+") and notes.

## Tool Definitions

### pidocs_lookup

**Purpose:** Find documentation URLs and description for a package or app.

**Parameters:**
```typescript
{
  name: string,           // Package/app name (e.g., "lodash", "@types/node", "ffmpeg")
  type?: string,          // Optional hint: "npm" | "github" | "pip" | "cargo" | "brew" |
                          //           "docker" | "vscode" | "go" | "aur" | "flatpak" | "snap"
}
```

**Returns:**
```typescript
{
  content: [{ type: "text", text: "Formatted summary for the LLM" }],
  details: {
    urls: string[],
    description?: string,
    resolver: string,        // "npm" | "github" | "pip" | ... | "searxng"
    name: string,
    type: string,
    searchResults?: []       // If SearXNG was used
  }
}
```

### pidocs_install

**Purpose:** Find installation commands for a package or app, per platform.

**Parameters:**
```typescript
{
  name: string,           // Package/app name
  type?: string,          // Optional registry hint (same values as pidocs_lookup)
  platform?: string       // Optional platform filter: "linux" | "mac" | "windows" | "all"
}
```

**Returns:**
```typescript
{
  content: [{ type: "text", text: "Formatted install commands for the LLM" }],
  details: {
    description?: string,
    installCommands: Array<{
      platform: string,   // "linux" | "mac" | "windows" | "cross-platform"
      manager: string,     // "npm" | "pip" | "brew" | "apt" | "cargo" | etc.
      command: string,     // The actual install command
      notes?: string       // Prerequisites, version notes
    }>,
    sourceUrl: string,
    resolver: string,
    name: string,
    type: string,
  }
}
```

## before_agent_start Hook

Conditionally injects a prompt guideline when the user's message suggests installing something.

```typescript
pi.on("before_agent_start", async (event) => {
  const prompt = event.prompt.toLowerCase();
  
  const installPatterns = [
    /\binstall\b/, /\bsetup\b/, /\bhow\s+to\s+(install|use|setup)\b/,
    /\bnpm\s+install\b/, /\bpip\s+install\b/, /\bbrew\s+install\b/,
    /\bapt(-get)?\s+install\b/, /\bcargo\s+add\b/, /\byarn\s+add\b/,
    /\bpacman\s+-S\b/, /\bdnf\s+install\b/, /\bchoco\s+install\b/,
    /\bdocker\s+pull\b/, /\bgo\s+get\b/, /\bflatpak\s+install\b/,
    /\bsnap\s+install\b/,
  ];
  
  const packagePatterns = [
    /@[\w-]+\/[\w.-]+/,              // @scope/package (npm scoped)
    /[\w-]+\/[\w.-]+/,               // owner/repo (GitHub)
    /ms-[\w.]+\.[\w.]+/,             // VS Code extensions
    /github\.com\/[\w-]+\/[\w.-]+/,  // GitHub URLs
  ];
  
  const hasInstallIntent = installPatterns.some(p => p.test(prompt));
  const hasPackageRef = packagePatterns.some(p => p.test(prompt));
  
  if (hasInstallIntent || hasPackageRef) {
    return {
      systemPrompt: event.systemPrompt + 
        "\n\nBefore installing packages or apps, call pidocs_install to get the correct " +
        "install commands and check for prerequisites. For documentation URLs, call pidocs_lookup.",
    };
  }
});
```

## Config File

Optional `~/.pidocs.json`:

```json
{
  "searxngUrl": "http://localhost:8888",
  "resolvers": {
    "npm": { "enabled": true },
    "github": { "enabled": true },
    "pip": { "enabled": true },
    "cargo": { "enabled": true },
    "brew": { "enabled": true },
    "docker": { "enabled": true },
    "vscode": { "enabled": true },
    "go": { "enabled": true },
    "aur": { "enabled": true },
    "flatpak": { "enabled": true },
    "snap": { "enabled": true },
    "custom": [
      {
        "name": "my-internal-registry",
        "pattern": "^myorg-",
        "urlTemplate": "https://registry.myorg.com/packages/{name}",
        "type": "npm"
      }
    ]
  }
}
```

No config file needed for normal use — all built-in resolvers are enabled by default.

## Resolver Type Detection Logic

When `type` is not specified, resolvers try to infer the type from the name pattern:

| Pattern | Inferred Type |
|---------|---------------|
| `@scope/name` | npm |
| `owner/repo` (single slash, no spaces) | github |
| `ms-*.**` | vscode |
| `org.*.*` (dot-separated, looks like reverse-DNS) | flatpak |
| `github.com/...` URL | github |

If no pattern matches, try all resolvers in order, then fall back to SearXNG.

## Error Handling

- **No SearXNG available:** `pidocs_lookup` returns resolver URLs only (no SearXNG results). `pidocs_install` returns built-in URL + best-effort install commands from known patterns.
- **Obscura not installed:** Skip fetch step, return URLs only with a note that install commands couldn't be extracted.
- **No resolvers match:** Both tools fall through to SearXNG search. If SearXNG also fails, return an informative error message suggesting the user try `WEB_Search` directly.
- **Page fetch fails:** Return what we have (URLs from SearXNG results) without the detailed install extraction.

## Self-Review

- ✅ No placeholders — all resolver URLs, extraction patterns, and parameters are specified
- ✅ Internally consistent — `pidocs-core.ts` orchestrates the pipeline defined in `pidocs-resolvers.ts` and `pidocs-install-extract.ts`, types match across files
- ✅ All requirement areas covered — built-in resolvers, config extensibility, SearXNG fallback, Obscura extraction, before_agent_start hook
- ✅ Scope is right — single focused feature in PiArgus, no unrelated refactoring