// test/web-search.test.ts
import { describe, it, expect } from "vitest";
import { stripHtml, parseResults, formatResults, searchSearXNG } from "../web-search-core";

describe("stripHtml", () => {
  it("removes tags and decodes entities", () => {
    const raw = `&lt;div&gt;Hello &amp; welcome!&nbsp;It's &quot;nice&quot;&lt;/div&gt;`;
    expect(stripHtml(raw)).toBe('Hello & welcome! It\'s "nice"');
  });

  it("returns plain text unchanged", () => {
    expect(stripHtml("no html here")).toBe("no html here");
  });
});

describe("parseResults", () => {
  const sampleHtml = `
    <article class="result" data-vim-selected="">
      <h3><a href="https://example.com/a" rel="noopener noreferrer">Title A</a></h3>
      <p class="content">Snippet for A</p>
      <div class="engines"><span>DuckDuckGo</span><span>Google</span></div>
      <time class="published_date" datetime="2024-01-01">2024-01-01</time>
    </article>
    <article class="result" data-vim-selected="">
      <h3><a href="https://example.com/b" rel="noopener noreferrer">Title B</a></h3>
      <p class="content">Snippet for B</p>
      <div class="engines"><span>Brave</span></div>
    </article>
  `;

  it("extracts results from HTML", () => {
    const results = parseResults(sampleHtml, 10);
    expect(results.length).toBe(2);

    expect(results[0].title).toBe("Title A");
    expect(results[0].url).toBe("https://example.com/a");
    expect(results[0].snippet).toBe("Snippet for A");
    expect(results[0].engines).toEqual(["DuckDuckGo", "Google"]);
    expect(results[0].publishedDate).toBe("2024-01-01");

    expect(results[1].title).toBe("Title B");
    expect(results[1].engines).toEqual(["Brave"]);
    expect(results[1].publishedDate).toBeUndefined();
  });

  it("respects maxResults", () => {
    const results = parseResults(sampleHtml, 1);
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Title A");
  });

  it("returns empty array for non-matching HTML", () => {
    expect(parseResults("<html><body>No results here</body></html>", 10)).toEqual([]);
  });
});

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
    expect(formatted).toContain('### 1. Foo (2023-06-15)');
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

describe("searchSearXNG (integration)", () => {
  it("returns search results from the configured SearXNG instance", async () => {
    const result = await searchSearXNG("hello world", { maxResults: 3 });
    expect(typeof result.totalResults).toBe("number");
    expect(result.query).toBe("hello world");
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThanOrEqual(0);

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
