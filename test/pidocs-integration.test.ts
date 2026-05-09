// test/pidocs-integration.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies
vi.mock("../obscura", () => ({
  OBSCURA_PATH: () => "/usr/local/bin/obscura",
  isInstalled: () => true,
  fetchText: vi.fn().mockResolvedValue({ stdout: "mock page text", stderr: "" }),
  fetchHtml: vi.fn().mockResolvedValue({ stdout: "<html>", stderr: "" }),
  fetchLinks: vi.fn().mockResolvedValue({ stdout: "links", stderr: "" }),
  evalJs: vi.fn().mockResolvedValue({ stdout: "result", stderr: "" }),
  execAsync: vi.fn().mockResolvedValue({ stdout: "ok", stderr: "" }),
}));

vi.mock("../smolvm", () => ({
  isSmolvmInstalled: () => true,
  ensureSearchVm: vi.fn().mockResolvedValue({ running: true, url: "http://localhost:8888" }),
  stopVm: vi.fn(),
  stopSearchVm: vi.fn(),
  getSearchVmStatus: vi.fn().mockResolvedValue("running"),
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

vi.mock("../web-search", () => ({
  registerWebSearch: vi.fn(),
  registerWebResearch: vi.fn(),
}));

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerPidocs } from "../pidocs";
import { resolveLookup, resolveInstall } from "../pidocs-core";

describe("PiDocs integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("full lookup pipeline: npm package resolves via built-in resolver", async () => {
    const result = await resolveLookup("lodash", { typeHint: "npm" });
    expect(result.name).toBe("lodash");
    expect(result.resolver).toBe("npm");
    expect(result.urls[0]).toContain("npmjs.com");
  });

  it("full lookup pipeline: GitHub repo resolves via built-in resolver", async () => {
    const result = await resolveLookup("octocat/Hello-World");
    expect(result.resolver).toBe("github");
    expect(result.urls[0]).toContain("github.com/octocat/Hello-World");
  });

  it("full install pipeline: scoped npm package gets fallback commands", async () => {
    const result = await resolveInstall("@types/node", { typeHint: "npm" });
    expect(result.name).toBe("@types/node");
    expect(result.resolver).toBe("npm");
    // Should have fallback npm install command
    expect(result.installCommands.length).toBeGreaterThanOrEqual(1);
    expect(result.installCommands[0].command).toContain("npm install @types/node");
  });

  it("full lookup pipeline: pip resolves to PyPI", async () => {
    const result = await resolveLookup("flask", { typeHint: "pip" });
    expect(result.resolver).toBe("pip");
    expect(result.urls[0]).toContain("pypi.org");
  });

  it("full lookup pipeline: brew resolves with both formula and cask URLs", async () => {
    const result = await resolveLookup("ffmpeg", { typeHint: "brew" });
    expect(result.resolver).toBe("brew");
    expect(result.urls).toContain("https://formulae.brew.sh/formula/ffmpeg");
    expect(result.urls).toContain("https://formulae.brew.sh/cask/ffmpeg");
  });

  it("full install pipeline: source URL is set even with fetch failure", async () => {
    const { fetchText } = await import("../obscura");
    vi.mocked(fetchText).mockResolvedValueOnce({
      stdout: "",
      stderr: "fetch failed",
    });

    const result = await resolveInstall("react", { typeHint: "npm" });
    expect(result.resolver).toBe("npm");
    expect(result.sourceUrl).toContain("npmjs.com");
  });

  it("registerPidocs registers both tools and hook", () => {
    const registeredTools: string[] = [];
    const registeredEvents: string[] = [];

    const mockApi = {
      registerTool: vi.fn((def: any) => registeredTools.push(def.name)),
      on: vi.fn((event: string) => registeredEvents.push(event)),
    } as unknown as ExtensionAPI;

    registerPidocs(mockApi);

    expect(registeredTools).toContain("pidocs_lookup");
    expect(registeredTools).toContain("pidocs_install");
    expect(registeredEvents).toContain("before_agent_start");
  });

  it("before_agent_start hook detects install intent", async () => {
    const registeredEvents: Record<string, Function> = {};
    const mockApi = {
      registerTool: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        registeredEvents[event] = handler;
      }),
    } as unknown as ExtensionAPI;

    registerPidocs(mockApi);

    const handler = registeredEvents["before_agent_start"];

    // Should inject for install intent
    const result = await handler(
      { prompt: "How do I install ffmpeg on ubuntu?", systemPrompt: "You are helpful." },
      {}
    );
    expect(result.systemPrompt).toContain("pidocs_install");

    // Should NOT inject for casual conversation
    const noResult = await handler(
      { prompt: "What is the weather today?", systemPrompt: "You are helpful." },
      {}
    );
    expect(noResult).toBeUndefined();
  });

  it("auto-detects type for scoped npm packages", async () => {
    const result = await resolveLookup("@types/node");
    expect(result.resolver).toBe("npm");
    expect(result.type).toBe("npm");
  });

  it("auto-detects type for GitHub repos", async () => {
    const result = await resolveLookup("octocat/Hello-World");
    expect(result.resolver).toBe("github");
  });
});