// test/obscura.test.ts
import { describe, it, expect, vi } from "vitest";
import { execAsync, OBSCURA_PATH, fetchText, fetchHtml, fetchLinks, evalJs, isInstalled } from "../obscura";

// Mock execFile so we don't need obscura installed
vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], opts: any, cb: Function) => {
    // Handle the overloaded signature: execFile(cmd, args, opts, cb) or execFile(cmd, args, cb)
    // Our promisified version always passes an opts object
    if (args.includes("--version")) {
      cb(null, { stdout: "obscura 1.0.0\n", stderr: "" });
    } else if (args.includes("--dump") && args.includes("text")) {
      cb(null, { stdout: "Hello World from page", stderr: "" });
    } else if (args.includes("--dump") && args.includes("html")) {
      cb(null, { stdout: "<html><body>Hello</body></html>", stderr: "" });
    } else if (args.includes("--dump") && args.includes("links")) {
      cb(null, { stdout: "https://example.com\nhttps://example.org\n", stderr: "" });
    } else if (args.includes("--eval")) {
      cb(null, { stdout: '{"title":"Test Page"}', stderr: "" });
    } else {
      cb(null, { stdout: "", stderr: "" });
    }
  },
}));

// Mock existsSync to make OBSCURA_PATH find our mock
vi.mock("node:fs", () => ({
  existsSync: (p: string) => p.includes(".local/bin/obscura"),
}));

describe("OBSCURA_PATH", () => {
  it("returns the obscura binary path", () => {
    const path = OBSCURA_PATH();
    expect(path).toBeTruthy();
    expect(typeof path).toBe("string");
  });
});

describe("isInstalled", () => {
  it("returns boolean without throwing", () => {
    const result = isInstalled();
    expect(typeof result).toBe("boolean");
  });
});

describe("fetchText", () => {
  it("passes --dump text flag", async () => {
    const result = await fetchText("https://example.com");
    expect(result.stdout).toContain("Hello World");
  });

  it("passes stealth flag when set", async () => {
    const result = await fetchText("https://example.com", { stealth: true });
    expect(result.stdout).toBeTruthy();
  });

  it("passes selector flag when set", async () => {
    const result = await fetchText("https://example.com", { selector: "main" });
    expect(result.stdout).toBeTruthy();
  });
});

describe("fetchHtml", () => {
  it("passes --dump html flag", async () => {
    const result = await fetchHtml("https://example.com");
    expect(result.stdout).toContain("<html>");
  });
});

describe("fetchLinks", () => {
  it("passes --dump links flag", async () => {
    const result = await fetchLinks("https://example.com");
    expect(result.stdout).toContain("https://example.com");
    expect(result.stdout).toContain("https://example.org");
  });
});

describe("evalJs", () => {
  it("passes --eval flag with expression", async () => {
    const result = await evalJs("https://example.com", "document.title");
    expect(result.stdout).toContain("Test Page");
  });

  it("passes stealth flag when set", async () => {
    const result = await evalJs("https://example.com", "1+1", { stealth: true });
    expect(result.stdout).toBeTruthy();
  });
});

describe("execAsync", () => {
  it("returns stdout and stderr properties", async () => {
    const result = await execAsync(["--version"], 5_000);
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
  });
});
