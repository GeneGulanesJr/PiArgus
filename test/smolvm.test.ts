// test/smolvm.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to mock at the smolvmExec level, but it's private.
// Instead, mock child_process and handle the promisified callback pattern.
// The key insight: promisify(execFile) calls execFile(file, args, opts, callback)
// where callback = (err, result) => ...

let mockCallCount = 0;
let mockImplementations: Array<(args: string[], cb: Function) => void> = [];

const mockExecFile = vi.fn((_cmd: string, args: string[], _opts: any, cb: Function) => {
  if (mockCallCount < mockImplementations.length) {
    mockImplementations[mockCallCount](args, cb);
  } else {
    cb(null, { stdout: "", stderr: "" });
  }
  mockCallCount++;
});

vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
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
  mockCallCount = 0;
  mockImplementations = [];
  mockExecFile.mockClear();
});

// Helper: simulate a successful call
function replyOk(stdout: string) {
  return (args: string[], cb: Function) => cb(null, { stdout, stderr: "" });
}

// Helper: simulate a failing call (promisify treats first arg as error)
function replyFail(stderr: string, code = 1) {
  return (_args: string[], cb: Function) => cb({ code, stderr, stdout: "" });
}

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
    mockImplementations = [replyOk("running\n")];
    const status = await getVmStatus();
    expect(status).toBe("running");
  });

  it("returns 'stopped' when machine reports stopped", async () => {
    mockImplementations = [replyOk("stopped\n")];
    const status = await getVmStatus();
    expect(status).toBe("stopped");
  });

  it("returns 'stopped' when machine not found", async () => {
    mockImplementations = [replyFail("machine not found")];
    const status = await getVmStatus();
    expect(status).toBe("stopped");
  });
});

describe("interact", () => {
  it("bootstraps VM and executes interaction successfully", async () => {
    mockImplementations = [
      replyFail("not found"),     // 1: machine status — not found
      replyOk("created\n"),       // 2: machine create
      replyOk("started\n"),       // 3: machine start
      replyOk(""),                // 4: write interact script
      replyOk("<html>clicked</html>"), // 5: node interact.js
    ];

    const result = await interact("https://example.com", [
      { type: "click", selector: "button" },
    ]);

    expect(result.success).toBe(true);
    expect(result.html).toContain("clicked");
  });

  it("uses already-running VM", async () => {
    mockImplementations = [
      replyOk("running\n"),       // 1: machine status — running
      replyOk(""),                // 2: write interact script
      replyOk("<html>filled</html>"), // 3: node interact.js
    ];

    const result = await interact("https://example.com", [
      { type: "fill", selector: "input", value: "test" },
    ]);

    expect(result.success).toBe(true);
    expect(result.html).toContain("filled");
  });

  it("returns error when script fails", async () => {
    mockImplementations = [
      replyOk("running\n"),       // 1: machine status — running
      replyOk(""),                // 2: write interact script
      replyFail("Puppeteer error"), // 3: node interact.js fails
    ];

    const result = await interact("https://example.com", [
      { type: "fill", selector: "input", value: "test" },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Puppeteer error");
  });

  it("returns error when script write fails", async () => {
    mockImplementations = [
      replyOk("running\n"),       // 1: machine status — running
      replyFail("disk full"),     // 2: write script fails
    ];

    const result = await interact("https://example.com", [
      { type: "hover", selector: ".menu" },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to write interaction script");
  });
});
