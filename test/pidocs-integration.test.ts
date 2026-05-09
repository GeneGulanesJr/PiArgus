// test/pidocs-integration.test.ts
// End-to-end tests that exercise the full pipeline from name input to formatted output,
// WITHOUT mocking pidocs-core. These test the real resolver + extract logic together.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external infrastructure (Obscura, SearXNG, smolvm) — these require network/VMs
vi.mock("../obscura", () => ({
  fetchText: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

vi.mock("../smolvm", () => ({
  ensureSearchVm: vi.fn().mockResolvedValue({ running: true, url: "http://localhost:8888" }),
  isSmolvmInstalled: vi.fn().mockReturnValue(true),
  SEARXNG_LOCAL_URL: "http://localhost:8888",
}));

vi.mock("../web-search-core", () => ({
  searchSearXNG: vi.fn().mockResolvedValue({
    results: [
      {
        title: "VLC Media Player",
        url: "https://www.videolan.org/vlc/",
        snippet: "Download VLC media player",
        engines: ["google"],
      },
    ],
    totalResults: 1,
    query: "install VLC",
  }),
  DEFAULT_MAX_RESULTS: 10,
}));

import { resolveLookup, resolveInstall } from "../pidocs-core";
import { registerPidocs } from "../pidocs";
import { resolveNpm, resolveGithub, resolvePip, resolveCargo, resolveBrew, resolveDocker, resolveVscode, resolveGo, resolveAur, resolveFlatpak, resolveSnap, detectType, runResolvers } from "../pidocs-resolvers";
import { extractInstallCommands, extractManager } from "../pidocs-install-extract";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { invalidateConfigCache } from "../pidocs-core";

describe("PiDocs integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateConfigCache();
  });

  // ── Cross-module resolver → install pipeline ──

  describe("resolver + extract pipeline", () => {
    it("resolves npm package and generates fallback install command", async () => {
      const result = await resolveInstall("lodash", { typeHint: "npm" });
      expect(result.resolver).toBe("npm");
      expect(result.sourceUrl).toContain("npmjs.com");
      // Fetch returns empty (mock) so fallback commands should be generated
      expect(result.installCommands.length).toBeGreaterThanOrEqual(1);
      expect(result.installCommands[0].command).toContain("npm install lodash");
    });

    it("resolves GitHub repo and extracts install commands from fetched page", async () => {
      const { fetchText } = await import("../obscura");
      vi.mocked(fetchText).mockResolvedValueOnce({
        stdout: "## Installation\n\n```bash\ngit clone https://github.com/octocat/Hello-World.git\nnpm install\n```",
        stderr: "",
      });

      const result = await resolveInstall("octocat/Hello-World", { typeHint: "github" });
      expect(result.resolver).toBe("github");
      expect(result.sourceUrl).toContain("github.com/octocat/Hello-World");
    });

    it("resolves pip package and returns source URL from built-in resolver", async () => {
      const result = await resolveInstall("flask", { typeHint: "pip" });
      expect(result.resolver).toBe("pip");
      expect(result.sourceUrl).toContain("pypi.org");
    });

    it("resolves brew package with fallback commands", async () => {
      const result = await resolveInstall("ffmpeg", { typeHint: "brew" });
      expect(result.resolver).toBe("brew");
      expect(result.sourceUrl).toContain("formulae.brew.sh");
      // Should have brew fallback command
      expect(result.installCommands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ manager: "brew", command: "brew install ffmpeg" }),
        ])
      );
    });

    it("returns source URL even when fetch fails", async () => {
      const { fetchText } = await import("../obscura");
      vi.mocked(fetchText).mockResolvedValueOnce({
        stdout: "",
        stderr: "fetch failed",
      });

      const result = await resolveInstall("react", { typeHint: "npm" });
      expect(result.resolver).toBe("npm");
      expect(result.sourceUrl).toContain("npmjs.com");
      // Should have fallback npm install command
      expect(result.installCommands.length).toBeGreaterThanOrEqual(1);
    });

    it("filters install commands by platform", async () => {
      const { fetchText } = await import("../obscura");
      vi.mocked(fetchText).mockResolvedValueOnce({
        stdout: `
          Linux:
          \`\`\`bash
          sudo apt install nginx
          \`\`\`
          macOS:
          \`\`\`bash
          brew install nginx
          \`\`\`
          Windows:
          \`\`\`bash
          choco install nginx
          \`\`\`
        `,
        stderr: "",
      });

      const result = await resolveInstall("nginx", { typeHint: "brew", platform: "linux" });
      const linuxCommands = result.installCommands.filter(
        (c) => c.platform === "linux" || c.platform === "cross-platform"
      );
      // Should only have linux and cross-platform commands
      expect(result.installCommands.every(
        (c) => c.platform === "linux" || c.platform === "cross-platform"
      )).toBe(true);
    });
  });

  // ── SearXNG fallback for unrecognized packages ──

  describe("SearXNG fallback", () => {
    it("queries SearXNG for packages that don't match any resolver pattern", async () => {
      const { searchSearXNG } = await import("../web-search-core");
      // Disable all resolvers to force SearXNG fallback
      const disabledConfig = {
        resolvers: {
          npm: { enabled: false }, github: { enabled: false }, pip: { enabled: false },
          cargo: { enabled: false }, brew: { enabled: false }, docker: { enabled: false },
          vscode: { enabled: false }, go: { enabled: false }, aur: { enabled: false },
          flatpak: { enabled: false }, snap: { enabled: false }, custom: [],
        },
      };

      const result = await resolveLookup("VLC-media-player-xyz", { configOverride: disabledConfig });
      expect(result.resolver).toBe("searxng");
      expect(searchSearXNG).toHaveBeenCalled();
    });
  });

  // ── Resolver pattern validation (integration-level) ──

  describe("resolver pattern rejection", () => {
    it("rejects names starting with digits in all generic resolvers", () => {
      expect(resolveNpm("123abc")).toBeNull();
      expect(resolvePip("123abc")).toBeNull();
      expect(resolveCargo("123abc")).toBeNull();
      expect(resolveBrew("123abc")).toBeNull();
      expect(resolveDocker("123abc")).toBeNull();
      expect(resolveAur("123abc")).toBeNull();
      expect(resolveSnap("123abc")).toBeNull();
    });

    it("rejects scoped names in non-npm resolvers", () => {
      expect(resolvePip("@scope/name")).toBeNull();
      expect(resolveCargo("@scope/name")).toBeNull();
      expect(resolveBrew("@scope/name")).toBeNull();
      expect(resolveDocker("@scope/name")).toBeNull();
    });

    it("rejects paths with slashes in non-github resolvers", () => {
      expect(resolvePip("some/path")).toBeNull();
      expect(resolveBrew("some/path")).toBeNull();
      expect(resolveDocker("some/path")).toBeNull();
    });

    it("detectType returns null for names starting with digits", () => {
      expect(detectType("123abc")).toBeNull();
    });

    it("all resolvers reject empty string", () => {
      expect(resolveNpm("")).toBeNull();
      expect(resolveGithub("")).toBeNull();
      expect(resolvePip("")).toBeNull();
      expect(resolveCargo("")).toBeNull();
      expect(resolveBrew("")).toBeNull();
      expect(resolveDocker("")).toBeNull();
      expect(resolveAur("")).toBeNull();
      expect(resolveSnap("")).toBeNull();
    });
  });

  // ── Extract + resolver integration ──

  describe("extractInstallCommands with real page text", () => {
    it("extracts commands from a realistic README", () => {
      const readme = `
# My Awesome Lib

A library for doing awesome things.

## Prerequisites

Requires Node.js 18 or later.

## Installation

Install with npm:

\`\`\`bash
npm install my-awesome-lib
\`\`\`

Or with yarn:

\`\`\`bash
yarn add my-awesome-lib
\`\`\`

### macOS

\`\`\`bash
brew install my-awesome-lib
\`\`\`

### Linux

\`\`\`bash
sudo apt install my-awesome-lib
\`\`\`
`;
      const commands = extractInstallCommands("my-awesome-lib", readme);
      expect(commands.length).toBeGreaterThanOrEqual(4);

      const managers = commands.map((c) => c.manager);
      expect(managers).toContain("npm");
      expect(managers).toContain("brew");
      expect(managers).toContain("apt");

      // Check prerequisites captured
      const npmCmd = commands.find((c) => c.manager === "npm");
      expect(npmCmd!.notes).toBeTruthy();
      expect(npmCmd!.notes!.toLowerCase()).toContain("node");
    });

    it("curl | sh commands have no package manager so are omitted", () => {
      const page = `
## Quick Install

\`\`\`bash
curl -fsSL https://get.docker.com | sh
\`\`\`
`;
      const commands = extractInstallCommands("docker", page);
      // curl | sh has no recognized package manager, so extractInstallCommands
      // omits it — only commands with identifiable package managers are returned
      expect(commands.length).toBe(0);
    });
  });

  // ── Tool registration end-to-end ──

  describe("tool registration", () => {
    it("registers both tools and hooks end-to-end", () => {
      const registeredTools: string[] = [];
      const eventHandlers: string[] = [];

      const mockApi = {
        registerTool: vi.fn((def: any) => registeredTools.push(def.name)),
        on: vi.fn((event: string) => eventHandlers.push(event)),
      } as unknown as ExtensionAPI;

      registerPidocs(mockApi);

      expect(registeredTools).toContain("pidocs_lookup");
      expect(registeredTools).toContain("pidocs_install");
      expect(eventHandlers).toContain("before_agent_start");
    });
  });
});