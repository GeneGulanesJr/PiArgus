// types.ts — Shared type definitions for the tiered browser extension

/** Which browser tier to use */
export type BrowserTier = "light" | "heavy";

/** smolvm machine state */
export type SmolvmState = "not-installed" | "stopped" | "starting" | "running" | "error";
