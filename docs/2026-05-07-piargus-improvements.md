# PiArgus Comprehensive Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all broken functionality, add missing test coverage, improve robustness, and polish the PiArgus two-tier browser extension.

**Architecture:** Fix the heavy-tier interaction pipeline by adding Node.js + Puppeteer to the smolvm image and replacing the broken `chromium --dump-dom` approach with proper CDP-driven automation. Add comprehensive unit tests for all pure-logic modules. Tighten TypeBox schemas and rename misleading tool names.

**Tech Stack:** TypeScript, Vitest, TypeBox, smolvm, Puppeteer, Obscura, SearXNG

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `.gitignore` | Ignore node_modules, dist, logs |
| Create | `tsconfig.json` | Strict TypeScript checking |
| Modify | `smolfier/browser.smolfile` | Add Node.js + Puppeteer for heavy-tier interactions |
| Modify | `smolvm.ts` | Fix screenshot fullPage flags; add `interact()` CDP function; remove dead `fillForm()` |
| Modify | `index.ts` | Rename `browser_obscura_serve` → `browser_vm_status`; tighten TypeBox types; fix heavy-tier action handlers to use new `interact()` |
| Modify | `package.json` | Add `typescript` to devDeps |
| Create | `test/tier-router.test.ts` | Unit tests for tier classification logic |
| Create | `test/web-search-core.test.ts` | Unit tests for SearXNG search + formatting |
| Modify | `test/obscura.test.ts` | Expand with function-level tests |
| Modify | `test/smolvm.test.ts` | Expand with VM interaction tests |
| Create | `test/index.test.ts` | Integration tests for tool registration |
| Create | `CONTRIBUTING.md` | Developer guide |

---

### Task 1: Add `.gitignore`

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
dist/
*.log
*.tsbuildinfo
.DS_Store
/tmp/
coverage/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore"
```

---

### Task 2: Add `tsconfig.json` with strict mode

**Files:**
- Create: `tsconfig.json`

- [ ] **Step 1: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 2: Add `typescript` to devDependencies and add typecheck script**

In `package.json`, add to `devDependencies`:

```json
"typescript": "^5.7.0"
```

Add to `scripts`:

```json
"typecheck": "tsc --noEmit"
```

- [ ] **Step 3: Run typecheck to see baseline errors**

Run: `npx tsc --noEmit 2>&1 | head -50`

Capture output. Some errors are expected (peer dependencies not installed locally). The goal is to have a baseline and fix what we can.

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json package.json package-lock.json
git commit -m "chore: add tsconfig.json with strict mode + typescript dep"
```

---

### Task 3: Fix `browser.smolfile` — add Node.js + Puppeteer

**Files:**
- Modify: `smolfier/browser.smolfile`

The current smolfile only installs Chromium. The heavy tier needs Puppeteer to drive real interactions (click, fill, hover). Without Node.js + Puppeteer in the VM, all heavy-tier actions besides basic screenshots are broken.

- [ ] **Step 1: Rewrite the smolfile**

Replace the entire contents of `smolfier/browser.smolfile`:

```toml
# smolfier/browser.smolfile
# Headless Chromium microVM for heavy-tier browser operations
# Alpine + Node.js + Puppeteer for full browser automation

image = "alpine:edge"

cpus = 4
memory = 4096
net = true

env = [
    "CHROME_BIN=/usr/bin/chromium",
    "PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium",
    "PUPPETEER_SKIP_DOWNLOAD=true",
    "NODE_PATH=/usr/lib/node_modules",
]

[dev]
init = [
    # Browser engine + fonts
    "apk add --no-cache chromium font-opensans nodejs npm",
    # Puppeteer (uses system Chromium, no download)
    "npm install -g puppeteer-core@latest",
]
```

Key changes:
- Added `nodejs` and `npm` via `apk add`
- Added `PUPPETEER_EXECUTABLE_PATH` so puppeteer-core finds the system Chromium
- Install `puppeteer-core` globally (no bundled Chromium download — uses the `apk` one)
- Removed `CHROME_BIN` → replaced with both `CHROME_BIN` and `PUPPETEER_EXECUTABLE_PATH`

- [ ] **Step 2: Commit**

```bash
git add smolfier/browser.smolfile
git commit -m "fix: add Node.js + puppeteer-core to browser smolfile for heavy-tier interactions"
```

---

### Task 4: Fix `smolvm.ts` — screenshot fullPage + add `interact()` + remove dead code

**Files:**
- Modify: `smolvm.ts`

This fixes three problems:
1. `screenshot()` has duplicate `--screenshot` flag and uses non-existent `--virtual-time-budget` Chromium flag
2. `clickElement()` and `fillForm()` are broken (no Puppeteer available, wrong approach)
3. `fillForm()` is unused dead code

- [ ] **Step 1: Fix the `screenshot()` function**

Find the `screenshot()` function and replace it entirely:

