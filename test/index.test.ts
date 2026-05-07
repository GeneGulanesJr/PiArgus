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

const mockRegisterWebSearch = vi.fn();
vi.mock("../web-search", () => ({
  registerWebSearch: (...args: any[]) => mockRegisterWebSearch(...args),
}));

// Mock node:fs/promises for readFile (screenshot)
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
}));

const registeredTools: Array<{ name: string; label: string; parameters: any }> = [];
const mockPi = {
  on: vi.fn(),
  registerTool: vi.fn((tool: any) => {
    registeredTools.push({ name: tool.name, label: tool.label, parameters: tool.parameters });
  }),
};

describe("PiArgus extension registration", () => {
  beforeEach(async () => {
    registeredTools.length = 0;
    vi.clearAllMocks();
    // Re-import for fresh registration each test
    const mod = await import("../index");
    await mod.default(mockPi as any);
  });

  it("registers session_shutdown handler", () => {
    expect(mockPi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
  });

  it("registers 6 tools", () => {
    expect(mockPi.registerTool).toHaveBeenCalledTimes(6);
  });

  it("calls registerWebSearch with pi", () => {
    expect(mockRegisterWebSearch).toHaveBeenCalledWith(mockPi);
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
    expect(modeParam?.anyOf).toBeTruthy();
  });

  it("browser_action has an action parameter with union type", () => {
    const actionTool = registeredTools.find((t) => t.name === "browser_action");
    expect(actionTool).toBeTruthy();
    const actionParam = actionTool!.parameters.properties?.action;
    expect(actionParam).toBeTruthy();
    expect(actionParam?.anyOf).toBeTruthy();
  });
});
