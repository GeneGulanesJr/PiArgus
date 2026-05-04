// test/tier-router.test.ts
import { describe, it, expect } from "vitest";
import { classifyTier } from "../tier-router";

describe("classifyTier", () => {
  it("classifies browser_fetch with mode=text as light", () => {
    expect(classifyTier("browser_fetch", { mode: "text", url: "https://example.com" })).toBe("light");
  });

  it("classifies browser_fetch with mode=html as light", () => {
    expect(classifyTier("browser_fetch", { mode: "html", url: "https://example.com" })).toBe("light");
  });

  it("classifies browser_fetch with mode=links as light", () => {
    expect(classifyTier("browser_fetch", { mode: "links", url: "https://example.com" })).toBe("light");
  });

  it("classifies browser_fetch with mode=eval as light", () => {
    expect(classifyTier("browser_fetch", { mode: "eval", url: "https://example.com" })).toBe("light");
  });

  it("classifies browser_navigate as light", () => {
    expect(classifyTier("browser_navigate", { url: "https://example.com" })).toBe("light");
  });

  it("classifies browser_scrape as light", () => {
    expect(classifyTier("browser_scrape", { urls: ["https://example.com"] })).toBe("light");
  });

  it("classifies browser_action with action=js as light", () => {
    expect(classifyTier("browser_action", { action: "js", url: "https://example.com" })).toBe("light");
  });

  it("classifies browser_screenshot as heavy", () => {
    expect(classifyTier("browser_screenshot", { url: "https://example.com" })).toBe("heavy");
  });

  it("classifies browser_action with action=click as heavy", () => {
    expect(classifyTier("browser_action", { action: "click", url: "https://example.com", selector: "#btn" })).toBe("heavy");
  });

  it("classifies browser_action with action=fill as heavy", () => {
    expect(classifyTier("browser_action", { action: "fill", url: "https://example.com", selector: "#input", value: "test" })).toBe("heavy");
  });

  it("classifies browser_action with action=screenshot_info as light", () => {
    expect(classifyTier("browser_action", { action: "screenshot_info", url: "https://example.com" })).toBe("light");
  });

  it("classifies unknown action as light (safe default)", () => {
    expect(classifyTier("browser_action", { action: "unknown", url: "https://example.com" })).toBe("light");
  });

  it("classifies browser_obscura_serve as light (status only)", () => {
    expect(classifyTier("browser_obscura_serve", { action: "status" })).toBe("light");
  });
});
