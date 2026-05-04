// test/smolvm.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SMOLVM_PATH, isSmolvmInstalled } from "../smolvm";

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
