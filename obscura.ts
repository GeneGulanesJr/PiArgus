// obscura.ts — Obscura CLI wrapper via Docker container for light-tier browser operations

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

const CONTAINER_NAME = "piargus";

function getContainerName(): string {
  return process.env.PIARGUS_CONTAINER_NAME || CONTAINER_NAME;
}

export async function execAsync(
  args: string[],
  timeoutMs = 30_000
): Promise<{ stdout: string; stderr: string }> {
  const containerName = getContainerName();
  try {
    const { stdout, stderr } = await execFileAsync("docker", [
      "exec", containerName, "obscura", ...args,
    ], {
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

export async function fetchLinks(
  url: string,
  opts?: { stealth?: boolean; timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  const args = ["fetch", url, "--dump", "links"];
  if (opts?.stealth) args.push("--stealth");
  args.push("--quiet");
  return execAsync(args, opts?.timeout ?? 30_000);
}

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

export function isInstalled(): boolean {
  return true;
}

export function OBSCURA_PATH(): string {
  return `docker exec ${getContainerName()} obscura`;
}
