// test/obscura.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execAsync, OBSCURA_PATH } from "../obscura";

describe("OBSCURA_PATH", () => {
  it("returns the obscura binary path", () => {
    const path = OBSCURA_PATH();
    expect(path).toBeTruthy();
    expect(typeof path).toBe("string");
  });
});

describe("execAsync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("runs a command and returns stdout/stderr", async () => {
    const result = await execAsync(["--version"], 5_000);
    // Obscura may or may not have --version, just check shape
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
  });
});
