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

    it("auto-detects scoped npm package type", async () => {
      const result = await resolveLookup("@types/node");
      expect(result.resolver).toBe("npm");
      expect(result.type).toBe("npm");
    });

    it("falls back to SearXNG when no built-in resolver matches", async () => {
      mockSearchSearXNG.mockResolvedValue({
        results: [
          {
            title: "VLC: Official download",
            url: "https://www.videolan.org/vlc/",
            snippet: "Download VLC media player for Windows, Mac, Linux",
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

    it("passes correct search query to SearXNG", async () => {
      mockSearchSearXNG.mockResolvedValue({
        results: [],
        totalResults: 0,
        query: "install SomeWeirdApp",
      });

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

      await resolveLookup("SomeWeirdApp", { configOverride: disabledConfig });
      expect(mockSearchSearXNG).toHaveBeenCalledWith(
        "install SomeWeirdApp",
        expect.objectContaining({ categories: "it", maxResults: 5 })
      );
    });

    it("returns description from SearXNG snippets", async () => {
      mockSearchSearXNG.mockResolvedValue({
        results: [
          {
            title: "VLC",
            url: "https://www.videolan.org/vlc/",
            snippet: "VLC is a free and open source cross-platform multimedia player",
            engines: ["google"],
          },
        ],
        totalResults: 1,
        query: "install VLC-media-player-xyz",
      });

      const disabledConfig = {
        resolvers: {
          npm: { enabled: false }, github: { enabled: false }, pip: { enabled: false },
          cargo: { enabled: false }, brew: { enabled: false }, docker: { enabled: false },
          vscode: { enabled: false }, go: { enabled: false }, aur: { enabled: false },
          flatpak: { enabled: false }, snap: { enabled: false }, custom: [],
        },
      };

      const result = await resolveLookup("VLC-media-player-xyz", { configOverride: disabledConfig });
      expect(result.description).toContain("VLC is a free and open source");
    });

    it("returns error info when SearXNG fails and no resolver matches", async () => {
      mockSearchSearXNG.mockRejectedValue(new Error("SearXNG unavailable"));

      const disabledConfig = {
        resolvers: {
          npm: { enabled: false }, github: { enabled: false }, pip: { enabled: false },
          cargo: { enabled: false }, brew: { enabled: false }, docker: { enabled: false },
          vscode: { enabled: false }, go: { enabled: false }, aur: { enabled: false },
          flatpak: { enabled: false }, snap: { enabled: false }, custom: [],
        },
      };

      const result = await resolveLookup("123badname", { configOverride: disabledConfig });
      expect(result.resolver).toBe("searxng");
      expect(result.description).toContain("Search failed");
    });
  });

  // ── resolveInstall ──
  describe("resolveInstall", () => {
    it("resolves install commands for npm package", async () => {
      mockFetchText.mockResolvedValue({
        stdout: "# Install\n\n```bash\nnpm install lodash\n```",
        stderr: "",
      });

      const result = await resolveInstall("lodash", { typeHint: "npm" });
      expect(result.resolver).toBe("npm");
      expect(result.sourceUrl).toContain("npmjs.com");
      expect(result.name).toBe("lodash");
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
      expect(result.installCommands.length).toBeGreaterThanOrEqual(1);
      expect(result.installCommands[0].command).toContain("npm install lodash");
    });

    it("generates brew fallback when fetch fails", async () => {
      mockFetchText.mockResolvedValue({
        stdout: "",
        stderr: "Error fetching page",
      });

      const result = await resolveInstall("ffmpeg", { typeHint: "brew" });
      expect(result.installCommands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ manager: "brew", command: "brew install ffmpeg" }),
        ])
      );
    });

    it("generates docker fallback when fetch fails", async () => {
      mockFetchText.mockResolvedValue({
        stdout: "",
        stderr: "Error fetching page",
      });

      const result = await resolveInstall("nginx", { typeHint: "docker" });
      expect(result.installCommands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ manager: "docker", command: "docker pull nginx" }),
        ])
      );
    });

    it("filters install commands by platform", async () => {
      mockFetchText.mockResolvedValue({
        stdout: `
          ## Installation
          Linux: \`sudo apt install nginx\`
          macOS: \`brew install nginx\`
          Windows: \`choco install nginx\`
          Cross-platform: \`docker pull nginx\`
        `,
        stderr: "",
      });

      // Linux only
      const linuxResult = await resolveInstall("nginx", { typeHint: "apt", platform: "linux" });
      const linuxManagers = linuxResult.installCommands.map((c) => c.manager);
      expect(linuxManagers.every((m) => m === "apt" || m === "docker")).toBe(true);

      // Mac only
      const macResult = await resolveInstall("nginx", { typeHint: "brew", platform: "mac" });
      const macManagers = macResult.installCommands.map((c) => c.manager);
      expect(macManagers.every((m) => m === "brew" || m === "docker")).toBe(true);
    });

    it("returns all commands when platform is 'all' or undefined", async () => {
      mockFetchText.mockResolvedValue({
        stdout: `
          \`\`\`bash
          npm install lodash
          \`\`\`
          \`\`\`bash
          brew install lodash
          \`\`\`
        `,
        stderr: "",
      });

      const result = await resolveInstall("lodash-mc", { typeHint: "npm" });
      // Should not filter — all commands returned
      expect(result.installCommands.length).toBeGreaterThanOrEqual(1);
    });

    it("falls back to SearXNG when no resolver matches and returns commands", async () => {
      mockSearchSearXNG.mockResolvedValue({
        results: [
          {
            title: "VLC Download",
            url: "https://www.videolan.org/vlc/",
            snippet: "Download VLC media player",
            engines: ["google"],
          },
        ],
        totalResults: 1,
        query: "how to install VLC-media-player-xyz",
      });

      mockFetchText.mockResolvedValue({
        stdout: "## Install\n\n```bash\nsudo apt install vlc\n```",
        stderr: "",
      });

      const disabledConfig = {
        resolvers: {
          npm: { enabled: false }, github: { enabled: false }, pip: { enabled: false },
          cargo: { enabled: false }, brew: { enabled: false }, docker: { enabled: false },
          vscode: { enabled: false }, go: { enabled: false }, aur: { enabled: false },
          flatpak: { enabled: false }, snap: { enabled: false }, custom: [],
        },
      };

      const result = await resolveInstall("VLC-media-player-xyz", { configOverride: disabledConfig });
      expect(result.resolver).toBe("searxng");
      expect(result.sourceUrl).toBe("https://www.videolan.org/vlc/");
      expect(mockSearchSearXNG).toHaveBeenCalledWith(
        "how to install VLC-media-player-xyz",
        expect.objectContaining({ categories: "it", maxResults: 3 })
      );
    });
  });
});