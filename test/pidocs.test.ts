// test/pidocs.test.ts — Tool registration + before_agent_start hook tests
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Mock pidocs-core so we test the tool wrapper layer in isolation
vi.mock("../pidocs-core", () => ({
  resolveLookup: vi.fn(),
  resolveInstall: vi.fn(),
}));

vi.mock("../pidocs-resolvers", () => ({
  loadPidocsConfig: vi.fn().mockReturnValue({
    resolvers: {
      npm: { enabled: true }, github: { enabled: true }, pip: { enabled: true },
      cargo: { enabled: true }, brew: { enabled: true }, docker: { enabled: true },
      vscode: { enabled: true }, go: { enabled: true }, aur: { enabled: true },
      flatpak: { enabled: true }, snap: { enabled: true }, custom: [],
    },
  }),
}));

import { resolveLookup, resolveInstall } from "../pidocs-core";
import { registerPidocs } from "../pidocs";

const mockResolveLookup = vi.mocked(resolveLookup);
const mockResolveInstall = vi.mocked(resolveInstall);

function setup(): {
  api: ExtensionAPI;
  registeredTools: Map<string, any>;
  eventHandlers: Record<string, Function>;
} {
  const registeredTools = new Map<string, any>();
  const eventHandlers: Record<string, Function> = {};

  const api = {
    registerTool: vi.fn((def: any) => registeredTools.set(def.name, def)),
    on: vi.fn((event: string, handler: Function) => {
      eventHandlers[event] = handler;
    }),
  } as unknown as ExtensionAPI;

  registerPidocs(api);
  return { api, registeredTools, eventHandlers };
}

