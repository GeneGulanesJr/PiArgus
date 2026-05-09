// pidocs-core.ts — Resolver pipeline: built-in → SearXNG → fetch → extract

import {
  runResolvers,
  loadPidocsConfig,
  type ResolverResult,
  type PidocsConfig,
} from "./pidocs-resolvers";
import { extractInstallCommands, type InstallCommand } from "./pidocs-install-extract";
import { searchSearXNG, type SearchResponse } from "./web-search-core";
import { fetchText } from "./obscura";
import { ensureSearchVm, isSmolvmInstalled, SEARXNG_LOCAL_URL } from "./smolvm";

// ─── Config ──────────────────────────────────────────────────────────────────

let cachedConfig: PidocsConfig | null = null;

function getConfig(): PidocsConfig {
  if (!cachedConfig) {
    cachedConfig = loadPidocsConfig();
  }
  return cachedConfig;
}

/** Invalidate cached config (for testing or after config changes) */
export function invalidateConfigCache(): void {
  cachedConfig = null;
}

// ─── SearXNG availability ─────────────────────────────────────────────────────

async function ensureSearXNG(): Promise<{ url: string | null; error?: string }> {
  const config = getConfig();
  const configuredUrl = config.searxngUrl || process.env.SEARXNG_URL;
  const useLocalSmolvm = !configuredUrl || configuredUrl === SEARXNG_LOCAL_URL;

  if (useLocalSmolvm && isSmolvmInstalled()) {
    const ensure = await ensureSearchVm();
    if (!ensure.running) {
      return {
        url: null,
        error: `Failed to start SearXNG search VM: ${ensure.error}\nSet SEARXNG_URL or install smolvm.`,
      };
    }
    return { url: ensure.url || SEARXNG_LOCAL_URL };
  }

  return { url: configuredUrl || SEARXNG_LOCAL_URL };
}

// ─── Lookup result type ─────────────────────────────────────────────────────

export interface PidocsLookupResult {
  urls: string[];
  description?: string;
  resolver: string;
  name: string;
  type: string;
  searchResults?: SearchResponse["results"];
}

// ─── Install result type ─────────────────────────────────────────────────────

export interface PidocsInstallResult {
  description?: string;
  installCommands: InstallCommand[];
  sourceUrl: string;
  resolver: string;
  name: string;
  type: string;
}

// ─── Lookup pipeline ─────────────────────────────────────────────────────────

export async function resolveLookup(
  name: string,
  options?: { typeHint?: string; configOverride?: PidocsConfig }
): Promise<PidocsLookupResult> {
  const config = options?.configOverride || getConfig();

  // Step 1: Try built-in resolvers
  const resolverResult = runResolvers(name, { typeHint: options?.typeHint, config });

  if (resolverResult) {
    return {
      urls: resolverResult.urls,
      description: undefined, // Built-in resolvers don't fetch pages
      resolver: resolverResult.resolver,
      name,
      type: options?.typeHint || resolverResult.resolver,
    };
  }

  // Step 2: SearXNG fallback
  const { url: _searxngUrl, error: vmError } = await ensureSearXNG();

  if (vmError || !_searxngUrl) {
    return {
      urls: [],
      description: `No built-in resolver matched "${name}" and SearXNG is unavailable: ${vmError}`,
      resolver: "none",
      name,
      type: options?.typeHint || "unknown",
    };
  }

  try {
    const searchResult = await searchSearXNG(`install ${name}`, {
      categories: "it",
      maxResults: 5,
    });

    const urls = searchResult.results.map((r) => r.url);
    const description = searchResult.results
      .map((r) => r.snippet)
      .filter(Boolean)
      .join(" | ");

    return {
      urls,
      description: description || undefined,
      resolver: "searxng",
      name,
      type: options?.typeHint || "unknown",
      searchResults: searchResult.results,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      urls: [],
      description: `Search failed: ${message}. Try using WEB_Search directly.`,
      resolver: "searxng",
      name,
      type: options?.typeHint || "unknown",
    };
  }
}

// ─── Install pipeline ─────────────────────────────────────────────────────────

