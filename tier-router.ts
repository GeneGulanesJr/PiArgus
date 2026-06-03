// tier-router.ts — Routes browser tool calls to the appropriate tier

import type { BrowserTier } from "./types";

const HEAVY_ACTIONS = new Set(["click", "fill", "hover", "wait_for"]);

export function classifyTier(
  toolName: string,
  params: Record<string, any>
): BrowserTier {
  if (toolName === "browser_screenshot") return "heavy";

  if (toolName === "browser_action") {
    const action = params.action as string | undefined;
    if (action && HEAVY_ACTIONS.has(action)) return "heavy";
  }

  return "light";
}

export function tierExplanation(toolName: string, params: Record<string, any>): string {
  const tier = classifyTier(toolName, params);

  if (tier === "heavy") {
    if (toolName === "browser_screenshot") {
      return "Screenshots require a full browser engine — routed to Docker+Chromium";
    }
    if (toolName === "browser_action" && HEAVY_ACTIONS.has(params.action)) {
      return `${params.action} requires DOM interaction — routed to Docker+Chromium`;
    }
  }

  return "Fast stateless operation — routed to Obscura";
}
