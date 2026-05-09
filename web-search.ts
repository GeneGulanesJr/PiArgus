// web-search.ts — SearXNG search + research tool registration for PiArgus
//
// Two tools:
//   WEB_Search  — compact discovery: titles, domains, ~80 char snippets
//   WEB_Research — deep dive: search → fetch top N → keyword-extract relevant content
//
// Thin wrapper imports pure logic from web-search-core.ts and binds it
// to Pi's ExtensionAPI / TypeBox schema layer.

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  searchSearXNG,
  formatResultsCompact,
  researchQuery,
  DEFAULT_MAX_RESULTS,
  type SearchResponse,
} from "./web-search-core";
import { ensureSearchVm, SEARXNG_LOCAL_URL, isSmolvmInstalled } from "./smolvm";
import { fetchText } from "./obscura";

export { searchSearXNG, formatResultsCompact, DEFAULT_MAX_RESULTS } from "./web-search-core";
export type { SearchResult, SearchResponse } from "./web-search-core";

// ─── Shared: auto-ensure SearXNG VM ──────────────────────────────────────────

async function ensureSearXNG(): Promise<{ url: string | null; error?: string }> {
  const configuredUrl = process.env.SEARXNG_URL;
  const useLocalSmolvm = !configuredUrl || configuredUrl === SEARXNG_LOCAL_URL;

  if (useLocalSmolvm && isSmolvmInstalled()) {
    const ensure = await ensureSearchVm();
    if (!ensure.running) {
      return {
        url: null,
        error: `Failed to start SearXNG search VM: ${ensure.error}\n` +
          `Set SEARXNG_URL to point to an external SearXNG instance, or install smolvm.`,
      };
    }
    return { url: ensure.url || SEARXNG_LOCAL_URL };
  }

  return { url: configuredUrl || SEARXNG_LOCAL_URL };
}

// ─── TOOL: WEB_Search (compact discovery) ────────────────────────────────────

export function registerWebSearch(pi: ExtensionAPI) {
  pi.registerTool({
    name: "WEB_Search",
    label: "Web Search",
    description:
      "Search the web using a SearXNG metasearch engine. Returns results with " +
      "titles, URLs, and snippets from multiple search engines (Google, Brave, " +
      "DuckDuckGo, etc.). Use this to find current information, documentation, " +
      "solutions, or any web content. The SearXNG instance aggregates results " +
      "from multiple search engines for better coverage.",
    promptSnippet: "Search the web for current information, documentation, or solutions",
    promptGuidelines: [
      "Use WEB_Search when you need current information not available in the codebase or indexed docs.",
      "Prefer specific queries over vague ones for better results.",
      "Use categories like 'it', 'science', or 'news' to narrow results when appropriate.",
      "You can search for error messages, library docs, API references, or general knowledge.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description:
          "The search query. Be specific for best results. Examples: " +
          "'FastAPI dependency injection tutorial', 'Python asyncio subprocess timeout error'.",
      }),
      categories: Type.Optional(
        Type.Union(
          [
            Type.Literal("general"),
            Type.Literal("images"),
            Type.Literal("videos"),
            Type.Literal("news"),
            Type.Literal("map"),
            Type.Literal("music"),
            Type.Literal("it"),
            Type.Literal("science"),
            Type.Literal("files"),
            Type.Literal("social media"),
          ],
          {
            description:
              "Search category. Use 'it' for programming/tech, 'news' for recent events, " +
              "'science' for academic, 'general' for everything. Default: general.",
          }
        )
      ),
      language: Type.Optional(
        Type.String({
          description:
            "Search language code. Examples: 'en', 'auto', 'de', 'fr', 'es'. Default: auto.",
        })
      ),
      time_range: Type.Optional(
        Type.Union(
          [Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")],
          {
            description:
              "Restrict results to a time range. Use 'day' for very recent, " +
              "'week' for last 7 days, 'month' for last 30 days, 'year' for last year.",
          }
        )
      ),
      max_results: Type.Optional(
        Type.Number({
          description: `Maximum number of results to return (1-20). Default: ${DEFAULT_MAX_RESULTS}.`,
          minimum: 1,
          maximum: 20,
        })
      ),
    }),

    async execute(_toolCallId, params, _signal) {
      const { url: searxngUrl, error: vmError } = await ensureSearXNG();

      if (vmError) {
        return {
          content: [{ type: "text" as const, text: vmError }],
          details: { query: params.query, error: vmError },
          isError: true,
        };
      }

      try {
        const searchResult = await searchSearXNG(params.query, {
          categories: params.categories,
          language: params.language,
          timeRange: params.time_range,
          maxResults: params.max_results,
        });

        // Use compact one-line-per-result format to minimize context burn
        const formatted = formatResultsCompact(searchResult);

        return {
          content: [{ type: "text" as const, text: formatted }],
          details: {
            query: params.query,
            totalResults: searchResult.totalResults,
            returnedResults: searchResult.results.length,
            results: searchResult.results,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isTimeout =
          message.includes("abort") ||
          message.includes("timeout") ||
          message.includes("Abort");
        return {
          content: [{
            type: "text" as const,
            text: isTimeout
              ? `Web search timed out for "${params.query}". The SearXNG instance at ${searxngUrl} may be slow or unreachable. Try a simpler query or check the server.`
              : `Web search failed for "${params.query}": ${message}`,
          }],
          details: { query: params.query, error: message },
          isError: true,
        };
      }
    },
  });
}

