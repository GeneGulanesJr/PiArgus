// test/tier-router.test.ts
import { describe, it, expect } from "vitest";
import { classifyTier, tierExplanation } from "../tier-router";

describe("classifyTier", () => {
  describe("browser_screenshot", () => {
    it("always routes to heavy tier", () => {
      expect(classifyTier("browser_screenshot", { url: "https://example.com" })).toBe("heavy");
    });
  });

  describe("browser_action", () => {
    it("routes click to heavy tier", () => {
      expect(classifyTier("browser_action", { action: "click", selector: "button" })).toBe("heavy");
    });

    it("routes fill to heavy tier", () => {
      expect(classifyTier("browser_action", { action: "fill", selector: "input", value: "hello" })).toBe("heavy");
    });

    it("routes hover to heavy tier", () => {
      expect(classifyTier("browser_action", { action: "hover", selector: ".menu" })).toBe("heavy");
    });

    it("routes wait_for to heavy tier", () => {
      expect(classifyTier("browser_action", { action: "wait_for", selector: ".loaded" })).toBe("heavy");
    });

    it("routes js to light tier", () => {
      expect(classifyTier("browser_action", { action: "js", expression: "document.title" })).toBe("light");
    });

    it("routes navigate to light tier", () => {
      expect(classifyTier("browser_action", { action: "navigate" })).toBe("light");
    });

    it("routes screenshot_info to light tier", () => {
      expect(classifyTier("browser_action", { action: "screenshot_info" })).toBe("light");
    });

    it("routes unknown action to light tier (safe default)", () => {
      expect(classifyTier("browser_action", { action: "unknown" })).toBe("light");
    });
  });

  describe("other tools", () => {
    it("routes browser_fetch to light tier", () => {
      expect(classifyTier("browser_fetch", { url: "https://example.com", mode: "text" })).toBe("light");
    });

    it("routes browser_navigate to light tier", () => {
      expect(classifyTier("browser_navigate", { url: "https://example.com" })).toBe("light");
    });

    it("routes browser_scrape to light tier", () => {
      expect(classifyTier("browser_scrape", { urls: ["https://a.com", "https://b.com"] })).toBe("light");
    });
  });
});

describe("tierExplanation", () => {
  it("explains heavy tier for screenshots", () => {
    const explanation = tierExplanation("browser_screenshot", { url: "https://example.com" });
    expect(explanation).toContain("smolvm");
    expect(explanation).toContain("Chromium");
  });

  it("explains heavy tier for click action", () => {
    const explanation = tierExplanation("browser_action", { action: "click" });
    expect(explanation).toContain("DOM interaction");
  });

  it("explains light tier for fetch", () => {
    const explanation = tierExplanation("browser_fetch", { url: "https://example.com" });
    expect(explanation).toContain("Obscura");
  });
});