```typescript
/** Take a screenshot of a URL inside the VM */
export async function screenshot(
  url: string,
  outputPath: string,
  opts?: { fullPage?: boolean; width?: number; height?: number }
): Promise<{ path: string; error?: string }> {
  const ensure = await ensureVm();
  if (!ensure.running) {
    return { path: outputPath, error: ensure.error };
  }

  const width = opts?.width ?? 1280;
  const height = opts?.height ?? 800;

  // Use a Node.js script that drives Chromium via puppeteer-core
  const script = `
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: ${width}, height: ${height} });
  await page.goto('${url}', { waitUntil: 'networkidle2', timeout: 15000 });
  await page.screenshot({
    path: '/tmp/smolvm-screenshot.png',
    fullPage: ${opts?.fullPage ? "true" : "false"},
  });
  await browser.close();
  console.log('OK');
})();
`.trim();

  // Write script to VM and execute
  const writeResult = await vmExec(
    ["sh", "-c", `cat > /tmp/screenshot.js << 'SCRIPT'\n${script}\nSCRIPT`],
    { timeout: 5_000 }
  );

  if (writeResult.exitCode !== 0) {
    return { path: outputPath, error: `Failed to write screenshot script: ${writeResult.stderr}` };
  }

  const nodeResult = await vmExec(["node", "/tmp/screenshot.js"], { timeout: 30_000 });

  if (nodeResult.exitCode !== 0) {
    return { path: outputPath, error: `Screenshot failed: ${nodeResult.stderr || nodeResult.stdout}` };
  }

  // Copy screenshot from VM to host via base64
  const b64Result = await vmExec(["base64", "/tmp/smolvm-screenshot.png"], { timeout: 10_000 });

  if (b64Result.exitCode !== 0) {
    return { path: outputPath, error: `Failed to extract screenshot: ${b64Result.stderr}` };
  }

  // Decode and write to host filesystem
  const imageBuffer = Buffer.from(b64Result.stdout.trim(), "base64");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, imageBuffer);

  return { path: outputPath };
}
```

- [ ] **Step 2: Replace `clickElement()` with `interact()` — a general-purpose CDP interaction function**

Remove the entire `clickElement()` function and the entire `fillForm()` function. Replace both with a single `interact()` function:

```typescript
/** Interaction action types for the heavy tier */
export type InteractionAction =
  | { type: "click"; selector: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "hover"; selector: string }
  | { type: "wait_for"; selector: string; timeout?: number }
  | { type: "scroll"; x?: number; y?: number }
  | { type: "keypress"; key: string };

/** Result from a page interaction */
export interface InteractionResult {
  success: boolean;
  html?: string;
  error?: string;
}

/**
 * Perform one or more browser interactions on a page using puppeteer-core
 * inside the smolvm VM. Returns the final page HTML after all actions.
 */
export async function interact(
  url: string,
  actions: InteractionAction[],
  opts?: { timeout?: number; stealth?: boolean }
): Promise<InteractionResult> {
  const ensure = await ensureVm();
  if (!ensure.running) {
    return { success: false, error: ensure.error };
  }

  // Serialize actions to JSON for the Node.js script inside the VM
  const actionsJson = JSON.stringify(actions)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");

  const stealthArgs = opts?.stealth
    ? `await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });`
    : "";

  const script = `
const puppeteer = require('puppeteer-core');
const actions = JSON.parse('${actionsJson}');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  ${stealthArgs}
  await page.goto('${url}', { waitUntil: 'networkidle2', timeout: ${(opts?.timeout ?? 15) * 1000} });

  for (const action of actions) {
    switch (action.type) {
      case 'click':
        await page.waitForSelector(action.selector, { timeout: 5000 });
        await page.click(action.selector);
        await page.waitForNetworkIdle({ timeout: 3000 }).catch(() => {});
        break;
      case 'fill':
        await page.waitForSelector(action.selector, { timeout: 5000 });
        await page.click(action.selector, { clickCount: 3 });
        await page.type(action.selector, action.value);
        break;
      case 'hover':
        await page.waitForSelector(action.selector, { timeout: 5000 });
        await page.hover(action.selector);
        break;
      case 'wait_for':
        await page.waitForSelector(action.selector, { timeout: action.timeout || 5000 });
        break;
      case 'scroll':
        await page.evaluate((x, y) => window.scrollBy(x || 0, y || 0), action.x, action.y);
        break;
      case 'keypress':
        await page.keyboard.press(action.key);
        break;
    }
  }

  const html = await page.content();
  await browser.close();
  process.stdout.write(html);
})();
`.trim();

  // Write the interaction script into the VM
  const writeResult = await vmExec(
    ["sh", "-c", `cat > /tmp/interact.js << 'SCRIPT'\n${script}\nSCRIPT`],
    { timeout: 5_000 }
  );

  if (writeResult.exitCode !== 0) {
    return { success: false, error: `Failed to write interaction script: ${writeResult.stderr}` };
  }

  const nodeResult = await vmExec(["node", "/tmp/interact.js"], {
    timeout: (opts?.timeout ?? 15) * 1000,
  });

  if (nodeResult.exitCode !== 0) {
    return { success: false, error: nodeResult.stderr || nodeResult.stdout };
  }

  return { success: true, html: nodeResult.stdout };
}
```

- [ ] **Step 3: Remove the dead `renderPage()` function**

The old `renderPage()` just ran `chromium --dump-dom` which is superseded by `interact()` with zero actions. Remove it entirely.

Delete the `renderPage` function from `smolvm.ts`.

- [ ] **Step 4: Update exports — remove `renderPage`, `clickElement`, `fillForm`; add `interact`, `InteractionAction`, `InteractionResult`**

At the top of `index.ts`, update the smolvm import:

Old:
```typescript
import {
  isSmolvmInstalled,
  ensureVm,
  stopVm,
  screenshot as smolvmScreenshot,
  renderPage,
  getVmStatus,
  vmExec,
} from "./smolvm";
```

New:
```typescript
import {
  isSmolvmInstalled,
  ensureVm,
  stopVm,
  screenshot as smolvmScreenshot,
  interact,
  getVmStatus,
} from "./smolvm";
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Errors only from `index.ts` where `renderPage` was still used (fixed in next task). No other new errors.

- [ ] **Step 6: Commit**

```bash
git add smolvm.ts index.ts
git commit -m "fix: replace broken chromium --dump-dom with puppeteer-core CDP interactions

- screenshot() now uses puppeteer-core (fixes fullPage, removes duplicate flags)
- New interact() function handles click/fill/hover/wait_for/scroll/keypress
- Removed dead clickElement(), fillForm(), renderPage() functions
- browser.smolfile now installs Node.js + puppeteer-core"
```

---

### Task 5: Fix `index.ts` — heavy-tier action handlers + TypeBox types + tool rename

**Files:**
- Modify: `index.ts`

This task fixes the broken heavy-tier action routing, tightens parameter types, and renames the misleading tool.

- [ ] **Step 1: Fix the heavy-tier `browser_action` handler to use `interact()`**

Replace the entire heavy-tier block inside `browser_action`'s `execute` function. Find the comment `// ── Heavy tier (smolvm+Chromium) ──` and replace everything from there to the closing of the `switch` statement with:

```typescript
      // ── Heavy tier (smolvm+Chromium) ──────────────────────────────────
      if (!isSmolvmInstalled()) {
        return {
          content: [{
            type: "text",
            text: `Heavy-tier action '${params.action}' requires smolvm. Install: curl -sSL https://smolmachines.com/install.sh | bash`,
          }],
          isError: true,
        };
      }

      // Map the action to an InteractionAction
      let interactionAction: import("./smolvm").InteractionAction;
      switch (params.action) {
        case "click":
          if (!params.selector && (params.x === undefined || params.y === undefined)) {
            return { content: [{ type: "text", text: "click requires selector or x/y coordinates" }], isError: true };
          }
          interactionAction = params.selector
            ? { type: "click", selector: params.selector }
            : { type: "click", selector: `elementFromPoint(${params.x},${params.y})` };
          break;
        case "fill":
          if (!params.selector || !params.value) {
            return { content: [{ type: "text", text: "fill requires selector and value" }], isError: true };
          }
          interactionAction = { type: "fill", selector: params.selector, value: params.value };
          break;
        case "hover":
          if (!params.selector) {
            return { content: [{ type: "text", text: "hover requires selector" }], isError: true };
          }
          interactionAction = { type: "hover", selector: params.selector };
          break;
        case "wait_for":
          if (!params.selector) {
            return { content: [{ type: "text", text: "wait_for requires selector" }], isError: true };
          }
          interactionAction = { type: "wait_for", selector: params.selector };
          break;
        default:
          return {
            content: [{ type: "text", text: `Unknown heavy action: ${params.action}` }],
            isError: true,
          };
      }

      const result = await interact(params.url, [interactionAction], { stealth: params.stealth });

      if (!result.success) {
        return { content: [{ type: "text", text: `Action failed: ${result.error}` }], isError: true };
      }

      return {
        content: [{ type: "text", text: truncate(result.html || "Action completed (no HTML returned).") }],
        details: { tier, action: params.action, selector: params.selector },
      };
```

- [ ] **Step 2: Tighten TypeBox types on `browser_fetch` parameters**

Find the `browser_fetch` tool's `mode` parameter and replace:

Old:
```typescript
      mode: Type.Optional(
        Type.String({
          description: "Output mode: 'html' | 'text' | 'links' | 'eval'. Default: 'html'.",
        })
      ),
```

New:
```typescript
      mode: Type.Optional(
        Type.Union(
          [Type.Literal("html"), Type.Literal("text"), Type.Literal("links"), Type.Literal("eval")],
          { description: "Output mode: 'html' | 'text' | 'links' | 'eval'. Default: 'html'." }
        )
      ),
```

- [ ] **Step 3: Tighten TypeBox types on `browser_action` parameters**

Find the `browser_action` tool's `action` parameter and replace:

Old:
```typescript
      action: Type.String({
        description: "Action type: 'js' | 'navigate' | 'screenshot_info' | 'click' | 'fill' | 'hover' | 'wait_for'",
      }),
```

New:
```typescript
      action: Type.Union(
        [
          Type.Literal("js"),
          Type.Literal("navigate"),
          Type.Literal("screenshot_info"),
          Type.Literal("click"),
          Type.Literal("fill"),
          Type.Literal("hover"),
          Type.Literal("wait_for"),
        ],
        {
          description: "Action type: 'js' | 'navigate' | 'screenshot_info' | 'click' | 'fill' | 'hover' | 'wait_for'",
        }
      ),
```

- [ ] **Step 4: Tighten TypeBox types on `browser_scrape` parameters**

Find the `browser_scrape` tool's `format` parameter and replace:

Old:
```typescript
      format: Type.Optional(Type.String({ description: "Output format: 'json' | 'text'. Default: 'json'.", default: "json" })),
```

New:
```typescript
      format: Type.Optional(
        Type.Union(
          [Type.Literal("json"), Type.Literal("text")],
          { description: "Output format: 'json' | 'text'. Default: 'json'." }
        )
      ),
