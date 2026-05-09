// test/pidocs.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Mock dependencies
vi.mock("../pidocs-core", () => ({
  resolveLookup: vi.fn(),
  resolveInstall: vi.fn(),
}));

vi.mock("../pidocs-resolvers", () => ({
  loadPidocsConfig: vi.fn().mockReturnValue({
    resolvers: {
      npm: { enabled: true },
      github: { enabled: true },
      pip: { enabled: true },
      cargo: { enabled: true },
      brew: { enabled: true },
      docker: { enabled: true },
      vscode: { enabled: true },
      go: { enabled: true },
      aur: { enabled: true },
      flatpak: { enabled: true },
      snap: { enabled: true },
      custom: [],
    },
  }),
}));

import { resolveLookup, resolveInstall } from "../pidocs-core";
import { registerPidocs } from "../pidocs";

const mockResolveLookup = vi.mocked(resolveLookup);
const mockResolveInstall = vi.mocked(resolveInstall);

function createMockAPI() {
  const registeredTools: Array<{ name: string; parameters: any; execute: Function; promptSnippet?: string; promptGuidelines?: string[] }> = [];
  const eventHandlers: Record<string, Function> = {};

  const api = {
    registerTool: vi.fn((def: any) => {
      registeredTools.push(def);
    }),
    on: vi.fn((event: string, handler: Function) => {
      eventHandlers[event] = handler;
    }),
  } as unknown as ExtensionAPI;

  return { api, registeredTools, eventHandlers };
}

describe("pidocs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("registerPidocs", () => {
    it("registers pidocs_lookup and pidocs_install tools", () => {
      const { api, registeredTools } = createMockAPI();
      registerPidocs(api);

      const toolNames = registeredTools.map((t) => t.name);
      expect(toolNames).toContain("pidocs_lookup");
      expect(toolNames).toContain("pidocs_install");
    });

    it("registers before_agent_start event handler", () => {
      const { api, eventHandlers } = createMockAPI();
      registerPidocs(api);

      expect(eventHandlers["before_agent_start"]).toBeDefined();
    });
  });

  describe("pidocs_lookup execute", () => {
    it("returns formatted result for known packages", async () => {
      const { api, registeredTools } = createMockAPI();
      registerPidocs(api);

      mockResolveLookup.mockResolvedValue({
        urls: ["https://www.npmjs.com/package/lodash"],
        resolver: "npm",
        name: "lodash",
        type: "npm",
      });

      const lookupTool = registeredTools.find((t) => t.name === "pidocs_lookup")!;
      const result = await lookupTool.execute("call-1", { name: "lodash", type: "npm" }, undefined, undefined, undefined);

      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("lodash");
      expect(result.details.urls).toContain("https://www.npmjs.com/package/lodash");
    });
  });

  describe("pidocs_install execute", () => {
    it("returns install commands for known packages", async () => {
      const { api, registeredTools } = createMockAPI();
      registerPidocs(api);

      mockResolveInstall.mockResolvedValue({
        installCommands: [
          { platform: "cross-platform", manager: "npm", command: "npm install lodash" },
        ],
        sourceUrl: "https://www.npmjs.com/package/lodash",
        resolver: "npm",
        name: "lodash",
        type: "npm",
      });

      const installTool = registeredTools.find((t) => t.name === "pidocs_install")!;
      const result = await installTool.execute("call-2", { name: "lodash", type: "npm" }, undefined, undefined, undefined);

      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("npm install lodash");
      expect(result.details.installCommands).toHaveLength(1);
    });
  });

  describe("before_agent_start hook", () => {
    it("injects system prompt guideline when install intent detected", async () => {
      const { api, eventHandlers } = createMockAPI();
      registerPidocs(api);

      const handler = eventHandlers["before_agent_start"];

      const result = await handler(
        { prompt: "How do I install ffmpeg on ubuntu?", systemPrompt: "You are helpful." },
        {}
      );

      expect(result.systemPrompt).toContain("pidocs_install");
      expect(result.systemPrompt).toContain("pidocs_lookup");
    });

    it("does not inject guideline for non-install messages", async () => {
      const { api, eventHandlers } = createMockAPI();
      registerPidocs(api);

      const handler = eventHandlers["before_agent_start"];

      const result = await handler(
        { prompt: "What is the weather today?", systemPrompt: "You are helpful." },
        {}
      );

      expect(result).toBeUndefined();
    });

    it("injects guideline for package references with install context", async () => {
      const { api, eventHandlers } = createMockAPI();
      registerPidocs(api);

      const handler = eventHandlers["before_agent_start"];

      const result = await handler(
        { prompt: "I need to add octocat/lib to my project", systemPrompt: "You are helpful." },
        {}
      );

      // "add" triggers install context + owner/repo pattern triggers package ref
      expect(result.systemPrompt).toContain("pidocs_install");
    });
  });
});