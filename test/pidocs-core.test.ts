// test/pidocs-core.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveLookup,
  resolveInstall,
  type PidocsLookupResult,
  type PidocsInstallResult,
} from "../pidocs-core";

// Mock the dependencies
vi.mock("../web-search-core", () => ({
  searchSearXNG: vi.fn(),
  DEFAULT_MAX_RESULTS: 10,
}));

vi.mock("../obscura", () => ({
  fetchText: vi.fn(),
}));

vi.mock("../smolvm", () => ({
  ensureSearchVm: vi.fn().mockResolvedValue({ running: true, url: "http://localhost:8888" }),
  isSmolvmInstalled: vi.fn().mockReturnValue(true),
  SEARXNG_LOCAL_URL: "http://localhost:8888",
}));

import { searchSearXNG } from "../web-search-core";
import { fetchText } from "../obscura";
import { invalidateConfigCache } from "../pidocs-core";

const mockSearchSearXNG = vi.mocked(searchSearXNG);
const mockFetchText = vi.mocked(fetchText);

describe("pidocs-core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateConfigCache();
  });

  // ── resolveLookup ──
  describe("resolveLookup", () => {
    it("resolves npm package via built-in resolver", async () => {
      const result = await resolveLookup("lodash", { typeHint: "npm" });
      expect(result.resolver).toBe("npm");
      expect(result.urls).toContain("https://www.npmjs.com/package/lodash");
      expect(result.name).toBe("lodash");
      expect(result.type).toBe("npm");
    });

    it("resolves GitHub repo via built-in resolver", async () => {
      const result = await resolveLookup("octocat/Hello-World", { typeHint: "github" });
      expect(result.resolver).toBe("github");
      expect(result.urls).toContain("https://github.com/octocat/Hello-World");
    });

    it("falls back to SearXNG when no built-in resolver matches", async () => {
      mockSearchSearXNG.mockResolvedValue({
        results: [
          {
            title: "VLC: Official download",
            url: "https://www.videolan.org/vlc/",
            snippet: "Download VLC media player",
            engines: ["google"],
          },
        ],
        totalResults: 1,
        query: "install VLC-media-player-xyz",
      });

      // Disable all resolvers to force SearXNG fallback
      const disabledConfig = {
        resolvers: {
          npm: { enabled: false },
          github: { enabled: false },
          pip: { enabled: false },
          cargo: { enabled: false },
          brew: { enabled: false },
          docker: { enabled: false },
          vscode: { enabled: false },
          go: { enabled: false },
          aur: { enabled: false },
          flatpak: { enabled: false },
          snap: { enabled: false },
          custom: [],
        },
      };

      const result = await resolveLookup("VLC-media-player-xyz", { configOverride: disabledConfig });
      expect(result.resolver).toBe("searxng");
      expect(result.urls).toContain("https://www.videolan.org/vlc/");
      expect(mockSearchSearXNG).toHaveBeenCalled();
    });

    it("auto-detects scoped npm package type", async () => {
      const result = await resolveLookup("@types/node");
      expect(result.resolver).toBe("npm");
      expect(result.type).toBe("npm");
    });

    it("returns error info when SearXNG fails and no resolver matches", async () => {
      mockSearchSearXNG.mockRejectedValue(new Error("SearXNG unavailable"));

      // Disable all resolvers to force SearXNG fallback
      const disabledConfig = {
        resolvers: {
          npm: { enabled: false },
          github: { enabled: false },
          pip: { enabled: false },
          cargo: { enabled: false },
          brew: { enabled: false },
          docker: { enabled: false },
          vscode: { enabled: false },
          go: { enabled: false },
          aur: { enabled: false },
          flatpak: { enabled: false },
          snap: { enabled: false },
          custom: [],
        },
      };

      const result = await resolveLookup("totally-unknown-xyz-123", { configOverride: disabledConfig });
      expect(result.resolver).toBe("searxng");
      expect(result.description).toContain("Search failed");
    });
  });

  // ── resolveInstall ──
  describe("resolveInstall", () => {
    it("resolves install commands for npm package", async () => {
      // Mock fetchText to return a page with install instructions
      mockFetchText.mockResolvedValue({
        stdout: "# Install\n\n```bash\nnpm install lodash\n```",
        stderr: "",
      });

      const result = await resolveInstall("lodash", { typeHint: "npm" });
      expect(result.resolver).toBe("npm");
      expect(result.sourceUrl).toContain("npmjs.com");
    });

    it("returns source URL even when fetch fails", async () => {
      mockFetchText.mockResolvedValue({
        stdout: "",
        stderr: "Obscura not installed",
      });

      const result = await resolveInstall("react", { typeHint: "npm" });
      expect(result.resolver).toBe("npm");
      expect(result.sourceUrl).toContain("npmjs.com");
    });

    it("extracts install commands from page content", async () => {
      mockFetchText.mockResolvedValue({
        stdout: "## Installation\n\n```bash\npip install flask\n```\n\nOr with pip3:\n\n```bash\npip3 install flask\n```",
        stderr: "",
      });

      const result = await resolveInstall("flask", { typeHint: "pip" });
      expect(result.resolver).toBe("pip");
      expect(result.installCommands.length).toBeGreaterThanOrEqual(1);
    });

    it("uses fallback commands when fetch fails", async () => {
      mockFetchText.mockResolvedValue({
        stdout: "",
        stderr: "Error fetching page",
      });

      const result = await resolveInstall("lodash", { typeHint: "npm" });
      expect(result.resolver).toBe("npm");
      // Should have the fallback npm install command
      expect(result.installCommands.length).toBeGreaterThanOrEqual(1);
      expect(result.installCommands[0].command).toContain("npm install lodash");
    });
  });
});