// obscura.ts — Obscura CLI wrapper for light-tier browser operations

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFileCb);

/** Find the obscura binary */
export function OBSCURA_PATH(): string {
  const candidates = [
    process.env.OBSCURA_PATH,
    `${process.env.HOME}/.local/bin/obscura`,
    "/usr/local/bin/obscura",
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "obscura";
}

/** Execute an obscura CLI command */
export async function execAsync(
  args: string[],
  timeoutMs = 30_000
): Promise<{ stdout: string; stderr: string }> {
  const bin = OBSCURA_PATH();
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || err.message,
    };
  }
}

/** Fetch a page as text */
export async function fetchText(
  url: string,
  opts?: { waitUntil?: string; stealth?: boolean; selector?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  const args = ["fetch", url, "--dump", "text"];
  if (opts?.waitUntil) args.push("--wait-until", opts.waitUntil);
  if (opts?.stealth) args.push("--stealth");
  if (opts?.selector) args.push("--selector", opts.selector);
  args.push("--quiet");
  return execAsync(args, opts?.timeout ?? 30_000);
}

/** Fetch a page as HTML */
export async function fetchHtml(
  url: string,
  opts?: { waitUntil?: string; stealth?: boolean; selector?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  const args = ["fetch", url, "--dump", "html"];
  if (opts?.waitUntil) args.push("--wait-until", opts.waitUntil);
  if (opts?.stealth) args.push("--stealth");
  if (opts?.selector) args.push("--selector", opts.selector);
  args.push("--quiet");
  return execAsync(args, opts?.timeout ?? 30_000);
}

/** Extract all links from a page */
export async function fetchLinks(
  url: string,
  opts?: { stealth?: boolean; timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  const args = ["fetch", url, "--dump", "links"];
  if (opts?.stealth) args.push("--stealth");
  args.push("--quiet");
  return execAsync(args, opts?.timeout ?? 30_000);
}

/** Evaluate a JS expression on a page */
export async function evalJs(
  url: string,
  expression: string,
  opts?: { stealth?: boolean; timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  const args = ["fetch", url, "--eval", expression];
  if (opts?.stealth) args.push("--stealth");
  args.push("--quiet");
  return execAsync(args, opts?.timeout ?? 30_000);
}

/** Check if obscura is installed */
export function isInstalled(): boolean {
  try {
    return existsSync(OBSCURA_PATH());
  } catch {
    return false;
  }
}