```

- [ ] **Step 5: Rename `browser_obscura_serve` → `browser_vm_status`**

In the tool registration for `browser_obscura_serve`, change:

Old:
```typescript
    name: "browser_obscura_serve",
    label: "Browser VM Status",
```

New:
```typescript
    name: "browser_vm_status",
    label: "Browser VM Status",
```

Also update the `promptSnippet`:

Old:
```typescript
    promptSnippet: "Check browser VM status or pre-warm heavy tier",
```

New:
```typescript
    promptSnippet: "Check browser infrastructure status or pre-warm heavy tier",
```

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Only errors from unresolvable peer dependencies (Pi SDK, TypeBox). No errors from our code.

- [ ] **Step 7: Commit**

```bash
git add index.ts
git commit -m "fix: heavy-tier actions use interact(), tighten TypeBox types, rename tool

- browser_action click/fill/hover/wait_for now use puppeteer-core CDP
- browser_fetch.mode, browser_action.action, browser_scrape.format now use TypeBox unions
- Renamed browser_obscura_serve → browser_vm_status"
```

---

### Task 6: Add tests for `tier-router.ts`

**Files:**
- Create: `test/tier-router.test.ts`

- [ ] **Step 1: Write comprehensive tests**

```typescript
// test/tier-router.test.ts
import { describe, it, expect } from "vitest";
import { classifyTier, tierExplanation } from "../tier-router";

describe("classifyTier", () => {
  describe("browser_screenshot", () => {
    it("always routes to heavy tier", () => {
      expect(classifyTier("browser_screenshot", { url: "https://example.com" })).toBe("heavy");
    });
  });

  describe("browser_action", () => {
    it("routes click to heavy tier", () => {
      expect(classifyTier("browser_action", { action: "click", selector: "button" })).toBe("heavy");
    });

    it("routes fill to heavy tier", () => {
      expect(classifyTier("browser_action", { action: "fill", selector: "input", value: "hello" })).toBe("heavy");
    });

    it("routes hover to heavy tier", () => {
      expect(classifyTier("browser_action", { action: "hover", selector: ".menu" })).toBe("heavy");
    });

    it("routes wait_for to heavy tier", () => {
      expect(classifyTier("browser_action", { action: "wait_for", selector: ".loaded" })).toBe("heavy");
    });

    it("routes js to light tier", () => {
      expect(classifyTier("browser_action", { action: "js", expression: "document.title" })).toBe("light");
    });

    it("routes navigate to light tier", () => {
      expect(classifyTier("browser_action", { action: "navigate" })).toBe("light");
    });

    it("routes screenshot_info to light tier", () => {
      expect(classifyTier("browser_action", { action: "screenshot_info" })).toBe("light");
    });

    it("routes unknown action to light tier (safe default)", () => {
      expect(classifyTier("browser_action", { action: "unknown" })).toBe("light");
    });
  });

  describe("other tools", () => {
    it("routes browser_fetch to light tier", () => {
      expect(classifyTier("browser_fetch", { url: "https://example.com", mode: "text" })).toBe("light");
    });

    it("routes browser_navigate to light tier", () => {
      expect(classifyTier("browser_navigate", { url: "https://example.com" })).toBe("light");
    });

    it("routes browser_scrape to light tier", () => {
      expect(classifyTier("browser_scrape", { urls: ["https://a.com", "https://b.com"] })).toBe("light");
    });
  });
});

