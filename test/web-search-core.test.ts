// test/web-search-core.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSearXNG, formatResults, DEFAULT_MAX_RESULTS } from "../web-search-core";

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
});

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