export async function resolveInstall(
  name: string,
  options?: { typeHint?: string; platform?: string; configOverride?: PidocsConfig }
): Promise<PidocsInstallResult> {
  const config = options?.configOverride || getConfig();
  const platformFilter = options?.platform && options.platform !== "all"
    ? options.platform
    : undefined;

  // Step 1: Try built-in resolvers for URL
  const resolverResult = runResolvers(name, { typeHint: options?.typeHint, config });

  let sourceUrl: string;
  let resolver: string;

  if (resolverResult) {
    sourceUrl = resolverResult.installUrl || resolverResult.urls[0];
    resolver = resolverResult.resolver;
  } else {
    // SearXNG fallback to find a source URL
    const { url: _searxngUrl, error: vmError } = await ensureSearXNG();

    if (vmError || !_searxngUrl) {
      return {
        installCommands: [],
        sourceUrl: "",
        resolver: "none",
        name,
        type: options?.typeHint || "unknown",
        description: `No built-in resolver matched "${name}" and SearXNG is unavailable.`,
      };
    }

    try {
      const searchResult = await searchSearXNG(`how to install ${name}`, {
        categories: "it",
        maxResults: 3,
      });

      if (searchResult.results.length === 0) {
        return {
          installCommands: [],
          sourceUrl: "",
          resolver: "searxng",
          name,
          type: options?.typeHint || "unknown",
          description: `No results found for "${name}". Try using WEB_Search directly.`,
        };
      }

      sourceUrl = searchResult.results[0].url;
      resolver = "searxng";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        installCommands: [],
        sourceUrl: "",
        resolver: "searxng",
        name,
        type: options?.typeHint || "unknown",
        description: `Search failed: ${message}. Try using WEB_Search directly.`,
      };
    }
  }

  // Step 2: Fetch page and extract install commands
  let installCommands: InstallCommand[] = [];
  let description: string | undefined;

  try {
    const { stdout, stderr } = await fetchText(sourceUrl, { timeout: 15_000 });

    if (stdout && !stderr) {
      installCommands = extractInstallCommands(name, stdout);

      // Extract a short description from the first 500 chars
      const firstParagraph = stdout
        .slice(0, 500)
        .split("\n")
        .filter((l) => l.trim().length > 20)[0];
      if (firstParagraph) {
        description = firstParagraph.trim().slice(0, 200);
      }
    }
  } catch {
    // Fetch failed — return URL without extracted commands
  }

  // If no install commands found via fetching, try common patterns based on resolver type
  if (installCommands.length === 0 && resolverResult) {
    installCommands = generateFallbackCommands(name, resolverResult.resolver);
  }

  // Apply platform filter
  if (platformFilter) {
    installCommands = installCommands.filter(
      (c) => c.platform === platformFilter || c.platform === "cross-platform"
    );
  }

  return {
    description,
    installCommands,
    sourceUrl,
    resolver,
    name,
    type: options?.typeHint || resolver,
  };
}

// ─── Fallback command generation ─────────────────────────────────────────────

function generateFallbackCommands(name: string, resolver: string): InstallCommand[] {
  const commands: InstallCommand[] = [];

  switch (resolver) {
    case "npm":
      commands.push({ platform: "cross-platform", manager: "npm", command: `npm install ${name}` });
      break;
    case "pip":
      commands.push({ platform: "cross-platform", manager: "pip", command: `pip install ${name}` });
      break;
    case "cargo":
      commands.push({ platform: "cross-platform", manager: "cargo", command: `cargo add ${name}` });
      break;
    case "brew":
      commands.push({ platform: "mac", manager: "brew", command: `brew install ${name}` });
      break;
    case "docker":
      commands.push({ platform: "cross-platform", manager: "docker", command: `docker pull ${name}` });
      break;
    case "go":
      commands.push({ platform: "cross-platform", manager: "go", command: `go get ${name}` });
      break;
    // For these, the fallback is less certain — let the LLM read the source URL
    case "apt":
    case "snap":
    case "flatpak":
    case "aur":
    case "github":
    case "vscode":
      break;
  }

  return commands;
}