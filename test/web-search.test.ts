// test/web-search.test.ts
import { describe, it, expect } from "vitest";
import { formatResults, searchSearXNG } from "../web-search-core";

describe("formatResults", () => {
  it("formats results with all fields", () => {
    const formatted = formatResults({
      query: "testing",
      totalResults: 42,
      results: [
        {
          title: "Foo",
          url: "https://example.com",
          snippet: "Bar",
          engines: ["Google"],
          publishedDate: "2023-06-15",
        },
      ],
    });

    expect(formatted).toContain('Web search results for "testing" (42 total results');
    expect(formatted).toContain("### 1. Foo (2023-06-15)");
    expect(formatted).toContain("**URL:** https://example.com");
    expect(formatted).toContain("**Snippet:** Bar");
    expect(formatted).toContain("**Source:** [Google]");
  });

  it("handles empty results", () => {
    const formatted = formatResults({
      query: "nothing",
      totalResults: 0,
      results: [],
    });
    expect(formatted).toBe('No results found for "nothing".');
  });

  it("omits optional fields when absent", () => {
    const formatted = formatResults({
      query: "test",
      totalResults: 1,
      results: [{ title: "Only Title", url: "https://x.com", snippet: "", engines: [] }],
    });
    expect(formatted).not.toContain("**Snippet:**");
    expect(formatted).not.toContain("**Source:**");
  });
});

const SEARXNG_AVAILABLE = !!process.env.SEARXNG_URL;

describe("searchSearXNG (integration)", () => {
  it.skipIf(!SEARXNG_AVAILABLE)("returns search results via JSON API", async () => {
    const result = await searchSearXNG("hello world", { maxResults: 3 });
    expect(typeof result.totalResults).toBe("number");
    expect(result.query).toBe("hello world");
    expect(Array.isArray(result.results)).toBe(true);

    if (result.results.length > 0) {
      const first = result.results[0];
      expect(first).toHaveProperty("title");
      expect(first).toHaveProperty("url");
      expect(first).toHaveProperty("snippet");
      expect(first).toHaveProperty("engines");
      expect(typeof first.title).toBe("string");
      expect(typeof first.url).toBe("string");
    }
  });
});
