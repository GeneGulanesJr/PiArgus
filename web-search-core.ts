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

// ─── Compact formatting for WEB_Search (discovery) ────────────────────────────

/** Extract the domain+path prefix from a URL for compact display */
export function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    // Show domain + first path segment, e.g. "docs.python.org/3/library"
    const pathParts = u.pathname.split("/").filter(Boolean);
    const shortPath = pathParts.slice(0, 2).join("/");
    return shortPath ? `${u.hostname}/${shortPath}` : u.hostname;
  } catch {
    return url;
  }
}

/** Truncate text to maxLen chars, adding ellipsis if truncated */
function truncate(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text;
  // Try to break at a word boundary near maxLen
  const cut = text.lastIndexOf(" ", maxLen);
  const pos = cut > maxLen * 0.5 ? cut : maxLen;
  return text.slice(0, pos).trimEnd() + "...";
}

/**
 * Compact one-line-per-result format for WEB_Search.
 * Designed for discovery: just enough to decide which results are relevant.
 * Full URLs and snippets are available in the `details` field.
 */
export function formatResultsCompact(searchResult: SearchResponse): string {
  const { results, totalResults, query } = searchResult;

  if (results.length === 0) {
    return `No results found for "${query}".`;
  }

  const lines: string[] = [
    `Results for "${query}" (${totalResults} total, showing ${results.length}):`,
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const domain = extractDomain(r.url);
    const snippet = r.snippet ? truncate(r.snippet, 80) : "";
    const dateStr = r.publishedDate ? ` ${r.publishedDate}` : "";
    const engines = r.engines.length > 0 ? ` [${r.engines.slice(0, 3).join(",")}]` : "";

    // One line: number. Title — domain — "snippet..." [engines]
    const parts = [`${i + 1}. ${r.title}${dateStr}`];
    if (domain) parts.push(`— ${domain}`);
    if (snippet) parts.push(`— "${snippet}"`);
    lines.push(parts.join(" ") + engines);
  }

  return lines.join("\n");
}

/**
 * Verbose multi-line format for detailed results.
 * Kept for backward compatibility and for WEB_Research detailed output.
 */
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

// ─── WEB_Research: deep search with extraction ────────────────────────────────

export interface ResearchOptions {
  /** Max number of search results to fetch pages from (default: 3) */
  depth?: number;
  /** Max total chars of extracted content to return (default: 4000) */
  maxContentChars?: number;
  /** Whether to use stealth mode for fetching (default: false) */
  stealth?: boolean;
}

export interface ResearchResult {
  query: string;
  summary: string;
  sources: Array<{
    title: string;
    url: string;
    domain: string;
    relevanceScore: number;
    extractedChars: number;
    error?: string;
  }>;
  totalContentChars: number;
  searchResults: number;
  fetchedPages: number;
}

/**
 * Deep research: search → fetch top N pages → extract relevant content.
 * Uses keyword-overlap scoring to return only the most relevant paragraphs.
 */
