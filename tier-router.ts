// tier-router.ts — Routes browser tool calls to the appropriate tier

import type { BrowserTier } from "./types";

/** Operations that always require the heavy tier (smolvm+Chromium) */
const HEAVY_ACTIONS = new Set(["click", "fill", "hover", "drag", "screenshot", "wait_for"]);

/**
 * Classify which browser tier a tool call should use.
 *
 * Light tier (Obscura): fetch, navigate, scrape, eval, links, text
 * Heavy tier (smolvm+Chromium): screenshots, clicks, form fills, multi-step flows
 */
export function classifyTier(
  toolName: string,
  params: Record<string, any>
): BrowserTier {
  // browser_screenshot always heavy
  if (toolName === "browser_screenshot") return "heavy";

  // browser_action with heavy sub-actions
  if (toolName === "browser_action") {
    const action = params.action as string | undefined;
    if (action && HEAVY_ACTIONS.has(action)) return "heavy";
  }

  // Everything else goes to light tier (Obscura)
  return "light";
}

/**
 * Get a human-readable description of why a request was routed to a tier.
 */
export function tierExplanation(toolName: string, params: Record<string, any>): string {
  const tier = classifyTier(toolName, params);

  if (tier === "heavy") {
    if (toolName === "browser_screenshot") {
      return "Screenshots require a full browser engine — routed to smolvm+Chromium";
    }
    if (toolName === "browser_action" && HEAVY_ACTIONS.has(params.action)) {
      return `${params.action} requires DOM interaction — routed to smolvm+Chromium`;
    }
  }

  return "Fast stateless operation — routed to Obscura";
}
