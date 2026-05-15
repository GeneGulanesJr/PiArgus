// smolvm.ts — smolvm CLI wrapper for heavy-tier browser operations + SearXNG search VM
// Uses puppeteer-core inside the VM for CDP-driven browser automation
// Uses Granian (via persistent exec session) for SearXNG search

import { execFile as execFileCb, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { SmolvmState } from "./types";

const execFileAsync = promisify(execFileCb);

const VM_NAME = "pi-browser-heavy";
const SEARCH_VM_NAME = "pi-search-searxng";
const SMOLFILE_DIR = join(dirname(new URL(import.meta.url).pathname), "smolfier");

/** SearXNG port inside the search VM */
export const SEARXNG_PORT = 8888;
/** SearXNG URL when running in the local smolvm */
export const SEARXNG_LOCAL_URL = `http://localhost:${SEARXNG_PORT}`;

/** Keep-alive script: start Granian and wait on its PID */
const GRANIAN_KEEPALIVE_SCRIPT = `
/usr/local/searxng/.venv/bin/granian searx.webapp:app --host 0.0.0.0 --port 8080 &
GPID=$!
echo "Granian PID: $GPID" >&2
while kill -0 $GPID 2>/dev/null; do sleep 5; done
`.trim();

/** Active search VM persistent exec session (keeps Granian alive) */
let searchVmProcess: ChildProcess | null = null;

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

/** Execute a smolvm CLI command with automatic DB lock retry.
 *  Multiple pi sessions can compete for the smolvm SQLite DB.
 *  Retries up to 3 times with a short delay when a lock error is detected.
 */
async function smolvmExec(
  args: string[],
  timeoutMs = 60_000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const maxRetries = 3;
  const lockRetryDelay = 2000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await rawSmolvmExec(args, timeoutMs);

    // If DB is locked by another pi session, retry after a short delay
    if (result.stderr.includes("Database already open") ||
        result.stderr.includes("Cannot acquire lock")) {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, lockRetryDelay));
        continue;
      }
    }

    return result;
  }

  // Should not reach here, but return last attempt
  return await rawSmolvmExec(args, timeoutMs);
}

/** Raw smolvm CLI execution (no retry) */
async function rawSmolvmExec(
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
      60_000  // init may re-run on start (apk add, npm install)
    );
    if (startResult.exitCode !== 0) {
      return { running: false, error: `Failed to start VM: ${startResult.stderr}` };
    }
    // Wait for the agent to accept exec commands
    const ready = await waitForAgentReady();
    if (!ready) {
      return { running: false, error: "VM agent not ready after start" };
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

  // After start (whether from stopped or fresh create), wait for the agent to be ready.
  // The smolvm agent might still be initializing after 'machine start' returns.
  const ready = await waitForAgentReady();
  if (!ready) {
    return { running: false, error: "VM agent not ready after start" };
  }

  return { running: true };
}

/** Wait for the VM agent to accept exec commands.
 * Uses a lightweight echo test instead of node to avoid cold-start delays.
 * Returns true if agent responds within ~20 seconds.
 */
