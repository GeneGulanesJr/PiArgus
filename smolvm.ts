// smolvm.ts — smolvm CLI wrapper for heavy-tier browser operations
// Uses puppeteer-core inside the VM for CDP-driven browser automation

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { SmolvmState } from "./types";

const execFileAsync = promisify(execFileCb);

const VM_NAME = "pi-browser-heavy";
const SMOLFILE_DIR = join(dirname(new URL(import.meta.url).pathname), "smolfier");

// ─── Interaction types ─────────────────────────────────────────────────────

/** Interaction action types for the heavy tier */
export type InteractionAction =
  | { type: "click"; selector: string }
  | { type: "click_at"; x: number; y: number }
  | { type: "fill"; selector: string; value: string }
  | { type: "hover"; selector: string }
  | { type: "wait_for"; selector: string; timeout?: number }
  | { type: "scroll"; x?: number; y?: number }
  | { type: "keypress"; key: string };

/** Result from a page interaction */
export interface InteractionResult {
  success: boolean;
  html?: string;
  error?: string;
}

// ─── Binary discovery ──────────────────────────────────────────────────────

/** Find the smolvm binary */
export function SMOLVM_PATH(): string {
  const candidates = [
    process.env.SMOLVM_PATH,
    `${process.env.HOME}/.local/bin/smolvm`,
    "/usr/local/bin/smolvm",
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "smolvm";
}

/** Check if smolvm is installed */
export function isSmolvmInstalled(): boolean {
  try {
    return existsSync(SMOLVM_PATH());
  } catch {
    return false;
  }
}

// ─── CLI execution ─────────────────────────────────────────────────────────

/** Execute a smolvm CLI command */
async function smolvmExec(
  args: string[],
  timeoutMs = 60_000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const bin = SMOLVM_PATH();
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || err.message,
      exitCode: err.code || 1,
    };
  }
}

// ─── VM lifecycle ──────────────────────────────────────────────────────────

/** Ensure the Chromium VM is created and running */
export async function ensureVm(): Promise<{ running: boolean; error?: string }> {
  if (!isSmolvmInstalled()) {
    return { running: false, error: "smolvm not installed. Install: curl -sSL https://smolmachines.com/install.sh | bash" };
  }

  // Check current VM status
  const status = await smolvmExec(["machine", "status", "--name", VM_NAME], 5_000);

  if (status.exitCode === 0 && status.stdout.includes("running")) {
    return { running: true };
  }

  // If VM exists but is stopped, just start it
  if (status.exitCode === 0 && status.stdout.includes("stopped")) {
    const startResult = await smolvmExec(
      ["machine", "start", "--name", VM_NAME],
      30_000
    );
    if (startResult.exitCode !== 0) {
      return { running: false, error: `Failed to start VM: ${startResult.stderr}` };
    }
    return { running: true };
  }

  // VM doesn't exist — create it from Smolfile
  const smolfilePath = join(SMOLFILE_DIR, "browser.smolfile");
  if (!existsSync(smolfilePath)) {
    return { running: false, error: `Smolfile not found at ${smolfilePath}` };
  }

  const createResult = await smolvmExec(
    ["machine", "create", VM_NAME, "-s", smolfilePath],
    120_000
  );

  if (createResult.exitCode !== 0) {
    return { running: false, error: `Failed to create VM: ${createResult.stderr}` };
  }

  // Start the newly created machine
  const startResult = await smolvmExec(
    ["machine", "start", "--name", VM_NAME],
    30_000
  );

  if (startResult.exitCode !== 0) {
    return { running: false, error: `Failed to start VM: ${startResult.stderr}` };
  }

  return { running: true };
}

/** Stop the VM */
export async function stopVm(): Promise<{ stopped: boolean; error?: string }> {
  const result = await smolvmExec(["machine", "stop", "--name", VM_NAME], 15_000);
  if (result.exitCode !== 0) {
    return { stopped: false, error: result.stderr };
  }
  return { stopped: true };
}

/** Execute a command inside the running VM */
export async function vmExec(
  command: string[],
  opts?: { timeout?: number; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Build args in correct order: machine exec [--env K=V]... --name <name> -- <command>
  const args: string[] = ["machine", "exec"];

  if (opts?.env) {
    for (const [key, value] of Object.entries(opts.env)) {
      args.push("--env", `${key}=${value}`);
    }
  }

  args.push("--name", VM_NAME, "--", ...command);
  return smolvmExec(args, opts?.timeout ?? 60_000);
}

// ─── Screenshot ────────────────────────────────────────────────────────────

/** Static screenshot script — no string interpolation of URL (injection-safe) */
const SCREENSHOT_SCRIPT = `
const puppeteer = require('puppeteer-core');
const url = process.env.PIARGUS_URL;
const width = parseInt(process.env.PIARGUS_WIDTH || '1280', 10);
const height = parseInt(process.env.PIARGUS_HEIGHT || '800', 10);
const fullPage = process.env.PIARGUS_FULL_PAGE === 'true';
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.screenshot({ path: '/tmp/smolvm-screenshot.png', fullPage });
  await browser.close();
  console.log('OK');
})().catch(e => { console.error(e.message); process.exit(1); });
`.trim();

/** Take a screenshot of a URL inside the VM using puppeteer-core */
export async function screenshot(
  url: string,
  outputPath: string,
  opts?: { fullPage?: boolean; width?: number; height?: number }
): Promise<{ path: string; error?: string }> {
  const ensure = await ensureVm();
  if (!ensure.running) {
    return { path: outputPath, error: ensure.error };
  }

  const envVars: Record<string, string> = {
    PIARGUS_URL: url,
    PIARGUS_WIDTH: String(opts?.width ?? 1280),
    PIARGUS_HEIGHT: String(opts?.height ?? 800),
    PIARGUS_FULL_PAGE: String(opts?.fullPage ?? false),
  };

  // Write static script to VM (no user data interpolated — injection-safe)
  const writeResult = await vmExec(
    ["sh", "-c", `cat > /tmp/screenshot.js << 'SCRIPT'\n${SCREENSHOT_SCRIPT}\nSCRIPT`],
    { timeout: 5_000 }
  );

  if (writeResult.exitCode !== 0) {
    return { path: outputPath, error: `Failed to write screenshot script: ${writeResult.stderr}` };
  }

  const nodeResult = await vmExec(["node", "/tmp/screenshot.js"], {
    timeout: 30_000,
    env: envVars,
  });

  if (nodeResult.exitCode !== 0) {
    return { path: outputPath, error: `Screenshot failed: ${nodeResult.stderr || nodeResult.stdout}` };
  }

  // Copy screenshot from VM to host via base64
  const b64Result = await vmExec(["base64", "/tmp/smolvm-screenshot.png"], { timeout: 10_000 });

  if (b64Result.exitCode !== 0) {
    return { path: outputPath, error: `Failed to extract screenshot: ${b64Result.stderr}` };
  }

  // Decode and write to host filesystem
  const imageBuffer = Buffer.from(b64Result.stdout.trim(), "base64");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, imageBuffer);

  return { path: outputPath };
}

