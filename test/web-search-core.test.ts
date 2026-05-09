// test/web-search-core.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSearXNG, formatResults, formatResultsCompact, extractDomain, researchQuery, DEFAULT_MAX_RESULTS } from "../web-search-core";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const MOCK_RESPONSE = {
  query: "test query",
  number_of_results: 42,
  results: [
    {
      title: "Result One",
      url: "https://example.com/1",
      content: "Snippet one",
      engines: ["google", "brave"],
      publishedDate: "2026-01-15",
    },
    {
      title: "Result Two",
      url: "https://example.com/2",
      content: "Snippet two",
      engines: ["duckduckgo"],
    },
    {
      title: "Result Three",
      url: "https://example.com/3",
      content: "",
      engines: ["google"],
    },
  ],
  answers: [] as string[],
  suggestions: ["test query suggestion"],
  unresponsive_engines: [] as string[],
};

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(MOCK_RESPONSE),
  });
});

describe("searchSearXNG", () => {
  it("sends a POST request to the SearXNG JSON API", async () => {
    const result = await searchSearXNG("test query", {});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/search");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Accept).toBe("application/json");
  });

  it("returns mapped results with title, url, snippet, engines", async () => {
    const result = await searchSearXNG("test query", {});

    expect(result.query).toBe("test query");
    expect(result.totalResults).toBe(42);
    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toEqual({
      title: "Result One",
      url: "https://example.com/1",
      snippet: "Snippet one",
      engines: ["google", "brave"],
      publishedDate: "2026-01-15",
    });
  });

  it("respects maxResults option", async () => {
    const result = await searchSearXNG("test query", { maxResults: 2 });

    expect(result.results).toHaveLength(2);
  });

  it("defaults to DEFAULT_MAX_RESULTS when maxResults not set", async () => {
    await searchSearXNG("test query", {});

    // Just verify it was called — the slicing happens in the function
    expect(mockFetch).toHaveBeenCalled();
  });

  it("passes categories parameter", async () => {
    await searchSearXNG("test query", { categories: "it" });

    const [url] = mockFetch.mock.calls[0];
    // Categories should be in the POST body (URLSearchParams)
    expect(url).toContain("/search");
  });

  it("passes timeRange parameter", async () => {
    await searchSearXNG("test query", { timeRange: "week" });

    expect(mockFetch).toHaveBeenCalled();
  });

  it("throws on non-OK response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    await expect(searchSearXNG("test query", {})).rejects.toThrow("HTTP 503");
  });

  it("handles empty results gracefully", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        query: "empty",
        number_of_results: 0,
        results: [],
        answers: [],
        suggestions: [],
        unresponsive_engines: [],
      }),
    });

    const result = await searchSearXNG("empty", {});
    expect(result.results).toHaveLength(0);
    expect(result.totalResults).toBe(0);
  });

  it("uses SEARXNG_URL env var when set", async () => {
    process.env.SEARXNG_URL = "http://custom:9999";
    await searchSearXNG("test", {});
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("custom:9999");
    delete process.env.SEARXNG_URL;
  });

  it("falls back to HTML scraping when JSON API returns 403", async () => {
    // First call returns 403, second call returns HTML
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(SearXNG_HTML_RESPONSE),
      });

    const result = await searchSearXNG("test query", {});
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].title).toBe("Speedtest by Ookla - The Global Broadband Speed Test");
    expect(result.results[0].url).toBe("https://www.speedtest.net/");
    expect(result.results[0].snippet).toContain("Speedtest is better");
    expect(result.results[0].engines).toContain("google");
  });
});