// ─── TOOL: WEB_Research (deep search with extraction) ────────────────────────

export function registerWebResearch(pi: ExtensionAPI) {
  pi.registerTool({
    name: "WEB_Research",
    label: "Web Research",
    description:
      "Deep web research: searches the web, fetches the most relevant pages, " +
      "and returns only the content that matches your query. Uses keyword-scoring " +
      "to extract relevant paragraphs, keeping context usage minimal. " +
      "Use this when you need detailed answers, not just search results.",
    promptSnippet: "Research a topic in depth with source extraction",
    promptGuidelines: [
      "Use WEB_Research when you need detailed information, not just search result titles.",
      "Good for answering specific questions where you need to read and synthesize web content.",
      "Works best with specific queries — 'Python asyncio subprocess timeout handling' over 'asyncio subprocess'.",
      "Returns only relevant paragraphs scored against your query, minimizing context pollution.",
      "For quick discovery, use WEB_Search instead. For depth, use WEB_Research.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description:
          "The research query. Be specific for best extraction. Examples: " +
          "'How does Rust's borrow checker work', 'FastAPI dependency injection best practices'.",
      }),
      categories: Type.Optional(
        Type.Union(
          [
            Type.Literal("general"),
            Type.Literal("it"),
            Type.Literal("science"),
            Type.Literal("news"),
          ],
          {
            description: "Search category. 'it' for tech, 'science' for academic, 'general' for everything.",
          }
        )
      ),
      language: Type.Optional(
        Type.String({
          description: "Search language code. Default: 'auto'.",
        })
      ),
      time_range: Type.Optional(
        Type.Union(
          [Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")],
          {
            description: "Restrict results to a time range.",
          }
        )
      ),
      depth: Type.Optional(
        Type.Number({
          description: "Number of search results to fetch pages from (1-5). Default: 3. More = deeper but slower.",
          minimum: 1,
          maximum: 5,
        })
      ),
      max_content_chars: Type.Optional(
        Type.Number({
          description: "Max total characters of extracted content to return. Default: 4000. Controls context usage.",
          minimum: 1000,
          maximum: 8000,
        })
      ),
      stealth: Type.Optional(
        Type.Boolean({
          description: "Enable anti-detection when fetching pages. Default: false.",
        })
      ),
    }),

    async execute(_toolCallId, params, _signal) {
      const { error: vmError } = await ensureSearXNG();

      if (vmError) {
        return {
          content: [{ type: "text" as const, text: vmError }],
          details: { query: params.query, error: vmError },
          isError: true,
        };
      }

      try {
        const result = await researchQuery(
          params.query,
          {
            categories: params.categories,
            language: params.language,
            timeRange: params.time_range,
          },
          {
            depth: params.depth,
            maxContentChars: params.max_content_chars,
            stealth: params.stealth,
          },
          // Fetch page text using Obscura
          async (url, opts) => {
            const { stdout, stderr } = await fetchText(url, {
              stealth: opts?.stealth,
              timeout: 15_000,
            });
            if (stderr && !stdout) {
              return { text: "", error: stderr };
            }
            return { text: stdout, error: undefined };
          },
        );

        return {
          content: [{ type: "text" as const, text: result.summary }],
          details: {
            query: result.query,
            totalContentChars: result.totalContentChars,
            searchResults: result.searchResults,
            fetchedPages: result.fetchedPages,
            sources: result.sources,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: "text" as const,
            text: `Web research failed for "${params.query}": ${message}`,
          }],
          details: { query: params.query, error: message },
          isError: true,
        };
      }
    },
  });
}