// web-search-core.ts — SearXNG search with JSON API primary + HTML fallback

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
  // If SEARXNG_URL is explicitly set, respect it (allows pointing to any SearXNG instance)
  // Otherwise default to the local smolvm search VM on port 8888
  return process.env.SEARXNG_URL || "http://localhost:8888";
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

  // If JSON API is disabled (403), fall back to HTML scraping
  if (response.status === 403) {
    return searchSearXNGHtml(query, options, maxResults);
  }

  if (!response.ok) {
    throw new Error(`SearXNG returned HTTP ${response.status}: ${response.statusText}`);
  }

  const json = (await response.json()) as SearXNGJsonResponse;
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

// ─── HTML scraping fallback ──────────────────────────────────────────────────

/** Parse SearXNG HTML search results into SearchResult[] */
function parseHtmlResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // SearXNG wraps each result in an <article class="result">
  const resultRegex = /<article[^>]*class="result[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  // URL from <a class="url_header" href="...">
  const urlHeaderRegex = /<a[^>]*href="([^"]+)"[^>]*class="url_header"[^>]*>/;
  // Title from <h3><a href="...">Title</a></h3>
  const titleRegex = /<h3[^>]*><a[^>]*href="[^"]+"[^>]*>([\s\S]*?)<\/a><\/h3>/i;
  // Snippet from <p class="content">...</p>
  const snippetRegex = /<p[^>]*class="content"[^>]*>([\s\S]*?)<\/p>/i;
  // Engines from <span>google</span> inside <div class="engines">
  const engineRegex = /<div[^>]*class="engines"[^>]*>([\s\S]*?)<\/div>/i;
  const engineSpanRegex = /<span>([\s\S]*?)<\/span>/gi;

  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html)) !== null) {
    const block = match[1];

    // Extract URL from url_header link
    const urlMatch = urlHeaderRegex.exec(block);
    const url = urlMatch ? urlMatch[1] : "";

    // Extract title
    const titleMatch = titleRegex.exec(block);
    const title = titleMatch
      ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, "").trim())
      : "";

    // Extract snippet/content
    const snippetMatch = snippetRegex.exec(block);
    const snippet = snippetMatch
      ? decodeHtmlEntities(snippetMatch[1].replace(/<[^>]+>/g, "").trim())
      : "";

    // Extract engine names
    const engines: string[] = [];
    const enginesBlock = engineRegex.exec(block);
    if (enginesBlock) {
      let engMatch: RegExpExecArray | null;
      while ((engMatch = engineSpanRegex.exec(enginesBlock[1])) !== null) {
        const name = engMatch[1].replace(/<[^>]+>/g, "").trim();
        if (name) engines.push(name);
      }
      engineSpanRegex.lastIndex = 0;
    }

    if (url && title) {
      results.push({ title, url, snippet, engines });
    }
  }

  // Fallback: try a simpler parser for different SearXNG themes
  if (results.length === 0) {
    const simpleLinkRegex = /<h3[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>/gi;
    const simpleSnippetRegex = /<p[^>]*class="content"[^>]*>([\s\S]*?)<\/p>/gi;
    const links: Array<{ url: string; title: string }> = [];

    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = simpleLinkRegex.exec(html)) !== null) {
      links.push({
        url: linkMatch[1],
        title: decodeHtmlEntities(linkMatch[2].replace(/<[^>]+>/g, "").trim()),
      });
    }

    // Match snippets by position
    const snippets: string[] = [];
    let snipMatch: RegExpExecArray | null;
    while ((snipMatch = simpleSnippetRegex.exec(html)) !== null) {
      const text = snipMatch[1].replace(/<[^>]+>/g, "").trim();
      if (text.length > 20) snippets.push(decodeHtmlEntities(text));
    }

    for (let i = 0; i < Math.min(links.length, 10); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || "",
        engines: [],
      });
    }
  }

  return results;
}

/** Decode common HTML entities */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Fallback: scrape SearXNG HTML when JSON API is disabled (403) */
async function searchSearXNGHtml(
  query: string,
  options: {
    categories?: string;
    language?: string;
    timeRange?: string;
    maxResults?: number;
    pageno?: number;
  },
  maxResults: number
): Promise<SearchResponse> {
  const baseUrl = getSearXNGUrl();

  const params = new URLSearchParams();
  params.set("q", query);
  params.set("format", "html");  // Explicit HTML format
  params.set("safesearch", "0");
  if (options.language) params.set("language", options.language);
  if (options.categories) params.set("categories", options.categories);
  else params.set("category_general", "1");
  if (options.timeRange) params.set("time_range", options.timeRange);
  if (options.pageno && options.pageno > 1) params.set("pageno", String(options.pageno));

  const response = await fetch(`${baseUrl}/search?${params.toString()}`, {
    headers: {
      "Accept": "text/html",
      "User-Agent": "PiArgus/2.0 (Web Search Tool)",
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`SearXNG HTML fallback returned HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const results = parseHtmlResults(html).slice(0, maxResults);

  return {
    results,
    totalResults: results.length,
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