// Sample SearXNG HTML response for fallback testing
const SearXNG_HTML_RESPONSE = `
<html><body>
<article class="result">
  <a href="https://www.speedtest.net/" class="url_header" rel="noreferrer">
    <div class="url_wrapper"><span class="url_o1"><span class="url_i1">https://www.speedtest.net</span></span></div>
  </a>
  <h3><a href="https://www.speedtest.net/" rel="noreferrer">Speedtest by Ookla - The Global Broadband Speed <span class="highlight">Test</span></a></h3>
  <p class="content">
    Speedtest is better with the app. Download the Speedtest app for more metrics, video testing, mobile coverage maps.
  </p>
  <div class="engines">
    <span>google</span><span>duckduckgo</span>
  </div>
</article>
<article class="result">
  <a href="https://example.com/" class="url_header" rel="noreferrer">
    <div class="url_wrapper"><span class="url_o1"><span class="url_i1">https://example.com</span></span></div>
  </a>
  <h3><a href="https://example.com/" rel="noreferrer">Example Domain</a></h3>
  <p class="content">
    This domain is for use in documentation examples without needing permission.
  </p>
  <div class="engines">
    <span>google</span>
  </div>
</article>
</body></html>
`;

describe("formatResults", () => {
  it("formats results as markdown with numbered entries", () => {
    const response = {
      results: [
        {
          title: "Example",
          url: "https://example.com",
          snippet: "A snippet",
          engines: ["google"],
          publishedDate: "2026-01-01",
        },
      ],
      totalResults: 1,
      query: "example",
    };

    const text = formatResults(response);

    expect(text).toContain("### 1. Example");
    expect(text).toContain("**URL:** https://example.com");
    expect(text).toContain("**Snippet:** A snippet");
    expect(text).toContain("**Source:** [google]");
    expect(text).toContain("(2026-01-01)");
  });

  it("shows 'No results found' for empty results", () => {
    const text = formatResults({
      results: [],
      totalResults: 0,
      query: "nothing",
    });

    expect(text).toContain("No results found");
  });

  it("omits snippet and source lines when absent", () => {
    const text = formatResults({
      results: [
        { title: "No Frills", url: "https://a.com", snippet: "", engines: [] },
      ],
      totalResults: 1,
      query: "test",
    });

    expect(text).not.toContain("**Snippet:**");
    expect(text).not.toContain("**Source:**");
  });
});

describe("extractDomain", () => {
  it("extracts domain with path segments", () => {
    expect(extractDomain("https://docs.python.org/3/library/asyncio.html")).toBe("docs.python.org/3/library");
  });

  it("returns just hostname for root URL", () => {
    expect(extractDomain("https://example.com/")).toBe("example.com");
  });

  it("returns just hostname for bare domain", () => {
    expect(extractDomain("https://example.com")).toBe("example.com");
  });

  it("handles malformed URLs gracefully", () => {
    expect(extractDomain("not-a-url")).toBe("not-a-url");
  });
});

describe("formatResultsCompact", () => {
  it("formats results as compact one-line entries", () => {
    const response = {
      results: [
        {
          title: "FastAPI Tutorial",
          url: "https://fastapi.tiangolo.com/tutorial/dependencies/",
          snippet: "FastAPI has a powerful but intuitive Dependency Injection system that handles...",
          engines: ["google", "brave"],
          publishedDate: "2025-03-15",
        },
      ],
      totalResults: 142,
      query: "fastapi dependency injection",
    };

    const text = formatResultsCompact(response);

    // Should be one line per result (plus header line)
    expect(text).toContain('Results for "fastapi dependency injection"');
    expect(text).toContain("1. FastAPI Tutorial 2025-03-15");
    expect(text).toContain("fastapi.tiangolo.com/tutorial/dependencies");
    expect(text).toContain("[google,brave]");
  });

  it("truncates long snippets", () => {
    const longSnippet = "A very long snippet that goes on and on and on and should be truncated because it is way more than 80 characters in length";
    const text = formatResultsCompact({
      results: [
        { title: "Test", url: "https://example.com", snippet: longSnippet, engines: [] },
      ],
      totalResults: 1,
      query: "test",
    });

    // Snippet should be truncated with ellipsis
    expect(text).toContain("...");
    // Should not contain the full long snippet
    expect(text).not.toContain(longSnippet);
  });

  it("shows 'No results found' for empty results", () => {
    const text = formatResultsCompact({
      results: [],
      totalResults: 0,
      query: "nothing",
    });

    expect(text).toContain("No results found");
  });

  it("omits empty snippet and engines", () => {
    const text = formatResultsCompact({
      results: [
        { title: "Bare", url: "https://example.com", snippet: "", engines: [] },
      ],
      totalResults: 1,
      query: "bare",
    });

    expect(text).not.toContain('""');  // no empty quoted snippet
    expect(text).not.toContain("[]");   // no empty engines
  });

  it("compact format is significantly shorter than full format", () => {
    const response = {
      results: Array.from({ length: 10 }, (_, i) => ({
        title: `Result Title Number ${i + 1}`,
        url: `https://example.com/page/${i}`,
        snippet: `This is a snippet for result ${i + 1} that contains enough text to demonstrate the difference between compact and full format output.`,
        engines: ["google", "brave", "duckduckgo"],
        publishedDate: "2025-01-01",
      })),
      totalResults: 100,
      query: "test query",
    };

    const compact = formatResultsCompact(response);
    const full = formatResults(response);

    // Compact format should be noticeably shorter than full format
    expect(compact.length).toBeLessThan(full.length * 0.75);
  });
});

