// index.ts — Unified tiered browser extension
// Light tier: Obscura (V8-based, 30MB) for fast stateless fetches
// Heavy tier: smolvm+Chromium for full browser automation

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFile } from "node:fs/promises";

// Light tier
import {
  OBSCURA_PATH,
  isInstalled as isObscuraInstalled,
  fetchText,
  fetchHtml,
  fetchLinks,
  evalJs,
  execAsync as obscuraExec,
} from "./obscura";

// Heavy tier
import {
  isSmolvmInstalled,
  ensureVm,
  stopVm,
  screenshot as smolvmScreenshot,
  interact,
  getVmStatus,
} from "./smolvm";

// Router
import { classifyTier } from "./tier-router";

// Web search
import { registerWebSearch } from "./web-search";

// Types
import type { BrowserTier } from "./types";

const MAX_CONTENT_CHARS = 100_000;

function truncate(content: string): string {
  if (content.length <= MAX_CONTENT_CHARS) return content;
  return content.slice(0, MAX_CONTENT_CHARS) +
    `\n\n... (truncated, ${content.length} total chars)`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension entry
// ═══════════════════════════════════════════════════════════════════════════

export default async function (pi: ExtensionAPI) {

  // Auto-stop smolvm VM on session shutdown
  pi.on("session_shutdown", async () => {
    try { await stopVm(); } catch { /* best-effort */ }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL: WEB_Search (SearXNG metasearch)
  // ═══════════════════════════════════════════════════════════════════════════

  registerWebSearch(pi);

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL: browser_navigate (LIGHT — Obscura)
  // ═══════════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_navigate",
    label: "Browser Navigate",
    description:
      "Navigate to a URL and return the page title + metadata. " +
      "Creates a fresh page context each time. Use browser_fetch for full content.",
    promptSnippet: "Navigate browser to a URL",
    promptGuidelines: [
      "Use browser_navigate to go to a URL and get basic info (title, URL).",
      "For full page content, use browser_fetch instead.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to navigate to" }),
      wait: Type.Optional(
        Type.Boolean({ description: "Wait for page load to complete. Default: true.", default: true })
      ),
    }),

    async execute(_id, params) {
      const { stdout, stderr } = await evalJs(
        params.url,
        "JSON.stringify({title: document.title, url: location.href})",
        { stealth: false }
      );

      if (stderr && !stdout) {
        return { content: [{ type: "text", text: `Error: ${stderr}` }], isError: true };
      }

      return {
        content: [{ type: "text", text: `Navigated to ${params.url}\n\n${stdout}` }],
        details: { url: params.url, tier: "light" as BrowserTier },
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL: browser_fetch (LIGHT — Obscura)
  // ═══════════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_fetch",
    label: "Browser Fetch",
    description:
      "Fetch and render a web page, returning content as HTML, plain text, " +
      "extracted links, or the result of a JavaScript expression. " +
      "Obscura is a headless Rust browser (30MB, V8-based, built-in stealth).",
    promptSnippet: "Fetch a web page and return its content",
    promptGuidelines: [
      "Use browser_fetch when you need to read a web page's content.",
      "mode='text' for quick reading, mode='links' for all URLs, mode='html' for full markup.",
      "mode='eval' runs a JS expression and returns the result.",
      "Use stealth for anti-detection when scraping sites that block bots.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch" }),
      mode: Type.Optional(
        Type.Union(
          [Type.Literal("html"), Type.Literal("text"), Type.Literal("links"), Type.Literal("eval")],
          { description: "Output mode: 'html' | 'text' | 'links' | 'eval'. Default: 'html'." }
        )
      ),
      eval: Type.Optional(Type.String({ description: "JS expression (only with mode='eval')" })),
      wait_until: Type.Optional(
        Type.String({ description: "Wait condition: 'load' | 'domcontentloaded'. Default: 'load'." })
      ),
      stealth: Type.Optional(Type.Boolean({ description: "Enable anti-detection mode. Default: false." })),
      selector: Type.Optional(Type.String({ description: "CSS selector to restrict output" })),
    }),

    async execute(_id, params) {
      const mode = params.mode || "html";
      const opts = {
        waitUntil: params.wait_until,
        stealth: params.stealth,
        selector: params.selector,
      };

      let result;
      if (mode === "text") result = await fetchText(params.url, opts);
      else if (mode === "links") result = await fetchLinks(params.url, opts);
      else if (mode === "eval" && params.eval) result = await evalJs(params.url, params.eval, opts);
      else result = await fetchHtml(params.url, opts);

      if (result.stderr && !result.stdout) {
        return { content: [{ type: "text", text: `Error: ${result.stderr}` }], isError: true };
      }

      return {
        content: [{ type: "text", text: truncate(result.stdout) }],
        details: {
          url: params.url,
          mode,
          contentLength: result.stdout.length,
          truncated: result.stdout.length > MAX_CONTENT_CHARS,
          tier: "light" as BrowserTier,
        },
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL: browser_screenshot (HEAVY — smolvm+Chromium)
  // ═══════════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description:
      "Take a screenshot of a web page using Puppeteer + Chromium inside a smolvm microVM. " +
      "Returns the captured PNG. " +
      "The VM is lazily created on first use and reused for subsequent requests.",
    promptSnippet: "Take a screenshot of a web page",
    promptGuidelines: [
      "Use browser_screenshot to visually verify a page's state.",
      "Pass the URL directly — no need to navigate first.",
      "Screenshots use Puppeteer + Chromium in a hardware-isolated smolvm microVM.",
      "First call may take a few seconds to boot the VM (sub-200ms on subsequent uses).",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to screenshot" }),
      path: Type.Optional(Type.String({ description: "Output path for PNG. Default: /tmp/shot.png" })),
      full_page: Type.Optional(Type.Boolean({ description: "Capture full scrollable page. Default: false." })),
      width: Type.Optional(Type.Number({ description: "Viewport width in pixels. Default: 1280." })),
      height: Type.Optional(Type.Number({ description: "Viewport height in pixels. Default: 800." })),
    }),

    async execute(_id, params, signal) {
      const outputPath = params.path || "/tmp/shot.png";

      const result = await smolvmScreenshot(params.url, outputPath, {
        fullPage: params.full_page,
        width: params.width,
        height: params.height,
      });

      if (result.error) {
        return { content: [{ type: "text", text: `Screenshot failed: ${result.error}` }], isError: true };
      }

      // Read the screenshot file and return as base64 image
      try {
        const imageBuffer = await readFile(outputPath);
        const base64 = imageBuffer.toString("base64");

        return {
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                mediaType: "image/png",
                data: base64,
              },
            },
            {
              type: "text",
              text: `Screenshot saved to ${outputPath} (${(imageBuffer.length / 1024).toFixed(1)} KB)`,
            },
          ],
          details: {
            url: params.url,
            path: outputPath,
            sizeBytes: imageBuffer.length,
            tier: "heavy" as BrowserTier,
          },
        };
      } catch {
        return {
          content: [{ type: "text", text: `Screenshot taken but could not read file at ${outputPath}` }],
          details: { url: params.url, path: outputPath, tier: "heavy" as BrowserTier },
        };
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL: browser_action (DUAL-TIER)
  // ═══════════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_action",
    label: "Browser Action",
    description:
      "Perform actions on a web page. Light actions (js, navigate, screenshot_info) use Obscura. " +
      "Heavy actions (click, fill, hover, wait_for) use Chromium inside a smolvm microVM.",
    promptSnippet: "Run JavaScript or interact with a web page",
    promptGuidelines: [
      "Use action='js' to evaluate JavaScript (Obscura — fast).",
      "Use action='navigate' to get page info (Obscura — fast).",
      "Use action='click' to click an element (smolvm+Chromium — full DOM).",
      "Use action='fill' to fill a form field (smolvm+Chromium — full DOM).",
      "Use action='screenshot_info' to get viewport dimensions (Obscura — fast).",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL of the page to act on" }),
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
      expression: Type.Optional(Type.String({ description: "JavaScript expression (for 'js' action)" })),
      selector: Type.Optional(Type.String({ description: "CSS selector (for 'click', 'fill', 'hover', 'wait_for')" })),
      value: Type.Optional(Type.String({ description: "Value to type (for 'fill' action)" })),
      x: Type.Optional(Type.Number({ description: "X coordinate for click" })),
      y: Type.Optional(Type.Number({ description: "Y coordinate for click" })),
      stealth: Type.Optional(Type.Boolean({ description: "Enable anti-detection. Default: false." })),
    }),

    async execute(_id, params) {
      const tier = classifyTier("browser_action", params);

      // ── Light tier (Obscura) ──────────────────────────────────────────
      if (tier === "light") {
        switch (params.action) {
          case "js": {
            if (!params.expression) {
              return { content: [{ type: "text", text: "expression required for js action" }], isError: true };
            }
            const { stdout, stderr } = await evalJs(params.url, params.expression, { stealth: params.stealth });
            if (stderr && !stdout) {
              return { content: [{ type: "text", text: `Error: ${stderr}` }], isError: true };
            }
            return {
              content: [{ type: "text", text: stdout || "JS executed (no output)." }],
              details: { tier, action: params.action },
            };
          }

          case "navigate": {
            const { stdout, stderr } = await evalJs(
              params.url,
              "JSON.stringify({title: document.title, url: location.href, readyState: document.readyState})",
              { stealth: params.stealth }
            );
            if (stderr && !stdout) {
              return { content: [{ type: "text", text: `Error: ${stderr}` }], isError: true };
            }
            return { content: [{ type: "text", text: stdout }], details: { tier, action: params.action } };
          }

          case "screenshot_info": {
            const { stdout, stderr } = await evalJs(
              params.url,
              `JSON.stringify({
                url: location.href, title: document.title,
                viewport: {w: innerWidth, h: innerHeight},
                page: {w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight},
                scroll: {x: scrollX, y: scrollY}
              })`,
              { stealth: params.stealth }
            );
            if (stderr && !stdout) {
              return { content: [{ type: "text", text: `Error: ${stderr}` }], isError: true };
            }
            return { content: [{ type: "text", text: stdout }], details: { tier, action: params.action } };
          }

          default: {
            return {
              content: [{ type: "text", text: `Unknown light action: ${params.action}` }],
              isError: true,
            };
          }
        }
      }

      // ── Heavy tier (smolvm+Chromium via puppeteer-core CDP) ────────────
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
            : { type: "click_at", x: params.x!, y: params.y! };
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

      const interactResult = await interact(params.url, [interactionAction], { stealth: params.stealth });

      if (!interactResult.success) {
        return { content: [{ type: "text", text: `Action failed: ${interactResult.error}` }], isError: true };
      }

      return {
        content: [{ type: "text", text: truncate(interactResult.html || "Action completed (no HTML returned).") }],
        details: { tier, action: params.action, selector: params.selector },
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL: browser_scrape (LIGHT — Obscura, parallelized)
  // ═══════════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_scrape",
    label: "Browser Scrape",
    description:
      "Scrape multiple URLs in parallel using Obscura fetch (batched by concurrency). " +
      "Returns results as JSON or plain text. Ideal for bulk content extraction.",
    promptSnippet: "Scrape multiple URLs in parallel",
    parameters: Type.Object({
      urls: Type.Array(Type.String(), { description: "List of URLs to scrape", minItems: 1 }),
      eval: Type.Optional(Type.String({ description: "JavaScript expression to evaluate on each page" })),
      concurrency: Type.Optional(Type.Number({ description: "Parallel workers. Default: 10.", default: 10 })),
      format: Type.Optional(
        Type.Union(
          [Type.Literal("json"), Type.Literal("text")],
          { description: "Output format: 'json' | 'text'. Default: 'json'." }
        )
      ),
    }),

    async execute(_id, params) {
      const concurrency = params.concurrency || 10;
      const results: Array<{ url: string; content: string; error?: string }> = [];

      for (let i = 0; i < params.urls.length; i += concurrency) {
        const batch = params.urls.slice(i, i + concurrency);
        const promises = batch.map(async (url: string) => {
          const dumpMode = params.format === "text" ? "text" : "html";
          const args = ["fetch", url, "--dump", dumpMode, "--quiet"];
          if (params.eval) args.push("--eval", params.eval);
          const { stdout, stderr } = await obscuraExec(args, 15_000);
          return { url, content: stdout, error: stderr && !stdout ? stderr : undefined };
        });
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
      }

      const output = params.format === "text"
        ? results.map((r) => `--- ${r.url} ---\n${r.error || r.content}`).join("\n\n")
        : JSON.stringify(results, null, 2);

      const errorCount = results.filter((r) => r.error).length;

      return {
        content: [{ type: "text", text: `Scraped ${params.urls.length} URLs (${errorCount} errors).\n\n${output}` }],
        details: { urlCount: params.urls.length, concurrency, errorCount, tier: "light" as BrowserTier },
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL: browser_vm_status — Check VM state (replaces browser_obscura_serve)
  // ═══════════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "browser_vm_status",
    label: "Browser VM Status",
    description:
      "Check the status of the browser infrastructure. Reports Obscura (light tier) " +
      "and smolvm+Chromium (heavy tier) availability. " +
      "Pass action='start' to pre-warm the heavy-tier VM.",
    promptSnippet: "Check browser infrastructure status or pre-warm heavy tier",
    promptGuidelines: [
      "Use action='status' to check what's available (default).",
      "Use action='start' to pre-warm the smolvm VM before heavy operations.",
      "The heavy-tier VM boots in <200ms after first creation.",
    ],
    parameters: Type.Object({
      action: Type.Optional(Type.String({ description: "Action: 'status' | 'start'. Default: 'status'." })),
    }),

    async execute(_id, params) {
      const obscuraOk = isObscuraInstalled();
      const smolvmOk = isSmolvmInstalled();

      if (params.action === "start") {
        if (!smolvmOk) {
          return {
            content: [{
              type: "text",
              text: "smolvm not installed. Install: curl -sSL https://smolmachines.com/install.sh | bash",
            }],
            isError: true,
          };
        }

        const ensure = await ensureVm();
        return {
          content: [{
            type: "text",
            text: ensure.running
              ? "Heavy-tier VM (pi-browser-heavy) is running and ready for screenshots, clicks, and form fills."
              : `Failed to start VM: ${ensure.error}`,
          }],
          details: { action: "start", vmRunning: ensure.running },
        };
      }

      // Status check
      const vmState = smolvmOk ? await getVmStatus() : "not-installed" as const;

      return {
        content: [{
          type: "text",
          text:
            `═══ Browser Infrastructure Status ═══\n\n` +
            `🔍 Light Tier (Obscura)\n` +
            `   Installed: ${obscuraOk ? "✅ " + OBSCURA_PATH() : "❌"}\n` +
            `   Use for: fetch, navigate, scrape, eval, links, text\n\n` +
            `🖥️  Heavy Tier (smolvm + Chromium)\n` +
            `   smolvm installed: ${smolvmOk ? "✅" : "❌"}\n` +
            `   VM state: ${vmState}\n` +
            `   Use for: screenshots, clicks, form fills, CDP automation\n\n` +
            `💡 Tip: Call with action='start' to pre-warm the heavy tier.`,
        }],
        details: {
          obscuraInstalled: obscuraOk,
          smolvmInstalled: smolvmOk,
          vmState,
        },
      };
    },
  });
}