export async function researchQuery(
  query: string,
  searchOptions: {
    categories?: string;
    language?: string;
    timeRange?: string;
  },
  researchOptions: ResearchOptions,
  fetchPageText: (url: string, opts?: { stealth?: boolean }) => Promise<{ text: string; error?: string }>
): Promise<ResearchResult> {
  const depth = researchOptions.depth ?? 3;
  const maxContentChars = researchOptions.maxContentChars ?? 4000;

  // Step 1: Search
  const searchResult = await searchSearXNG(query, {
    ...searchOptions,
    maxResults: depth,
  });

  if (searchResult.results.length === 0) {
    return {
      query,
      summary: `No search results found for "${query}".`,
      sources: [],
      totalContentChars: 0,
      searchResults: 0,
      fetchedPages: 0,
    };
  }

  // Extract query keywords for relevance scoring
  const queryKeywords = extractKeywords(query.toLowerCase());

  // Step 2: Fetch pages in parallel
  const fetchPromises = searchResult.results.slice(0, depth).map(async (r) => {
    const result = await fetchPageText(r.url, { stealth: researchOptions.stealth });
    return {
      title: r.title,
      url: r.url,
      domain: extractDomain(r.url),
      text: result.text,
      error: result.error,
    };
  });

  const fetchedPages = await Promise.all(fetchPromises);

  // Step 3: Extract relevant paragraphs using keyword scoring
  const allParagraphs: Array<{
    text: string;
    score: number;
    source: { title: string; url: string; domain: string };
  }> = [];

  for (const page of fetchedPages) {
    if (page.error || !page.text) continue;

    const paragraphs = page.text
      .split(/\n{2,}/) // Split on double newlines
      .map(p => p.trim())
      .filter(p => p.length > 40 && p.length < 2000); // Filter noise

    for (const para of paragraphs) {
      const score = scoreParagraph(para.toLowerCase(), queryKeywords);
      if (score > 0) {
        allParagraphs.push({
          text: para,
          score,
          source: { title: page.title, url: page.url, domain: page.domain },
        });
      }
    }
  }

  // Sort by relevance score, then take top paragraphs up to budget
  allParagraphs.sort((a, b) => b.score - a.score);

  let totalChars = 0;
  const selected: Array<{ text: string; score: number; source: typeof allParagraphs[0]['source'] }> = [];
  for (const p of allParagraphs) {
    if (totalChars + p.text.length > maxContentChars) break;
    selected.push(p);
    totalChars += p.text.length;
  }

  // Build the summary
  const sourceSummary = fetchedPages.map(p => {
    const extracted = selected.filter(s => s.source.url === p.url);
    return {
      title: p.title,
      url: p.url,
      domain: p.domain,
      relevanceScore: extracted.length > 0 ? Math.max(...extracted.map(e => e.score)) : 0,
      extractedChars: extracted.reduce((sum, e) => sum + e.text.length, 0),
      error: p.error,
    };
  });

  const successfulFetches = fetchedPages.filter(p => !p.error && p.text).length;

  let summary: string;
  if (selected.length === 0) {
    summary = `Researched "${query}" — found ${searchResult.results.length} results, fetched ${successfulFetches} pages, but no highly relevant content was extractable. Try refining the query or using browser_fetch on specific URLs.`;
  } else {
    const lines: string[] = [
      `Research for "${query}" — ${searchResult.results.length} results, fetched ${successfulFetches} pages:`,
      "",
    ];

    for (const s of selected) {
      lines.push(`[${s.source.domain}] ${s.text}`);
      lines.push("");
    }

    lines.push("Sources:");
    for (const src of sourceSummary) {
      if (src.error) {
        lines.push(`- ${src.domain} — error: ${src.error}`);
      } else {
        lines.push(`- ${src.domain} — relevance: ${src.relevanceScore.toFixed(1)} — ${src.title}`);
      }
    }

    summary = lines.join("\n");
  }

  return {
    query,
    summary,
    sources: sourceSummary,
    totalContentChars: totalChars,
    searchResults: searchResult.results.length,
    fetchedPages: successfulFetches,
  };
}

// ─── Keyword extraction & scoring ────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "as", "be", "was", "were",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "can", "this", "that",
  "these", "those", "i", "you", "he", "she", "we", "they", "what",
  "which", "who", "when", "where", "how", "why", "not", "no", "nor",
  "if", "so", "than", "too", "very", "just", "about", "also", "there",
]);

/** Extract meaningful keywords from a query string */
function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));
}

/** Score a paragraph's relevance to the query keywords */
function scoreParagraph(text: string, keywords: string[]): number {
  let score = 0;
  for (const kw of keywords) {
    const count = (text.match(new RegExp(kw, "gi")) || []).length;
    score += count * (kw.length > 5 ? 2 : 1); // Longer keywords score higher
  }
  // Boost paragraphs with multiple keyword hits (topic relevance)
  const uniqueHits = keywords.filter(kw => text.includes(kw)).length;
  if (uniqueHits >= Math.ceil(keywords.length * 0.5)) score += 5; // Majority match bonus
  if (uniqueHits >= keywords.length) score += 10; // All keywords match
  return score;
}