// ─── CDP interactions ──────────────────────────────────────────────────────

/**
 * Static interaction script — no string interpolation of URL or actions (injection-safe).
 * All user-controlled data is passed via environment variables.
 */
const INTERACT_SCRIPT = `
const puppeteer = require('puppeteer-core');
const url = process.env.PIARGUS_URL;
const actions = JSON.parse(process.env.PIARGUS_ACTIONS);
const stealth = process.env.PIARGUS_STEALTH === 'true';
const timeoutMs = parseInt(process.env.PIARGUS_TIMEOUT || '15000', 10);
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  if (stealth) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
  }
  await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });

  for (const action of actions) {
    switch (action.type) {
      case 'click':
        await page.waitForSelector(action.selector, { timeout: 5000 });
        await page.click(action.selector);
        await page.waitForNetworkIdle({ timeout: 3000 }).catch(() => {});
        break;
      case 'click_at':
        await page.mouse.click(action.x, action.y);
        await page.waitForNetworkIdle({ timeout: 3000 }).catch(() => {});
        break;
      case 'fill':
        await page.waitForSelector(action.selector, { timeout: 5000 });
        await page.click(action.selector, { clickCount: 3 });
        await page.type(action.selector, action.value);
        break;
      case 'hover':
        await page.waitForSelector(action.selector, { timeout: 5000 });
        await page.hover(action.selector);
        break;
      case 'wait_for':
        await page.waitForSelector(action.selector, { timeout: action.timeout || 5000 });
        break;
      case 'scroll':
        await page.evaluate((x, y) => window.scrollBy(x || 0, y || 0), action.x, action.y);
        break;
      case 'keypress':
        await page.keyboard.press(action.key);
        break;
    }
  }

  const html = await page.content();
  await browser.close();
  process.stdout.write(html);
})().catch(e => { console.error(e.message); process.exit(1); });
`.trim();

/**
 * Perform one or more browser interactions on a page using puppeteer-core
 * inside the smolvm VM. Returns the final page HTML after all actions.
 *
 * URL and actions are passed via environment variables (injection-safe —
 * no string interpolation of user-controlled data into the script).
 */
export async function interact(
  url: string,
  actions: InteractionAction[],
  opts?: { timeout?: number; stealth?: boolean }
): Promise<InteractionResult> {
  const ensure = await ensureVm();
  if (!ensure.running) {
    return { success: false, error: ensure.error };
  }

  const timeoutMs = (opts?.timeout ?? 15) * 1000;

  const envVars: Record<string, string> = {
    PIARGUS_URL: url,
    PIARGUS_ACTIONS: JSON.stringify(actions),
    PIARGUS_STEALTH: String(opts?.stealth ?? false),
    PIARGUS_TIMEOUT: String(timeoutMs),
  };

  // Write static script to VM (no user data interpolated — injection-safe)
  const writeResult = await vmExec(
    ["sh", "-c", `cat > /tmp/interact.js << 'SCRIPT'\n${INTERACT_SCRIPT}\nSCRIPT`],
    { timeout: 5_000 }
  );

  if (writeResult.exitCode !== 0) {
    return { success: false, error: `Failed to write interaction script: ${writeResult.stderr}` };
  }

  const nodeResult = await vmExec(["node", "/tmp/interact.js"], {
    timeout: timeoutMs,
    env: envVars,
  });

  if (nodeResult.exitCode !== 0) {
    return { success: false, error: nodeResult.stderr || nodeResult.stdout };
  }

  return { success: true, html: nodeResult.stdout };
}

// ─── VM status ─────────────────────────────────────────────────────────────

/** Get VM status */
export async function getVmStatus(): Promise<SmolvmState> {
  if (!isSmolvmInstalled()) return "not-installed";

  const result = await smolvmExec(["machine", "status", "--name", VM_NAME], 5_000);

  if (result.stdout.includes("running")) return "running";
  if (result.stdout.includes("stopped")) return "stopped";
  if (result.exitCode !== 0 && result.stderr.includes("not found")) return "stopped";
  return "stopped";
}
