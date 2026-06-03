// test/docker.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecFile, mockExecFileSync, mockImplementations, resetMocks, replyOk, replyFail } = vi.hoisted(() => {
  let callCount = 0;
  let syncResult: null | { stdout: string; stderr: string } = null;
  let implementations: Array<(args: string[], cb: Function) => void> = [];

  const execFile = vi.fn((_cmd: string, args: string[], _opts: any, cb: Function) => {
    if (callCount < implementations.length) {
      implementations[callCount](args, cb);
    } else {
      cb(null, { stdout: "", stderr: "" });
    }
    callCount++;
  });

  const execFileSync = vi.fn(() => {
    if (syncResult) return;
    throw new Error("docker not found");
  });

  function reset() {
    callCount = 0;
    implementations = [];
    syncResult = null;
    execFile.mockClear();
    execFileSync.mockClear();
  }

  function ok(stdout: string) {
    return (_args: string[], cb: Function) => cb(null, { stdout, stderr: "" });
  }

  function fail(stderr: string, code = 1) {
    return (_args: string[], cb: Function) => cb({ code, stderr, stdout: "" });
  }

  return {
    mockExecFile: execFile,
    mockExecFileSync: execFileSync,
    mockImplementations: { get: () => implementations, set: (v: any) => { implementations = v; } },
    resetMocks: reset,
    replyOk: ok,
    replyFail: fail,
  };
});

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
  execFileSync: mockExecFileSync,
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-png-data")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { isDockerInstalled, getContainerStatus, getContainerName, interact } from "../docker";

beforeEach(() => {
  resetMocks();
});

describe("isDockerInstalled", () => {
  it("returns boolean without throwing", () => {
    const result = isDockerInstalled();
    expect(typeof result).toBe("boolean");
  });
});

describe("getContainerStatus", () => {
  beforeEach(() => {
    mockExecFileSync.mockImplementation(() => {});
  });

  it("returns 'running' when container reports running", async () => {
    mockImplementations.set([replyOk("running\n")]);
    const status = await getContainerStatus();
    expect(status).toBe("running");
  });

  it("returns 'stopped' when container reports exited", async () => {
    mockImplementations.set([replyOk("exited\n")]);
    const status = await getContainerStatus();
    expect(status).toBe("stopped");
  });

  it("returns 'stopped' when container not found", async () => {
    mockImplementations.set([replyFail("No such container")]);
    const status = await getContainerStatus();
    expect(status).toBe("stopped");
  });
});

describe("interact", () => {
  beforeEach(() => {
    mockExecFileSync.mockImplementation(() => {});
  });

  it("bootstraps container and executes interaction successfully", async () => {
    mockImplementations.set([
      replyFail("not found"),     // 1: inspect — not found (will try create)
      replyOk("container-id\n"),  // 2: docker run
      replyOk("ready"),           // 3: waitForContainerReady echo check
      replyOk(""),                // 4: write interact script
      replyOk("<html>clicked</html>"), // 5: node interact.js
    ]);

    const result = await interact("https://example.com", [
      { type: "click", selector: "button" },
    ]);

    expect(result.success).toBe(true);
    expect(result.html).toContain("clicked");
  });

  it("starts stopped container", async () => {
    mockImplementations.set([
      replyOk("exited\n"),        // 1: inspect — exited (will just start)
      replyOk("container-id\n"),  // 2: docker start
      replyOk("ready"),           // 3: waitForContainerReady echo check
      replyOk(""),                // 4: write interact script
      replyOk("<html>filled</html>"), // 5: node interact.js
    ]);

    const result = await interact("https://example.com", [
      { type: "fill", selector: "input", value: "test" },
    ]);

    expect(result.success).toBe(true);
    expect(result.html).toContain("filled");
  });

  it("uses already-running container", async () => {
    mockImplementations.set([
      replyOk("running\n"),       // 1: inspect — running
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
      replyOk("running\n"),       // 1: inspect — running
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
      replyOk("running\n"),       // 1: inspect — running
      replyFail("disk full"),     // 2: write script fails
    ]);

    const result = await interact("https://example.com", [
      { type: "hover", selector: ".menu" },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to write interaction script");
  });
});
