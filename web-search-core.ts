// web-search-core.ts — Pure SearXNG search logic (no Pi/TypeBox deps)

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

function getSearXNGUrl(): string {
  return process.env.SEARXNG_URL || "http://192.168.100.105:30053";
}

const DEFAULT_MAX_RESULTS = 10;
const SEARCH_TIMEOUT_MS = 30_000;

export function stripHtml(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]*>/g, "")
    .trim();
}

export function parseResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const articleRegex = /<article[^>]*class="result[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;

  while ((match = articleRegex.exec(html)) !== null && results.length < maxResults) {
    const article = match[1];

    const titleMatch = article.match(
      /<h3[^>]*>\s*<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i
    );
    if (!titleMatch) continue;

    const url = titleMatch[1];
    const title = stripHtml(titleMatch[2]);
    if (!url || !title) continue;

    const snippetMatch = article.match(/<p\s+class="content">([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";

    const engines: string[] = [];
    const enginesMatch = article.match(/<div\s+class="engines">([\s\S]*?)<\/div>/i);
    if (enginesMatch) {
      const spanRegex = /<span>([^<]+)<\/span>/gi;
      let engineMatch: RegExpExecArray | null;
      while ((engineMatch = spanRegex.exec(enginesMatch[1])) !== null) {
        engines.push(engineMatch[1].trim());
      }
    }

    const dateMatch = article.match(
      /<time[^>]*class="published_date"[^>]*>\s*([\s\S]*?)\s*<\/time>/i
    );
    const publishedDate = dateMatch ? stripHtml(dateMatch[1]) : undefined;

    results.push({ title, url, snippet, engines, publishedDate });
  }

  return results;
}

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
  params.set("theme", "simple");
  params.set("safesearch", "0");
  params.set("language", options.language ?? "auto");

  if (options.categories) {
    params.set(`category_${options.categories}`, "1");
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
      "User-Agent": "PiArgus/2.0 (Web Search Tool)",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`SearXNG returned HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const results = parseResults(html, maxResults);

  let totalResults = results.length;
  const totalMatch = html.match(/(?:About\s+)?(\d[\d,]+)\s+results?/i);
  if (totalMatch) {
    totalResults = parseInt(totalMatch[1].replace(/,/g, ""), 10);
  }

  return { results, totalResults, query };
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