async function waitForAgentReady(retries = 10): Promise<boolean> {
  const delayMs = 2000;
  for (let i = 0; i < retries; i++) {
    try {
      const result = await smolvmExec(
        ["machine", "exec", "--name", VM_NAME, "--", "echo", "ready"],
        3_000
      );
      if (result.exitCode === 0 && result.stdout.includes("ready")) return true;
    } catch {
      // ignore and retry
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
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

/** NODE_PATH for global npm modules inside the VM.
 *  Must include /usr/src/app/node_modules — the zenika/alpine-chrome image
 *  installs puppeteer-core there, not under /usr/local/lib. */
const NODE_PATH = "/usr/local/lib/node_modules:/usr/src/app/node_modules";

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
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-pipe'],
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
    NODE_PATH,
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
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-pipe'],
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
    NODE_PATH,
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

// ─── Search VM (SearXNG) ────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// Concurrency guard — prevents parallel ensureSearchVm calls from racing.
// Multiple pi sessions or parallel tool calls both hit this path.
// ═══════════════════════════════════════════════════════════════════════════════

let _ensureSearchVmPromise: Promise<{ running: boolean; url?: string; error?: string }> | null = null;

/** Ensure the SearXNG search VM is created, running, and SearXNG is responding.
 *
 *  Architecture: smolvm persistent VMs kill background processes when exec/init
 *  sessions end. So we use a persistent `machine exec` session that keeps
 *  Granian (the SearXNG ASGI server) alive by waiting on its PID. This detached
 *  Node child process stays alive in the background.
 *
 *  Flow:
 *  1. Check if SearXNG already responding → return immediately
 *  2. If VM not running → start it (settings.yml written by init on every start)
 *  3. Start Granian via persistent exec session
 *  4. Wait for healthz to return 200
 *  5. If Granian fails to start, attempt one recovery cycle (kill session, restart)
 */
export async function ensureSearchVm(): Promise<{ running: boolean; url?: string; error?: string }> {
  // Deduplicate concurrent calls — return the in-flight promise
  if (_ensureSearchVmPromise) return _ensureSearchVmPromise;

  _ensureSearchVmPromise = _ensureSearchVmImpl();
  try {
    return await _ensureSearchVmPromise;
  } finally {
    _ensureSearchVmPromise = null;
  }
}

async function _ensureSearchVmImpl(): Promise<{ running: boolean; url?: string; error?: string }> {
  if (!isSmolvmInstalled()) {
    return { running: false, error: "smolvm not installed. Install: curl -sSL https://smolmachines.com/install.sh | bash" };
  }

  // 1. Fast path: already responding?
  if (await isSearXNGReady()) {
    return { running: true, url: SEARXNG_LOCAL_URL };
  }

  // 2. Start the VM if needed
  const vmStatus = await smolvmExec(["machine", "status", "--name", SEARCH_VM_NAME], 5_000);

  if (vmStatus.exitCode !== 0 || (!vmStatus.stdout.includes("running") && !vmStatus.stdout.includes("stopped") && !vmStatus.stdout.includes("unreachable"))) {
    // VM doesn't exist — create from smolfile
    const smolfilePath = join(SMOLFILE_DIR, "search.smolfile");
    if (!existsSync(smolfilePath)) {
      return { running: false, error: `Search smolfile not found at ${smolfilePath}` };
    }
    const createResult = await smolvmExec(
      ["machine", "create", SEARCH_VM_NAME, "-s", smolfilePath],
      120_000
    );
    if (createResult.exitCode !== 0) {
      return { running: false, error: `Failed to create search VM: ${createResult.stderr}` };
    }
  }

  // If not running, start the VM
  const currentStatus = await smolvmExec(["machine", "status", "--name", SEARCH_VM_NAME], 5_000);
  if (currentStatus.exitCode === 0 && currentStatus.stdout.includes("stopped")) {
    const startResult = await smolvmExec(
      ["machine", "start", "--name", SEARCH_VM_NAME],
      120_000
    );
    if (startResult.exitCode !== 0) {
      return { running: false, error: `Failed to start search VM: ${startResult.stderr}` };
    }
  }

  // 3. Ensure settings.yml has JSON format enabled.
  // Only attempt if the smolvm agent is reachable (persistent exec may block it).
  const agentReachable = currentStatus.stdout.includes("running") && !currentStatus.stdout.includes("unreachable");
  if (agentReachable) {
    const settingsCheck = await vmSearchExec(
      ["sh", "-c", "grep -q 'json' /etc/searxng/settings.yml; echo $?"],
      { timeout: 5_000 }
    );
    if (settingsCheck.stdout.trim() !== "0") {
      await vmSearchExec(
        ["sh", "-c", "cat > /etc/searxng/settings.yml << 'YAMLEOF'\n" +
          "use_default_settings: true\n" +
          "search:\n  safe_search: 0\n  formats:\n    - html\n    - json\n" +
          "server:\n  limiter: false\n  image_proxy: false\n  secret_key: piargus-search-2026\n" +
          "valkey:\n  url: false\n" +
          "YAMLEOF"],
        { timeout: 5_000 }
      );
    }
  }

  // 4. Start Granian via persistent exec session (keeps process alive)
  await startGranianSession();

  // 5. Wait for SearXNG to be ready (up to 30s for cold starts)
  let ready = await waitForSearXNG(60);  // 60 × 500ms = 30s
  if (ready) return { running: true, url: SEARXNG_LOCAL_URL };

  // 6. Recovery: kill the session and try one more time
  // The first attempt might have failed due to a stale exec session
  // occupying the smolvm agent connection.
  if (searchVmProcess) {
    try { searchVmProcess.kill(); } catch { /* ignore */ }
    searchVmProcess = null;
  }
  // Brief pause to let smolvm release the agent connection.
  // The old persistent exec session occupies the agent; the kernel may
  // take >1s to fully reap the killed child and free the connection.
  await new Promise((r) => setTimeout(r, 3_000));

  await startGranianSession();
  ready = await waitForSearXNG(40);  // 40 × 500ms = 20s
  if (ready) return { running: true, url: SEARXNG_LOCAL_URL };

  return { running: false, error: "SearXNG failed to respond after two attempts. " +
    "Check: smolvm machine exec --name pi-search-searxng -- cat /tmp/granian.log" };
}

/** Stop the search VM (kills Granian session + stops VM) */
export async function stopSearchVm(): Promise<{ stopped: boolean; error?: string }> {
  // Kill the persistent exec session first
  if (searchVmProcess) {
    try { searchVmProcess.kill(); } catch { /* ignore */ }
    searchVmProcess = null;
  }
  const result = await smolvmExec(["machine", "stop", "--name", SEARCH_VM_NAME], 15_000);
  if (result.exitCode !== 0 && !result.stderr.includes("not running")) {
    return { stopped: false, error: result.stderr };
  }
  return { stopped: true };
}

/** Get search VM status. Note: when the persistent exec session is active,
 *  smolvm agent reports "unreachable" because the session occupies the connection.
 *  We use SearXNG healthz as the primary status indicator instead.
 */
export async function getSearchVmStatus(): Promise<SmolvmState> {
  // Fast check: if SearXNG is responding, VM is definitely running
  if (await isSearXNGReady()) return "running";

  if (!isSmolvmInstalled()) return "not-installed";

  // Try smolvm agent (works when no persistent session is active)
  const result = await smolvmExec(["machine", "status", "--name", SEARCH_VM_NAME], 5_000);

  if (result.stdout.includes("running") || result.stdout.includes("unreachable")) return "running";
  if (result.stdout.includes("stopped")) return "stopped";
  if (result.exitCode !== 0 && result.stderr.includes("not found")) return "stopped";
  return "stopped";
}

/** Execute a command inside the search VM */
async function vmSearchExec(
  command: string[],
  opts?: { timeout?: number; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const args: string[] = ["machine", "exec"];

  if (opts?.env) {
    for (const [key, value] of Object.entries(opts.env)) {
      args.push("--env", `${key}=${value}`);
    }
  }

  args.push("--name", SEARCH_VM_NAME, "--", ...command);
  return smolvmExec(args, opts?.timeout ?? 60_000);
}

/** Start Granian in a persistent exec session.
 *  smolvm kills background processes when exec sessions end,
 *  so we keep the session alive by spawning a detached child that
 *  stays in a wait loop on Granian's PID.
 *
 *  Uses execFile (not spawn) so we can verify the smolvm `machine exec`
 *  actually establishes its connection before resolving. The Granian startup
 *  itself is handled by waitForSearXNG polling.
 */
function startGranianSession(): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = SMOLVM_PATH();

    // Kill any existing persistent session
    if (searchVmProcess) {
      try { searchVmProcess.kill(); } catch { /* ignore */ }
      searchVmProcess = null;
    }

    // Use execFile with a reasonable timeout — smolvm machine exec should
    // establish the connection within a few seconds, then we detach.
    const child = spawn(bin, [
      "machine", "exec",
      "--name", SEARCH_VM_NAME,
      "--",
      "sh", "-c", GRANIAN_KEEPALIVE_SCRIPT,
    ], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    searchVmProcess = child;

    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        searchVmProcess = null;
        reject(err);
      } else {
        // Detach — process keeps running in background
        child.unref();
        resolve();
      }
    };

    // Wait for smolvm to print the Granian PID (indicates exec session is live)
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on("error", (err) => settle(err));
    child.on("exit", (code) => {
      if (!settled) {
        settle(new Error(`smolvm machine exec exited with code ${code}. stderr: ${stderr.slice(0, 500)}`));
      }
    });

    // Timeout: if smolvm can't establish the exec session within 30s, fail.
    // Cold-start image pulls and agent init can push beyond 15s.
    const timer = setTimeout(() => {
      settle(new Error(`smolvm machine exec timed out after 30s. stderr: ${stderr.slice(0, 500)}`));
    }, 30_000);

    // Resolve once we get a PID from Granian (means exec session is active)
    const check = (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.includes("Granian PID:")) settle();
    };
    child.stderr?.on("data", check);
  });
}

/** Check if SearXNG is ready to serve requests */
async function isSearXNGReady(): Promise<boolean> {
  try {
    const response = await fetch(`${SEARXNG_LOCAL_URL}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Wait for SearXNG to respond on localhost:8888 */
async function waitForSearXNG(maxRetries?: number): Promise<boolean> {
  const retries = maxRetries ?? 15;
  const delayMs = 500;
  for (let i = 0; i < retries; i++) {
    if (await isSearXNGReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}
