// types.ts — Shared type definitions for the tiered browser extension

export type BrowserTier = "light" | "heavy";

export type ContainerState = "not-installed" | "stopped" | "starting" | "running" | "error";