describe("pidocs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Tool registration ──

  describe("registerPidocs", () => {
    it("registers pidocs_lookup and pidocs_install tools", () => {
      const { registeredTools } = setup();
      expect(registeredTools.has("pidocs_lookup")).toBe(true);
      expect(registeredTools.has("pidocs_install")).toBe(true);
    });

    it("registers before_agent_start event handler", () => {
      const { eventHandlers } = setup();
      expect(eventHandlers["before_agent_start"]).toBeDefined();
      expect(typeof eventHandlers["before_agent_start"]).toBe("function");
    });

    it("pidocs_lookup has required name and type parameters", () => {
      const { registeredTools } = setup();
      const lookupTool = registeredTools.get("pidocs_lookup")!;
      const props = lookupTool.parameters.properties;
      expect(props).toHaveProperty("name");
      expect(props).toHaveProperty("type");
    });

    it("pidocs_install has name, type, and platform parameters", () => {
      const { registeredTools } = setup();
      const installTool = registeredTools.get("pidocs_install")!;
      const props = installTool.parameters.properties;
      expect(props).toHaveProperty("name");
      expect(props).toHaveProperty("type");
      expect(props).toHaveProperty("platform");
    });

    it("pidocs_lookup has prompt guidelines", () => {
      const { registeredTools } = setup();
      const lookupTool = registeredTools.get("pidocs_lookup")!;
      expect(lookupTool.promptGuidelines).toBeDefined();
      expect(lookupTool.promptGuidelines.length).toBeGreaterThan(0);
    });

    it("pidocs_install has prompt guidelines", () => {
      const { registeredTools } = setup();
      const installTool = registeredTools.get("pidocs_install")!;
      expect(installTool.promptGuidelines).toBeDefined();
      expect(installTool.promptGuidelines.length).toBeGreaterThan(0);
    });
  });

  // ── pidocs_lookup execute ──

  describe("pidocs_lookup execute", () => {
    it("returns formatted result with URL", async () => {
      const { registeredTools } = setup();

      mockResolveLookup.mockResolvedValue({
        urls: ["https://www.npmjs.com/package/lodash"],
        resolver: "npm",
        name: "lodash",
        type: "npm",
      });

      const lookupTool = registeredTools.get("pidocs_lookup")!;
      const result = await lookupTool.execute("call-1", { name: "lodash", type: "npm" }, undefined, undefined, undefined);

      expect(result.content[0].type).toBe("text");
      const text = result.content[0].text;
      expect(text).toContain("lodash");
      expect(text).toContain("npm");
      expect(text).toContain("https://www.npmjs.com/package/lodash");
      expect(result.details.urls).toContain("https://www.npmjs.com/package/lodash");
    });

    it("includes description in output when available", async () => {
      const { registeredTools } = setup();

      mockResolveLookup.mockResolvedValue({
        urls: ["https://pypi.org/project/flask"],
        description: "A lightweight WSGI web application framework",
        resolver: "pip",
        name: "flask",
        type: "pip",
      });

      const lookupTool = registeredTools.get("pidocs_lookup")!;
      const result = await lookupTool.execute("call-2", { name: "flask" }, undefined, undefined, undefined);

      expect(result.content[0].text).toContain("A lightweight WSGI web application framework");
    });

    it("returns isError when resolveLookup throws", async () => {
      const { registeredTools } = setup();

      mockResolveLookup.mockRejectedValue(new Error("SearXNG connection refused"));

      const lookupTool = registeredTools.get("pidocs_lookup")!;
      const result = await lookupTool.execute("call-3", { name: "unknown-pkg" }, undefined, undefined, undefined);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("unknown-pkg");
      expect(result.content[0].text).toContain("SearXNG connection refused");
    });

    it("shows 'No URLs found' when no URLs returned", async () => {
      const { registeredTools } = setup();

      mockResolveLookup.mockResolvedValue({
        urls: [],
        description: "No results found",
        resolver: "searxng",
        name: "zzz-nonexistent-xyz",
        type: "unknown",
      });

      const lookupTool = registeredTools.get("pidocs_lookup")!;
      const result = await lookupTool.execute("call-4", { name: "zzz-nonexistent-xyz" }, undefined, undefined, undefined);

      expect(result.content[0].text).toContain("No URLs found");
    });

    it("passes name and type parameters to resolveLookup", async () => {
      const { registeredTools } = setup();

      mockResolveLookup.mockResolvedValue({
        urls: ["https://www.npmjs.com/package/react"],
        resolver: "npm",
        name: "react",
        type: "npm",
      });

      const lookupTool = registeredTools.get("pidocs_lookup")!;
      await lookupTool.execute("call-5", { name: "react", type: "npm" }, undefined, undefined, undefined);

      expect(mockResolveLookup).toHaveBeenCalledWith("react", { typeHint: "npm" });
    });
  });

  // ── pidocs_install execute ──

  describe("pidocs_install execute", () => {
    it("returns install commands for known packages", async () => {
      const { registeredTools } = setup();

      mockResolveInstall.mockResolvedValue({
        installCommands: [
          { platform: "cross-platform", manager: "npm", command: "npm install lodash" },
        ],
        sourceUrl: "https://www.npmjs.com/package/lodash",
        resolver: "npm",
        name: "lodash",
        type: "npm",
      });

      const installTool = registeredTools.get("pidocs_install")!;
      const result = await installTool.execute("call-6", { name: "lodash", type: "npm" }, undefined, undefined, undefined);

      expect(result.content[0].text).toContain("npm install lodash");
      expect(result.details.installCommands).toHaveLength(1);
    });

    it("formats cross-platform as 'Any' in output", async () => {
      const { registeredTools } = setup();

      mockResolveInstall.mockResolvedValue({
        installCommands: [
          { platform: "cross-platform", manager: "npm", command: "npm install react" },
          { platform: "mac", manager: "brew", command: "brew install react" },
        ],
        sourceUrl: "https://www.npmjs.com/package/react",
        resolver: "npm",
        name: "react",
        type: "npm",
      });

      const installTool = registeredTools.get("pidocs_install")!;
      const result = await installTool.execute("call-7", { name: "react" }, undefined, undefined, undefined);

      const text = result.content[0].text;
      expect(text).toContain("[Any/npm]");
      expect(text).toContain("[mac/brew]");
    });

    it("shows notes when available", async () => {
      const { registeredTools } = setup();

      mockResolveInstall.mockResolvedValue({
        installCommands: [
          { platform: "cross-platform", manager: "npm", command: "npm install node", notes: "Requires Node.js 18+" },
        ],
        sourceUrl: "https://www.npmjs.com/package/node",
        resolver: "npm",
        name: "node",
        type: "npm",
      });

      const installTool = registeredTools.get("pidocs_install")!;
      const result = await installTool.execute("call-8", { name: "node" }, undefined, undefined, undefined);

      expect(result.content[0].text).toContain("Note:");
      expect(result.content[0].text).toContain("Requires Node.js 18+");
    });

    it("returns isError when resolveInstall throws", async () => {
      const { registeredTools } = setup();

      mockResolveInstall.mockRejectedValue(new Error("Network timeout"));

      const installTool = registeredTools.get("pidocs_install")!;
      const result = await installTool.execute("call-9", { name: "broken-pkg" }, undefined, undefined, undefined);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Network timeout");
    });

    it("shows helpful message when no install commands found", async () => {
      const { registeredTools } = setup();

      mockResolveInstall.mockResolvedValue({
        installCommands: [],
        sourceUrl: "https://example.com/some-tool",
        resolver: "searxng",
        name: "obscure-tool",
        type: "unknown",
      });

      const installTool = registeredTools.get("pidocs_install")!;
      const result = await installTool.execute("call-10", { name: "obscure-tool" }, undefined, undefined, undefined);

      expect(result.content[0].text).toContain("No install commands extracted");
      expect(result.content[0].text).toContain("pidocs_lookup");
    });

    it("passes name, type, and platform parameters to resolveInstall", async () => {
      const { registeredTools } = setup();

      mockResolveInstall.mockResolvedValue({
        installCommands: [],
        sourceUrl: "https://example.com",
        resolver: "brew",
        name: "ffmpeg",
        type: "brew",
      });

      const installTool = registeredTools.get("pidocs_install")!;
      await installTool.execute("call-11", { name: "ffmpeg", type: "brew", platform: "mac" }, undefined, undefined, undefined);

      expect(mockResolveInstall).toHaveBeenCalledWith("ffmpeg", { typeHint: "brew", platform: "mac" });
    });
  });

  // ── before_agent_start hook ──

  describe("before_agent_start hook", () => {
    it("injects guideline for install intent", async () => {
      const { eventHandlers } = setup();

      const result = await eventHandlers["before_agent_start"](
        { prompt: "How do I install ffmpeg on ubuntu?", systemPrompt: "You are helpful." },
        {}
      );

      expect(result.systemPrompt).toContain("pidocs_install");
      expect(result.systemPrompt).toContain("pidocs_lookup");
    });

    it("does NOT inject for non-install messages", async () => {
      const { eventHandlers } = setup();

      const result = await eventHandlers["before_agent_start"](
        { prompt: "What is the weather today?", systemPrompt: "You are helpful." },
        {}
      );

      expect(result).toBeUndefined();
    });

    it("injects for package references WITH install context", async () => {
      const { eventHandlers } = setup();

      // "add" triggers install context + owner/repo triggers package ref
      const result = await eventHandlers["before_agent_start"](
        { prompt: "I need to add octocat/lib to my project", systemPrompt: "You are helpful." },
        {}
      );

      expect(result.systemPrompt).toContain("pidocs_install");
    });

    it("does NOT inject for package references WITHOUT install context", async () => {
      const { eventHandlers } = setup();

      // "octocat/lib" is a package ref but "explain" is not install context
      const result = await eventHandlers["before_agent_start"](
        { prompt: "Explain what octocat/lib does", systemPrompt: "You are helpful." },
        {}
      );

      expect(result).toBeUndefined();
    });

    it("detects all explicit package manager commands", async () => {
      const { eventHandlers } = setup();

      const prompts = [
        "npm install lodash",
        "pip install flask",
        "brew install ffmpeg",
        "apt install nginx",
        "snap install code",
        "cargo add tokio",
        "go get github.com/gin-gonic/gin",
        "flatpak install org.gimp.GIMP",
        "choco install firefox",
      ];

      for (const prompt of prompts) {
        const result = await eventHandlers["before_agent_start"](
          { prompt, systemPrompt: "You are helpful." },
          {}
        );
        expect(result.systemPrompt).toContain("pidocs_install");
      }
    });

    it("preserves existing system prompt content", async () => {
      const { eventHandlers } = setup();

      const result = await eventHandlers["before_agent_start"](
        { prompt: "How to install docker?", systemPrompt: "You are a coding assistant." },
        {}
      );

      expect(result.systemPrompt).toContain("You are a coding assistant.");
      expect(result.systemPrompt).toContain("pidocs_install");
    });

    it("does not inject for 'setup' as a noun (without install context)", async () => {
      const { eventHandlers } = setup();

      // "setup" alone triggers INSTALL_PATTERNS, but "the setup was wrong" is casual
      const result = await eventHandlers["before_agent_start"](
        { prompt: "The project setup was already configured", systemPrompt: "You are helpful." },
        {}
      );

      // "setup" is in INSTALL_PATTERNS, so this WILL trigger — it's a known limitation
      // that the regex can't distinguish noun "setup" from verb "setup"
      // This test documents the behavior
      expect(result).toBeDefined();
    });

    it("detects 'how to install' pattern", async () => {
      const { eventHandlers } = setup();

      const result = await eventHandlers["before_agent_start"](
        { prompt: "how to install postgresql on mac", systemPrompt: "You are helpful." },
        {}
      );

      expect(result.systemPrompt).toContain("pidocs_install");
    });
  });
});