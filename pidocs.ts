// pidocs.ts — PiDocs tool registration + before_agent_start hook

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolveLookup, resolveInstall } from "./pidocs-core";

// ─── Install intent detection patterns ────────────────────────────────────────

const INSTALL_PATTERNS: RegExp[] = [
  /\binstall\b/,
  /\bsetup\b/,
  /\bhow\s+to\s+(install|use|setup)\b/,
  /\bnpm\s+install\b/,
  /\bpip\s+install\b/,
  /\bbrew\s+install\b/,
  /\bapt(-get)?\s+install\b/,
  /\bcargo\s+add\b/,
  /\byarn\s+add\b/,
  /\bpacman\s+-S\b/,
  /\bdnf\s+install\b/,
  /\bchoco\s+install\b/,
  /\bdocker\s+pull\b/,
  /\bgo\s+get\b/,
  /\bflatpak\s+install\b/,
  /\bsnap\s+install\b/,
];

const PACKAGE_PATTERNS: RegExp[] = [
  /@[\w-]+\/[\w.-]+/,                       // @scope/package (npm scoped)
  /[a-zA-Z][\w-]*\/[a-zA-Z][\w.-]+/,        // owner/repo (GitHub-style)
  /ms-[\w.]+\.[\w.]+/,                       // VS Code extensions
  /github\.com\/[\w-]+\/[\w.-]+/,            // GitHub URLs
];

const INSTALL_CONTEXT_WORDS: RegExp = /\b(install|setup|use|run|add|get)\b/;

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerPidocs(pi: ExtensionAPI) {
  // ═════════════════════════════════════════════════════════════════════════
  // TOOL: pidocs_lookup
  // ═════════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "pidocs_lookup",
    label: "PiDocs Lookup",
    description:
      "Find documentation URLs and description for a package or application. " +
      "Uses built-in registry resolvers first (npm, GitHub, PyPI, Cargo, Homebrew, " +
      "Docker Hub, VS Code Marketplace, Go packages, AUR, Flatpak, Snap), then falls " +
      "back to SearXNG web search if no resolver matches.",
    promptSnippet: "Look up documentation URLs for a package or app",
    promptGuidelines: [
      "Use pidocs_lookup to find documentation URLs for packages, libraries, and applications.",
      "Provide a name (e.g., 'lodash', '@types/node', 'octocat/Hello-World') and optional type hint.",
      "When the type is ambiguous, specify the type (npm, github, pip, etc.) for faster resolution.",
    ],
    parameters: Type.Object({
      name: Type.String({
        description:
          "Package or application name. Examples: 'lodash', '@types/node', " +
          "'octocat/Hello-World', 'ffmpeg'.",
      }),
      type: Type.Optional(
        Type.String({
          description:
            "Registry type hint: 'npm' | 'github' | 'pip' | 'cargo' | 'brew' | " +
            "'docker' | 'vscode' | 'go' | 'aur' | 'flatpak' | 'snap'. " +
            "Skip to auto-detect.",
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const result = await resolveLookup(params.name, {
          typeHint: params.type,
        });

        // Format the output for the LLM
        const lines: string[] = [];
        lines.push(`PiDocs lookup: ${result.name}`);
        lines.push(`Resolver: ${result.resolver}`);
        lines.push(`Type: ${result.type}`);
        if (result.description) {
          lines.push(`Description: ${result.description}`);
        }
        lines.push(``);
        lines.push(`Documentation URLs:`);
        for (const url of result.urls) {
          lines.push(`  - ${url}`);
        }
        if (result.urls.length === 0) {
          lines.push(`  (No URLs found)`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `PiDocs lookup failed for "${params.name}": ${message}` }],
          details: { name: params.name, error: message },
          isError: true,
        };
      }
    },
  });

  // ═════════════════════════════════════════════════════════════════════════
  // TOOL: pidocs_install
  // ═════════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "pidocs_install",
    label: "PiDocs Install",
    description:
      "Find installation commands for a package or application, organized by platform. " +
      "Uses built-in resolvers to find documentation URLs, then fetches and extracts " +
      "install commands from those pages. Falls back to SearXNG search for unknown packages.",
    promptSnippet: "Get install commands for a package or app, organized by platform",
    promptGuidelines: [
      "Use pidocs_install before installing packages to get the correct commands and prerequisites.",
      "Specify a platform ('linux', 'mac', 'windows', or 'all') to filter results.",
      "For ambiguous package names, provide a type hint (npm, pip, brew, etc.).",
    ],
    parameters: Type.Object({
      name: Type.String({
        description:
          "Package or application name. Examples: 'lodash', 'ffmpeg', 'nginx', '@types/node'.",
      }),
      type: Type.Optional(
        Type.String({
          description:
            "Registry type hint. Same values as pidocs_lookup.",
        })
      ),
      platform: Type.Optional(
        Type.String({
          description:
            "Platform filter: 'linux' | 'mac' | 'windows' | 'all'. " +
            "'all' returns commands for all platforms (individual commands are still tagged by platform). " +
            "Default: all platforms.",
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const result = await resolveInstall(params.name, {
          typeHint: params.type,
          platform: params.platform,
        });

        // Format the output for the LLM
        const lines: string[] = [];
        lines.push(`PiDocs install: ${result.name}`);
        lines.push(`Resolver: ${result.resolver}`);
        lines.push(`Type: ${result.type}`);
        if (result.description) {
          lines.push(`Description: ${result.description}`);
        }
        lines.push(`Source: ${result.sourceUrl || "N/A"}`);
        lines.push(``);

        if (result.installCommands.length === 0) {
          lines.push(`No install commands extracted. Try using pidocs_lookup to find documentation.`);
        } else {
          lines.push(`Install commands:`);
          for (const cmd of result.installCommands) {
            const platformLabel = cmd.platform === "cross-platform" ? "Any" : cmd.platform;
            lines.push(`  [${platformLabel}/${cmd.manager}] ${cmd.command}`);
            if (cmd.notes) {
              lines.push(`    Note: ${cmd.notes}`);
            }
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `PiDocs install failed for "${params.name}": ${message}` }],
          details: { name: params.name, error: message },
          isError: true,
        };
      }
    },
  });

  // ═════════════════════════════════════════════════════════════════════════
  // EVENT: before_agent_start — conditional prompt injection
  // ═════════════════════════════════════════════════════════════════════════

  pi.on("before_agent_start", async (event) => {
    const prompt = event.prompt.toLowerCase();

    const hasInstallIntent = INSTALL_PATTERNS.some((p) => p.test(prompt));
    const hasPackageRef = PACKAGE_PATTERNS.some((p) => p.test(prompt));
    const hasInstallContext = INSTALL_CONTEXT_WORDS.test(prompt);

    // Package ref alone is NOT enough — must also have install context
    // to avoid false-triggering on paths, dates, or random slash-separated text.
    // Exception: explicit package managers (npm install, pip install, etc.)
    // are already caught by INSTALL_PATTERNS.
    const shouldInject = hasInstallIntent || (hasPackageRef && hasInstallContext);

    if (shouldInject) {
      return {
        systemPrompt:
          event.systemPrompt +
          "\n\nBefore installing packages or apps, call pidocs_install to get the correct " +
          "install commands and check for prerequisites. For documentation URLs, call pidocs_lookup.",
      };
    }
  });
}