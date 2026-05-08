// web-search.ts — SearXNG search tool registration for PiArgus
//
// This thin wrapper imports the pure logic from web-search-core.ts and binds it
// to Pi's ExtensionAPI / TypeBox schema layer. It also auto-ensures the SearXNG
// search VM is running before each search (lazy-loaded smolvm).

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { searchSearXNG, formatResults, DEFAULT_MAX_RESULTS, type SearchResponse } from "./web-search-core";
import { ensureSearchVm, SEARXNG_LOCAL_URL, isSmolvmInstalled } from "./smolvm";

export { searchSearXNG, formatResults, DEFAULT_MAX_RESULTS } from "./web-search-core";
export type { SearchResult, SearchResponse } from "./web-search-core";

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
      const configuredUrl = process.env.SEARXNG_URL;
      const useLocalSmolvm = !configuredUrl || configuredUrl === SEARXNG_LOCAL_URL;
      let searxngUrl = configuredUrl || SEARXNG_LOCAL_URL;

      // Auto-ensure the SearXNG search VM if using the local smolvm instance
      if (useLocalSmolvm && isSmolvmInstalled()) {
        const ensure = await ensureSearchVm();
        if (!ensure.running) {
          return {
            content: [{
              type: "text" as const,
              text: `Failed to start SearXNG search VM: ${ensure.error}\n` +
                `Set SEARXNG_URL to point to an external SearXNG instance, or install smolvm.`,
            }],
            details: { query: params.query, error: ensure.error },
            isError: true,
          };
        }
        searxngUrl = ensure.url || SEARXNG_LOCAL_URL;
      }

      try {
        const searchResult = await searchSearXNG(params.query, {
          categories: params.categories,
          language: params.language,
          timeRange: params.time_range,
          maxResults: params.max_results,
        });

        const formatted = formatResults(searchResult);

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