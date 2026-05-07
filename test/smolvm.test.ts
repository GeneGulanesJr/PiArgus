// test/smolvm.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted runs before vi.mock factories, so mock definitions here
// are available when the mock factory executes
const { mockExecFile, mockCallCount, mockImplementations, resetMocks, replyOk, replyFail } = vi.hoisted(() => {
  let callCount = 0;
  let implementations: Array<(args: string[], cb: Function) => void> = [];

  const execFile = vi.fn((_cmd: string, args: string[], _opts: any, cb: Function) => {
    if (callCount < implementations.length) {
      implementations[callCount](args, cb);
    } else {
      cb(null, { stdout: "", stderr: "" });
    }
    callCount++;
  });

  function reset() {
    callCount = 0;
    implementations = [];
    execFile.mockClear();
  }

  function ok(stdout: string) {
    return (_args: string[], cb: Function) => cb(null, { stdout, stderr: "" });
  }

  function fail(stderr: string, code = 1) {
    return (_args: string[], cb: Function) => cb({ code, stderr, stdout: "" });
  }

  return {
    mockExecFile: execFile,
    mockCallCount: { get: () => callCount },
    mockImplementations: { get: () => implementations, set: (v: any) => { implementations = v; } },
    resetMocks: reset,
    replyOk: ok,
    replyFail: fail,
  };
});

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("node:fs", () => ({
  existsSync: (p: string) => p.includes(".local/bin/smolvm") || p.includes("browser.smolfile"),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-png-data")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { SMOLVM_PATH, isSmolvmInstalled, getVmStatus, interact } from "../smolvm";

beforeEach(() => {
  resetMocks();
});

describe("SMOLVM_PATH", () => {
  it("returns a path string", () => {
    const path = SMOLVM_PATH();
    expect(path).toBeTruthy();
    expect(typeof path).toBe("string");
  });
});

describe("isSmolvmInstalled", () => {
  it("returns boolean without throwing", () => {
    const result = isSmolvmInstalled();
    expect(typeof result).toBe("boolean");
  });
});

describe("getVmStatus", () => {
  it("returns 'running' when machine reports running", async () => {
    mockImplementations.set([replyOk("running\n")]);
    const status = await getVmStatus();
    expect(status).toBe("running");
  });

  it("returns 'stopped' when machine reports stopped", async () => {
    mockImplementations.set([replyOk("stopped\n")]);
    const status = await getVmStatus();
    expect(status).toBe("stopped");
  });

  it("returns 'stopped' when machine not found", async () => {
    mockImplementations.set([replyFail("machine not found")]);
    const status = await getVmStatus();
    expect(status).toBe("stopped");
  });
});

describe("interact", () => {
  it("bootstraps VM and executes interaction successfully", async () => {
    mockImplementations.set([
      replyFail("not found"),     // 1: machine status — not found (will try create)
      replyOk("created\n"),       // 2: machine create
      replyOk("started\n"),       // 3: machine start
      replyOk(""),                // 4: write interact script
      replyOk("<html>clicked</html>"), // 5: node interact.js
    ]);

    const result = await interact("https://example.com", [
      { type: "click", selector: "button" },
    ]);

    expect(result.success).toBe(true);
    expect(result.html).toContain("clicked");
  });

  it("starts stopped VM", async () => {
    mockImplementations.set([
      replyOk("stopped\n"),       // 1: machine status — stopped (will just start)
      replyOk("started\n"),       // 2: machine start
      replyOk(""),                // 3: write interact script
      replyOk("<html>filled</html>"), // 4: node interact.js
    ]);

    const result = await interact("https://example.com", [
      { type: "fill", selector: "input", value: "test" },
    ]);

    expect(result.success).toBe(true);
    expect(result.html).toContain("filled");
  });

  it("uses already-running VM", async () => {
    mockImplementations.set([
      replyOk("running\n"),       // 1: machine status — running
      replyOk(""),                // 2: write interact script
      replyOk("<html>filled</html>"), // 3: node interact.js
    ]);

    const result = await interact("https://example.com", [
      { type: "fill", selector: "input", value: "test" },
    ]);

    expect(result.success).toBe(true);
    expect(result.html).toContain("filled");
  });

  it("returns error when script fails", async () => {
    mockImplementations.set([
      replyOk("running\n"),       // 1: machine status — running
      replyOk(""),                // 2: write interact script
      replyFail("Puppeteer error"), // 3: node interact.js fails
    ]);

    const result = await interact("https://example.com", [
      { type: "fill", selector: "input", value: "test" },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Puppeteer error");
  });

  it("returns error when script write fails", async () => {
    mockImplementations.set([
      replyOk("running\n"),       // 1: machine status — running
      replyFail("disk full"),     // 2: write script fails
    ]);

    const result = await interact("https://example.com", [
      { type: "hover", selector: ".menu" },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to write interaction script");
  });
});