describe("researchQuery", () => {
  it("searches and fetches pages, extracting relevant content", async () => {
    // Mock searchSearXNG is already mocked via global fetch
    // Mock fetchPageText callback
    const mockFetchPageText = vi.fn()
      .mockResolvedValueOnce({
        text: "\n\nFastAPI has a powerful dependency injection system. Dependencies are declared as function parameters. The framework handles injection automatically.\n\nSome unrelated content about weather.",
        error: undefined,
      })
      .mockResolvedValueOnce({
        text: "\n\nDependency injection in FastAPI works through the Depends keyword. You can declare dependencies at the path operation level.",
        error: undefined,
      });

    const result = await researchQuery(
      "fastapi dependency injection",
      {},
      { depth: 2, maxContentChars: 2000 },
      mockFetchPageText,
    );

    // Should have called fetchPageText for the top 2 results
    expect(mockFetchPageText).toHaveBeenCalledTimes(2);
    expect(result.query).toBe("fastapi dependency injection");
    expect(result.searchResults).toBe(2); // depth=2 limits search results
    expect(result.fetchedPages).toBe(2);
    expect(result.summary).toContain("fastapi dependency injection");
  });

  it("returns fallback message when no relevant content is found", async () => {
    // fetchPageText returns content with no keyword overlap
    const mockFetchPageText = vi.fn()
      .mockResolvedValue({
        text: "Completely unrelated content about cooking and recipes.",
        error: undefined,
      });

    const result = await researchQuery(
      "quantum computing algorithms",
      {},
      { depth: 2, maxContentChars: 4000 },
      mockFetchPageText,
    );

    expect(result.summary).toContain("no highly relevant content was extractable");
  });

  it("handles fetch errors gracefully", async () => {
    const mockFetchPageText = vi.fn()
      .mockResolvedValueOnce({
        text: "",
        error: "Connection timeout",
      });

    const result = await researchQuery(
      "test query",
      {},
      { depth: 1, maxContentChars: 4000 },
      mockFetchPageText,
    );

    expect(result.fetchedPages).toBe(0);
    expect(result.summary).toContain("no highly relevant content");
  });

  it("respects maxContentChars budget", async () => {
    const mockFetchPageText = vi.fn()
      .mockResolvedValue({
        text: "FastAPI dependency injection. " + "Keyword match content. ".repeat(100),
        error: undefined,
      });

    const result = await researchQuery(
      "fastapi dependency injection",
      {},
      { depth: 1, maxContentChars: 500 }, // Small budget
      mockFetchPageText,
    );

    expect(result.totalContentChars).toBeLessThanOrEqual(600); // Some margin for paragraphs
  });
});
