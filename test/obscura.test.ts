// test/obscura.test.ts
import { describe, it, expect, vi } from "vitest";
import { execAsync, OBSCURA_PATH, fetchText, fetchHtml, fetchLinks, evalJs, isInstalled } from "../obscura";

vi.mock("../docker", () => ({
  ensureContainer: vi.fn().mockResolvedValue({ running: true }),
  getContainerName: () => "piargus",
  isDockerInstalled: () => true,
}));

vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], opts: any, cb: Function) => {
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

describe("OBSCURA_PATH", () => {
  it("returns the docker exec path string", () => {
    const path = OBSCURA_PATH();
    expect(path).toBeTruthy();
    expect(typeof path).toBe("string");
    expect(path).toContain("docker exec");
  });
});

describe("isInstalled", () => {
  it("delegates to isDockerInstalled", () => {
    const result = isInstalled();
    expect(result).toBe(true);
  });
});

describe("fetchText", () => {
  it("passes --dump text flag via docker exec", async () => {
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
  it("passes --dump html flag via docker exec", async () => {
    const result = await fetchHtml("https://example.com");
    expect(result.stdout).toContain("<html>");
  });
});

describe("fetchLinks", () => {
  it("passes --dump links flag via docker exec", async () => {
    const result = await fetchLinks("https://example.com");
    expect(result.stdout).toContain("https://example.com");
    expect(result.stdout).toContain("https://example.org");
  });
});

describe("evalJs", () => {
  it("passes --eval flag with expression via docker exec", async () => {
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