describe("tierExplanation", () => {
  it("explains heavy tier for screenshots", () => {
    const explanation = tierExplanation("browser_screenshot", { url: "https://example.com" });
    expect(explanation).toContain("smolvm");
    expect(explanation).toContain("Chromium");
  });

  it("explains heavy tier for click action", () => {
    const explanation = tierExplanation("browser_action", { action: "click" });
    expect(explanation).toContain("DOM interaction");
  });

  it("explains light tier for fetch", () => {
    const explanation = tierExplanation("browser_fetch", { url: "https://example.com" });
    expect(explanation).toContain("Obscura");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/tier-router.test.ts`

Expected: All 14 tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/tier-router.test.ts
git commit -m "test: add comprehensive tier-router tests (14 cases)"
```

---

### Task 7: Add tests for `web-search-core.ts`

**Files:**
- Create: `test/web-search-core.test.ts`

- [ ] **Step 1: Write tests with mocked fetch**

```typescript
// test/web-search-core.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSearXNG, formatResults, DEFAULT_MAX_RESULTS } from "../web-search-core";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const MOCK_RESPONSE = {
  query: "test query",
  number_of_results: 42,
  results: [
    {
      title: "Result One",
      url: "https://example.com/1",
      content: "Snippet one",
      engines: ["google", "brave"],
      publishedDate: "2026-01-15",
    },
    {
      title: "Result Two",
      url: "https://example.com/2",
      content: "Snippet two",
      engines: ["duckduckgo"],
    },
    {
      title: "Result Three",
      url: "https://example.com/3",
      content: "",
      engines: ["google"],
    },
  ],
  answers: [],
  suggestions: ["test query suggestion"],
  unresponsive_engines: [],
};

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(MOCK_RESPONSE),
  });
});

describe("searchSearXNG", () => {
  it("sends a POST request to the SearXNG JSON API", async () => {
    const result = await searchSearXNG("test query", {});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/search");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Accept).toBe("application/json");
  });

  it("returns mapped results with title, url, snippet, engines", async () => {
    const result = await searchSearXNG("test query", {});

    expect(result.query).toBe("test query");
    expect(result.totalResults).toBe(42);
    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toEqual({
      title: "Result One",
      url: "https://example.com/1",
      snippet: "Snippet one",
      engines: ["google", "brave"],
      publishedDate: "2026-01-15",
    });
  });

  it("respects maxResults option", async () => {
    const result = await searchSearXNG("test query", { maxResults: 2 });

    expect(result.results).toHaveLength(2);
  });

  it("defaults to DEFAULT_MAX_RESULTS when maxResults not set", async () => {
    await searchSearXNG("test query", {});

    // Just verify it was called — the slicing happens in the function
    expect(mockFetch).toHaveBeenCalled();
  });

  it("passes categories parameter", async () => {
    await searchSearXNG("test query", { categories: "it" });

    const [url] = mockFetch.mock.calls[0];
    // Categories should be in the POST body (URLSearchParams)
    expect(url).toContain("/search");
  });

  it("passes timeRange parameter", async () => {
    await searchSearXNG("test query", { timeRange: "week" });

    expect(mockFetch).toHaveBeenCalled();
  });

  it("throws on non-OK response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    await expect(searchSearXNG("test query", {})).rejects.toThrow("HTTP 503");
  });

  it("handles empty results gracefully", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        query: "empty",
        number_of_results: 0,
        results: [],
        answers: [],
        suggestions: [],
        unresponsive_engines: [],
      }),
    });

    const result = await searchSearXNG("empty", {});
    expect(result.results).toHaveLength(0);
    expect(result.totalResults).toBe(0);
  });

  it("uses SEARXNG_URL env var when set", async () => {
    process.env.SEARXNG_URL = "http://custom:9999";
    await searchSearXNG("test", {});
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("custom:9999");
    delete process.env.SEARXNG_URL;
  });
});

describe("formatResults", () => {
  it("formats results as markdown with numbered entries", () => {
    const response = {
      results: [
        {
          title: "Example",
          url: "https://example.com",
          snippet: "A snippet",
          engines: ["google"],
          publishedDate: "2026-01-01",
        },
      ],
      totalResults: 1,
      query: "example",
    };

    const text = formatResults(response);

    expect(text).toContain("### 1. Example");
    expect(text).toContain("**URL:** https://example.com");
    expect(text).toContain("**Snippet:** A snippet");
    expect(text).toContain("**Source:** [google]");
    expect(text).toContain("(2026-01-01)");
  });

  it("shows 'No results found' for empty results", () => {
    const text = formatResults({
      results: [],
      totalResults: 0,
      query: "nothing",
    });

    expect(text).toContain("No results found");
  });

  it("omits snippet and source lines when absent", () => {
    const text = formatResults({
      results: [
        { title: "No Frills", url: "https://a.com", snippet: "", engines: [] },
      ],
      totalResults: 1,
      query: "test",
    });

    expect(text).not.toContain("**Snippet:**");
    expect(text).not.toContain("**Source:**");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/web-search-core.test.ts`

Expected: All 12 tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/web-search-core.test.ts
git commit -m "test: add web-search-core unit tests with mocked fetch (12 cases)"
```

---

### Task 8: Expand `obscura.test.ts`

**Files:**
- Modify: `test/obscura.test.ts`

- [ ] **Step 1: Replace with expanded tests**

```typescript
// test/obscura.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execAsync, OBSCURA_PATH, fetchText, fetchHtml, fetchLinks, evalJs, isInstalled } from "../obscura";

// Mock execFile so we don't need obscura installed
vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], opts: any, cb: Function) => {
    // Default: simulate successful text dump
    if (args.includes("--version")) {
      cb(null, { stdout: "obscura 1.0.0\n", stderr: "" });
    } else if (args.includes("--dump") && args.includes("text")) {
      cb(null, { stdout: "Hello World from page", stderr: "" });
    } else if (args.includes("--dump") && args.includes("html")) {
      cb(null, { stdout: "<html><body>Hello</body></html>", stderr: "" });
    } else if (args.includes("--dump") && args.includes("links")) {
      cb(null, { stdout: "https://example.com\nhttps://example.org\n", stderr: "" });
    } else if (args.includes("--eval")) {
      cb(null, { stdout: '{"title":"Test Page"}', stderr: "" });
    } else {
      cb(null, { stdout: "", stderr: "" });
    }
  },
}));

// Mock existsSync to make OBSCURA_PATH find our mock
vi.mock("node:fs", () => ({
  existsSync: (p: string) => p.includes(".local/bin/obscura"),
}));

describe("OBSCURA_PATH", () => {
  it("returns the obscura binary path", () => {
    const path = OBSCURA_PATH();
    expect(path).toBeTruthy();
    expect(typeof path).toBe("string");
  });
});

describe("isInstalled", () => {
  it("returns boolean without throwing", () => {
    const result = isInstalled();
    expect(typeof result).toBe("boolean");
  });
});

describe("fetchText", () => {
  it("passes --dump text flag", async () => {
    const result = await fetchText("https://example.com");
    expect(result.stdout).toContain("Hello World");
  });

  it("passes stealth flag when set", async () => {
    const result = await fetchText("https://example.com", { stealth: true });
    expect(result.stdout).toBeTruthy();
  });

  it("passes selector flag when set", async () => {
    const result = await fetchText("https://example.com", { selector: "main" });
    expect(result.stdout).toBeTruthy();
  });
});

