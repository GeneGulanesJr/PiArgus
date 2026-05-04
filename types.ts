// types.ts — Shared type definitions for the tiered browser extension

/** Which browser tier to use */
export type BrowserTier = "light" | "heavy";

/** Output mode for page fetching */
export type FetchMode = "html" | "text" | "links" | "eval";

/** Wait condition for page load */
export type WaitCondition = "load" | "domcontentloaded";

/** Screenshot options */
export interface ScreenshotOptions {
  url: string;
  path?: string;
  fullPage?: boolean;
  width?: number;
  height?: number;
}

/** Click action */
export interface ClickAction {
  url: string;
  selector?: string;    // CSS selector click
  x?: number;           // Coordinate click
  y?: number;
}

/** Form fill action */
export interface FillAction {
  url: string;
  selector: string;
  value: string;
}

/** Result from a browser operation */
export interface BrowserResult {
  content: string;
  details?: Record<string, unknown>;
  tier: BrowserTier;
  error?: string;
}

/** smolvm machine state */
export type SmolvmState = "not-installed" | "stopped" | "starting" | "running" | "error";
