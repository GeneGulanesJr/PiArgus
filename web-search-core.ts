// web-search-core.ts — Pure SearXNG search logic using JSON API (no HTML scraping)

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engines: string[];
  publishedDate?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  totalResults: number;
  query: string;
}

/** Raw JSON response from SearXNG's JSON API */
interface SearXNGJsonResult {
  title: string;
  url: string;
  content: string;
  engines: string[];
  publishedDate?: string;
  category?: string;
}

interface SearXNGJsonResponse {
  query: string;
  number_of_results: number;
  results: SearXNGJsonResult[];
  answers: string[];
  suggestions: string[];
  unresponsive_engines: string[];
}

function getSearXNGUrl(): string {
  return process.env.SEARXNG_URL || "http://192.168.100.105:30053";
}

export const DEFAULT_MAX_RESULTS = 10;
const SEARCH_TIMEOUT_MS = 30_000;

export async function searchSearXNG(
  query: string,
  options: {
    categories?: string;
    language?: string;
    timeRange?: string;
    maxResults?: number;
    pageno?: number;
  }
): Promise<SearchResponse> {
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const baseUrl = getSearXNGUrl();

  const params = new URLSearchParams();
  params.set("q", query);
  params.set("format", "json");          // ← JSON API instead of HTML
  params.set("safesearch", "0");
  params.set("language", options.language ?? "auto");

  if (options.categories) {
    params.set("categories", options.categories);
  } else {
    params.set("category_general", "1");
  }

  if (options.timeRange) {
    params.set("time_range", options.timeRange);
  }

  if (options.pageno && options.pageno > 1) {
    params.set("pageno", String(options.pageno));
  }

  const response = await fetch(`${baseUrl}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "User-Agent": "PiArgus/2.0 (Web Search Tool)",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`SearXNG returned HTTP ${response.status}: ${response.statusText}`);
  }

  const json = await response.json() as SearXNGJsonResponse;
  const rawResults = json.results || [];

  // Slice and map JSON API's "content" → our "snippet"
  const results: SearchResult[] = rawResults.slice(0, maxResults).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.content || "",
    engines: r.engines || [],
    publishedDate: r.publishedDate || undefined,
  }));

  return {
    results,
    totalResults: json.number_of_results ?? results.length,
    query,
  };
}

export function formatResults(searchResult: SearchResponse): string {
  const { results, totalResults, query } = searchResult;

  if (results.length === 0) {
    return `No results found for "${query}".`;
  }

  const lines: string[] = [
    `Web search results for "${query}" (${totalResults} total results, showing top ${results.length}):`,
    "",
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const dateStr = r.publishedDate ? ` (${r.publishedDate})` : "";
    const enginesStr = r.engines.length > 0 ? `[${r.engines.join(", ")}]` : "";

    lines.push(`### ${i + 1}. ${r.title}${dateStr}`);
    lines.push(`**URL:** ${r.url}`);
    if (r.snippet) lines.push(`**Snippet:** ${r.snippet}`);
    if (enginesStr) lines.push(`**Source:** ${enginesStr}`);
    lines.push("");
  }

  return lines.join("\n");
}