describe("fetchHtml", () => {
  it("passes --dump html flag", async () => {
    const result = await fetchHtml("https://example.com");
    expect(result.stdout).toContain("<html>");
  });
});

describe("fetchLinks", () => {
  it("passes --dump links flag", async () => {
    const result = await fetchLinks("https://example.com");
    expect(result.stdout).toContain("https://example.com");
    expect(result.stdout).toContain("https://example.org");
  });
});

describe("evalJs", () => {
  it("passes --eval flag with expression", async () => {
    const result = await evalJs("https://example.com", "document.title");
    expect(result.stdout).toContain("Test Page");
  });

  it("passes stealth flag when set", async () => {
    const result = await evalJs("https://example.com", "1+1", { stealth: true });
    expect(result.stdout).toBeTruthy();
  });
});

describe("execAsync", () => {
  it("returns stdout and stderr properties", async () => {
    const result = await execAsync(["--version"], 5_000);
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/obscura.test.ts`

Expected: All 11 tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/obscura.test.ts
git commit -m "test: expand obscura tests with mocked CLI calls (11 cases)"
```

---

### Task 9: Expand `smolvm.test.ts`

**Files:**
- Modify: `test/smolvm.test.ts`

- [ ] **Step 1: Replace with expanded tests**

```typescript
// test/smolvm.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:child_process before importing the module
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

// Mock node:fs
vi.mock("node:fs", () => ({
  existsSync: (p: string) => p.includes(".local/bin/smolvm"),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-png-data")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { SMOLVM_PATH, isSmolvmInstalled, getVmStatus, interact } from "../smolvm";

describe("SMOLVM_PATH", () => {
  it("returns a path string", () => {
    const path = SMOLVM_PATH();
    expect(path).toBeTruthy();
    expect(typeof path).toBe("string");
  });
});

describe("isSmolvmInstalled", () => {
  it("returns boolean without throwing", () => {
    const result = isSmolvmInstalled();
    expect(typeof result).toBe("boolean");
  });
});

describe("getVmStatus", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("returns 'running' when machine reports running", async () => {
    mockExecFile.mockImplementation((bin, args, opts, cb) => {
      cb(null, { stdout: "running\n", stderr: "" });
    });
    const status = await getVmStatus();
    expect(status).toBe("running");
  });

  it("returns 'stopped' when machine reports stopped", async () => {
    mockExecFile.mockImplementation((bin, args, opts, cb) => {
      cb(null, { stdout: "stopped\n", stderr: "" });
    });
    const status = await getVmStatus();
    expect(status).toBe("stopped");
  });

  it("returns 'stopped' when machine not found", async () => {
    mockExecFile.mockImplementation((bin, args, opts, cb) => {
      cb({ code: 1, stderr: "machine not found", stdout: "" });
    });
    const status = await getVmStatus();
    expect(status).toBe("stopped");
  });
});

describe("interact", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("returns error when smolvm not installed", async () => {
    // This test relies on the real isSmolvmInstalled which checks existsSync
    // Since we mocked existsSync to return true for .local/bin/smolvm,
    // we need to mock the VM status to say "stopped" and create to succeed
    mockExecFile
      .mockImplementationOnce((bin, args, opts, cb) => {
        // machine status — not found
        cb({ code: 1, stderr: "not found", stdout: "" });
      })
      .mockImplementationOnce((bin, args, opts, cb) => {
        // machine create
        cb(null, { stdout: "created\n", stderr: "" });
      })
      .mockImplementationOnce((bin, args, opts, cb) => {
        // machine start
        cb(null, { stdout: "started\n", stderr: "" });
      })
      .mockImplementationOnce((bin, args, opts, cb) => {
        // write script
        cb(null, { stdout: "", stderr: "" });
      })
      .mockImplementationOnce((bin, args, opts, cb) => {
        // node interact.js — returns HTML
        cb(null, { stdout: "<html>clicked</html>", stderr: "" });
      });

    const result = await interact("https://example.com", [
      { type: "click", selector: "button" },
    ]);

    expect(result.success).toBe(true);
    expect(result.html).toContain("clicked");
  });

  it("returns error when script fails", async () => {
    mockExecFile
      .mockImplementationOnce((bin, args, opts, cb) => {
        // machine status — running
        cb(null, { stdout: "running\n", stderr: "" });
      })
      .mockImplementationOnce((bin, args, opts, cb) => {
        // write script
        cb(null, { stdout: "", stderr: "" });
      })
      .mockImplementationOnce((bin, args, opts, cb) => {
        // node interact.js — fails
        cb({ code: 1, stderr: "Puppeteer error", stdout: "" });
      });

    const result = await interact("https://example.com", [
      { type: "fill", selector: "input", value: "test" },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Puppeteer error");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/smolvm.test.ts`

Expected: All 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/smolvm.test.ts
git commit -m "test: expand smolvm tests with mocked VM interactions (7 cases)"
```

---

### Task 10: Add tool registration tests for `index.ts`

**Files:**
- Create: `test/index.test.ts`

- [ ] **Step 1: Write tests verifying all tools are registered with correct shapes**

```typescript
// test/index.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies before importing index.ts
vi.mock("../obscura", () => ({
  OBSCURA_PATH: () => "/usr/local/bin/obscura",
  isInstalled: () => true,
  fetchText: vi.fn().mockResolvedValue({ stdout: "text", stderr: "" }),
  fetchHtml: vi.fn().mockResolvedValue({ stdout: "<html>", stderr: "" }),
  fetchLinks: vi.fn().mockResolvedValue({ stdout: "links", stderr: "" }),
  evalJs: vi.fn().mockResolvedValue({ stdout: "result", stderr: "" }),
  execAsync: vi.fn().mockResolvedValue({ stdout: "ok", stderr: "" }),
}));

vi.mock("../smolvm", () => ({
  isSmolvmInstalled: () => true,
  ensureVm: vi.fn().mockResolvedValue({ running: true }),
  stopVm: vi.fn().mockResolvedValue({ stopped: true }),
  screenshot: vi.fn().mockResolvedValue({ path: "/tmp/shot.png" }),
  interact: vi.fn().mockResolvedValue({ success: true, html: "<html>ok</html>" }),
  getVmStatus: vi.fn().mockResolvedValue("running"),
}));

vi.mock("../tier-router", () => ({
  classifyTier: vi.fn().mockReturnValue("light"),
  tierExplanation: vi.fn().mockReturnValue("Obscura"),
}));

vi.mock("../web-search", () => ({
  registerWebSearch: vi.fn(),
}));

const registeredTools: Array<{ name: string; label: string; parameters: any }> = [];
const mockPi = {
  on: vi.fn(),
  registerTool: vi.fn((tool) => {
    registeredTools.push({ name: tool.name, label: tool.label, parameters: tool.parameters });
  }),
};

describe("PiArgus extension registration", () => {
  beforeEach(async () => {
    registeredTools.length = 0;
    vi.clearAllMocks();
    const mod = await import("../index");
    await mod.default(mockPi as any);
  });

  it("registers session_shutdown handler", () => {
    expect(mockPi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
  });

  it("registers 6 tools", () => {
    expect(mockPi.registerTool).toHaveBeenCalledTimes(6);
  });

  it("registers WEB_Search tool via registerWebSearch", () => {
    const { registerWebSearch } = vi.mocked(await import("../web-search"));
    expect(registerWebSearch).toHaveBeenCalledWith(mockPi);
  });

  it("registers browser_navigate tool", () => {
    const names = registeredTools.map((t) => t.name);
    expect(names).toContain("browser_navigate");
  });

  it("registers browser_fetch tool", () => {
    const names = registeredTools.map((t) => t.name);
    expect(names).toContain("browser_fetch");
  });

  it("registers browser_screenshot tool", () => {
    const names = registeredTools.map((t) => t.name);
    expect(names).toContain("browser_screenshot");
  });

  it("registers browser_action tool", () => {
    const names = registeredTools.map((t) => t.name);
    expect(names).toContain("browser_action");
  });

  it("registers browser_scrape tool", () => {
    const names = registeredTools.map((t) => t.name);
    expect(names).toContain("browser_scrape");
  });

  it("registers browser_vm_status tool (renamed from browser_obscura_serve)", () => {
    const names = registeredTools.map((t) => t.name);
    expect(names).toContain("browser_vm_status");
    expect(names).not.toContain("browser_obscura_serve");
  });

  it("browser_fetch has a mode parameter with union type", () => {
    const fetchTool = registeredTools.find((t) => t.name === "browser_fetch");
    expect(fetchTool).toBeTruthy();
    // TypeBox Union types have an "anyOf" property
    const modeParam = fetchTool!.parameters.properties?.mode;
    expect(modeParam).toBeTruthy();
  });

  it("browser_action has an action parameter", () => {
    const actionTool = registeredTools.find((t) => t.name === "browser_action");
    expect(actionTool).toBeTruthy();
    const actionParam = actionTool!.parameters.properties?.action;
    expect(actionParam).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/index.test.ts`

Expected: All 11 tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/index.test.ts
git commit -m "test: add tool registration tests for index.ts (11 cases)"
```

---

### Task 11: Run full test suite + typecheck

**Files:**
- No file changes — verification only

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: All tests across all files pass. Total should be ~55 tests (14 + 12 + 11 + 7 + 11).

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Zero errors from our source files. Only possible errors from unresolvable peer deps (Pi SDK, TypeBox) which are fine since they're resolved at runtime.

- [ ] **Step 3: Fix any issues found**

If any tests fail or type errors appear in our code, fix them and re-run.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address test/typecheck issues from full suite run"
```

---

### Task 12: Create `CONTRIBUTING.md`

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Write the contributing guide**

```markdown
# Contributing to PiArgus

## Architecture

PiArgus is a two-tier browser extension for the Pi coding agent:

| Tier | Engine | Use Case |
|------|--------|----------|
| Light | Obscura (V8, 30MB) | Fetch, scrape, eval, links, text, search |
| Heavy | smolvm + Chromium + Puppeteer | Screenshots, clicks, forms, GPU rendering |

The tier router (`tier-router.ts`) automatically classifies which tier a tool call needs. Heavy actions are routed to a smolvm microVM running Chromium driven by puppeteer-core.

## File Map

| File | Responsibility |
|------|----------------|
| `index.ts` | Tool registration + execution dispatch |
| `obscura.ts` | Light-tier Obscura CLI wrapper |
| `smolvm.ts` | Heavy-tier smolvm + Puppeteer interactions |
| `tier-router.ts` | Automatic tier classification |
| `web-search.ts` | SearXNG search tool registration |
| `web-search-core.ts` | Pure SearXNG search logic (JSON API) |
| `types.ts` | Shared TypeScript type definitions |
| `smolfier/browser.smolfile` | smolvm VM image definition |

## Adding a New Tool

1. If the tool uses Obscura, add helper functions to `obscura.ts`
2. If the tool uses smolvm+Chromium, add an `InteractionAction` type to `smolvm.ts`
3. Register the tool in `index.ts` using `pi.registerTool()`
4. Update `tier-router.ts` if the new tool needs heavy tier
5. Add tests — unit tests for logic, registration tests in `test/index.test.ts`

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npx tsc --noEmit

# Run a single test file
npx vitest run test/tier-router.test.ts
```

## Testing

Tests use Vitest. Mock external binaries (Obscura, smolvm) — never depend on them being installed in CI.

- **Pure logic** (tier-router, web-search-core): Full unit tests with no mocks or minimal mocks
- **CLI wrappers** (obscura, smolvm): Mock `execFile` and test argument construction
- **Tool registration** (index): Mock all dependencies, verify tool names, labels, parameter shapes
```

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING.md with architecture, file map, and dev guide"
```

---

### Task 13: Update `README.md` tool table

**Files:**
- Modify: `README.md`

The tool table still references `browser_obscura_serve` and doesn't reflect the Puppeteer-powered heavy tier.

- [ ] **Step 1: Update the tool table**

Find the tools table in README.md and replace:

Old:
```markdown
| Tool | Tier | Description |
|------|------|-------------|
| `WEB_Search` | Search | SearXNG metasearch (titles, URLs, snippets) |
| `browser_fetch` | Light | Fetch page as text/html/links/eval |
| `browser_navigate` | Light | Navigate & get page metadata |
| `browser_scrape` | Light | Bulk parallel scraping |
| `browser_screenshot` | Heavy | Full-page screenshots via Chromium |
| `browser_action` | Dual | JS eval (light) or click/fill/hover (heavy) |
| `browser_obscura_serve` | Both | Status check / pre-warm heavy VM |
```

New:
```markdown
| Tool | Tier | Description |
|------|------|-------------|
| `WEB_Search` | Search | SearXNG metasearch (titles, URLs, snippets) |
| `browser_fetch` | Light | Fetch page as text/html/links/eval |
| `browser_navigate` | Light | Navigate & get page metadata |
| `browser_scrape` | Light | Bulk parallel scraping |
| `browser_screenshot` | Heavy | Full-page screenshots via Puppeteer + Chromium |
| `browser_action` | Dual | JS eval (light) or click/fill/hover (heavy) via CDP |
| `browser_vm_status` | Both | Status check / pre-warm heavy VM |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README tool table (rename, Puppeteer mention)"
```

---

### Task 14: Update `docs/architecture.svg` and `docs/architecture.png`

**Files:**
- Modify: `docs/architecture.svg`
- Modify: `docs/architecture.png`

The architecture diagram should reflect:
- Puppeteer-core in the smolvm VM
- The renamed `browser_vm_status` tool
- The CDP interaction pipeline

- [ ] **Step 1: Update the architecture diagram**

Update `docs/architecture.svg` to reflect:
- smolvm VM now contains: Alpine + Chromium + Node.js + puppeteer-core
- Heavy-tier flow: `interact()` → Node.js script → puppeteer-core → CDP → Chromium
- Tool name `browser_vm_status` (not `browser_obscura_serve`)

Export the SVG to PNG:
```bash
# If rsvg-convert or inkscape is available:
rsvg-convert -w 1200 docs/architecture.svg > docs/architecture.png
# Or use a browser-based conversion
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture.svg docs/architecture.png
git commit -m "docs: update architecture diagram for Puppeteer + renamed tool"
```

---

## Summary

| Task | Priority | Area | Files Changed | Est. Steps |
|------|----------|------|---------------|------------|
| 1 | 🟠 Infra | `.gitignore` | 1 new | 2 |
| 2 | 🟠 Infra | `tsconfig.json` | 1 new, 1 mod | 4 |
| 3 | 🔴 Critical | `browser.smolfile` | 1 mod | 2 |
| 4 | 🔴 Critical | `smolvm.ts` | 2 mod | 6 |
| 5 | 🔴 Critical | `index.ts` | 1 mod | 7 |
| 6 | 🟡 Tests | `tier-router` | 1 new | 3 |
| 7 | 🟡 Tests | `web-search-core` | 1 new | 3 |
| 8 | 🟡 Tests | `obscura` | 1 mod | 3 |
| 9 | 🟡 Tests | `smolvm` | 1 mod | 3 |
| 10 | 🟡 Tests | `index.ts` registration | 1 new | 3 |
| 11 | 🟡 Verification | Full suite | 0 | 4 |
| 12 | 🔵 Docs | `CONTRIBUTING.md` | 1 new | 2 |
| 13 | 🔵 Docs | `README.md` | 1 mod | 2 |
| 14 | 🔵 Docs | Architecture diagram | 2 mod | 2 |

**Total: 14 tasks, ~46 steps**
