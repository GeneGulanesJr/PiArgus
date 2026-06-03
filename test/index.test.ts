// test/index.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../obscura", () => ({
  OBSCURA_PATH: () => "docker exec piargus obscura",
  isInstalled: () => true,
  fetchText: vi.fn().mockResolvedValue({ stdout: "text", stderr: "" }),
  fetchHtml: vi.fn().mockResolvedValue({ stdout: "<html>", stderr: "" }),
  fetchLinks: vi.fn().mockResolvedValue({ stdout: "links", stderr: "" }),
  evalJs: vi.fn().mockResolvedValue({ stdout: "result", stderr: "" }),
  execAsync: vi.fn().mockResolvedValue({ stdout: "ok", stderr: "" }),
}));

vi.mock("../docker", () => ({
  isDockerInstalled: () => true,
  ensureContainer: vi.fn().mockResolvedValue({ running: true }),
  stopContainer: vi.fn().mockResolvedValue({ stopped: true }),
  screenshot: vi.fn().mockResolvedValue({ path: "/tmp/shot.png" }),
  interact: vi.fn().mockResolvedValue({ success: true, html: "<html>ok</html>" }),
  getContainerStatus: vi.fn().mockResolvedValue("running"),
  getSearchVmStatus: vi.fn().mockResolvedValue("running"),
  ensureSearchVm: vi.fn().mockResolvedValue({ running: true, url: "http://localhost:8888" }),
  SEARXNG_LOCAL_URL: "http://localhost:8888",
}));

vi.mock("../tier-router", () => ({
  classifyTier: vi.fn().mockReturnValue("light"),
  tierExplanation: vi.fn().mockReturnValue("Obscura"),
}));

const mockRegisterWebSearch = vi.fn();
const mockRegisterWebResearch = vi.fn();
vi.mock("../web-search", () => ({
  registerWebSearch: (...args: any[]) => mockRegisterWebSearch(...args),
  registerWebResearch: (...args: any[]) => mockRegisterWebResearch(...args),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
}));

const registeredTools: Array<{ name: string; label: string; parameters: any }> = [];
const registerToolSpy = vi.fn((tool: any) => {
  registeredTools.push({ name: tool.name, label: tool.label, parameters: tool.parameters });
});
const mockPi = {
  on: vi.fn(),
  registerTool: registerToolSpy,
  getActiveTools: vi.fn().mockReturnValue([]),
  setActiveTools: vi.fn(),
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

  it("registers 6 browser tools plus delegates web_search and web_research", () => {
    expect(registerToolSpy).toHaveBeenCalledTimes(8);
    expect(mockRegisterWebSearch).toHaveBeenCalledWith(mockPi);
    expect(mockRegisterWebResearch).toHaveBeenCalledWith(mockPi);
  });

  it("calls registerWebSearch with pi", () => {
    expect(mockRegisterWebSearch).toHaveBeenCalledWith(mockPi);
  });

  it("calls registerWebResearch with pi", () => {
    expect(mockRegisterWebResearch).toHaveBeenCalledWith(mockPi);
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

  it("registers browser_vm_status tool", () => {
    const names = registeredTools.map((t) => t.name);
    expect(names).toContain("browser_vm_status");
    expect(names).not.toContain("browser_obscura_serve");
  });

  it("does not register web_search or web_research tools directly", () => {
    const names = registeredTools.map((t) => t.name);
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("web_research");
  });

  it("browser_fetch has a mode parameter with union type", () => {
    const fetchTool = registeredTools.find((t) => t.name === "browser_fetch");
    expect(fetchTool).toBeTruthy();
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
