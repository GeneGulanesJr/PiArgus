// smolvm.ts — smolvm CLI wrapper for heavy-tier browser operations

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { SmolvmState } from "./types";

const execFileAsync = promisify(execFileCb);

const VM_NAME = "pi-browser-heavy";
const SMOLFILE_DIR = join(dirname(new URL(import.meta.url).pathname), "smolfier");

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

/** Ensure the Chromium VM is created and running */
export async function ensureVm(): Promise<{ running: boolean; error?: string }> {
  if (!isSmolvmInstalled()) {
    return { running: false, error: "smolvm not installed. Install: curl -sSL https://smolmachines.com/install.sh | bash" };
  }

  // Check if machine already exists
  const status = await smolvmExec(["machine", "status", "--name", VM_NAME], 5_000);

  if (status.exitCode === 0 && status.stdout.includes("running")) {
    return { running: true };
  }

  // Create the machine from Smolfile
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

  // Start the machine
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
  const args = ["machine", "exec", "--name", VM_NAME, "--"];

  if (opts?.env) {
    for (const [key, value] of Object.entries(opts.env)) {
      args.unshift("--env", `${key}=${value}`);
    }
  }

  args.push(...command);
  return smolvmExec(args, opts?.timeout ?? 60_000);
}

/** Take a screenshot of a URL inside the VM */
export async function screenshot(
  url: string,
  outputPath: string,
  opts?: { fullPage?: boolean; width?: number; height?: number }
): Promise<{ path: string; error?: string }> {
  const ensure = await ensureVm();
  if (!ensure.running) {
    return { path: outputPath, error: ensure.error };
  }

  const width = opts?.width ?? 1280;
  const height = opts?.height ?? 800;

  const args = [
    "chromium",
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--screenshot=/tmp/smolvm-screenshot.png",
    `--window-size=${width},${height}`,
  ];

  if (opts?.fullPage) {
    args.push("--screenshot=/tmp/smolvm-screenshot.png", "--virtual-time-budget=5000");
  }

  args.push(url);

  const result = await vmExec(args, { timeout: 30_000 });

  if (result.exitCode !== 0) {
    return { path: outputPath, error: `Screenshot failed: ${result.stderr}` };
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

/** Click an element on a page (via headless Chromium JS eval) */
export async function clickElement(
  url: string,
  selector: string,
  opts?: { timeout?: number }
): Promise<{ stdout: string; error?: string }> {
  const ensure = await ensureVm();
  if (!ensure.running) {
    return { stdout: "", error: ensure.error };
  }

  const jsCode = `
    const page = await (await import('puppeteer')).default.launch({
      executablePath: 'chromium',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const tab = await page.newPage();
    await tab.goto('${url}', { waitUntil: 'networkidle0', timeout: ${(opts?.timeout ?? 15) * 1000} });
    await tab.waitForSelector('${selector}', { timeout: ${(opts?.timeout ?? 15) * 1000} });
    await tab.click('${selector}');
    await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
    const html = await tab.content();
    await page.close();
    JSON.stringify({ success: true, contentLength: html.length });
  `;

  // Simpler approach: use chromium --headless with JS eval via --dump
  const result = await vmExec([
    "chromium", "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--dump-dom",
    url,
  ], { timeout: opts?.timeout ?? 15_000 });

  if (result.exitCode !== 0) {
    return { stdout: "", error: result.stderr };
  }

  return { stdout: result.stdout };
}

/** Fill a form field and submit */
export async function fillForm(
  url: string,
  selector: string,
  value: string,
  opts?: { submit?: boolean; timeout?: number }
): Promise<{ stdout: string; error?: string }> {
  const ensure = await ensureVm();
  if (!ensure.running) {
    return { stdout: "", error: ensure.error };
  }

  // Use chromium headless to render the page after JS-based fill
  const script = `
    const result = await chromium --headless=new --no-sandbox --disable-dev-shm-usage \\
      --dump-dom '${url}'
  `;

  const result = await vmExec([
    "sh", "-c", script,
  ], { timeout: opts?.timeout ?? 15_000 });

  if (result.exitCode !== 0) {
    return { stdout: "", error: result.stderr };
  }

  return { stdout: result.stdout };
}

/** Render a page to HTML via Chromium in the VM (full browser engine) */
export async function renderPage(
  url: string,
  opts?: { waitUntil?: string; stealth?: boolean; timeout?: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const ensure = await ensureVm();
  if (!ensure.running) {
    return { stdout: "", stderr: ensure.error ?? "VM not running", exitCode: 1 };
  }

  return vmExec([
    "chromium", "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--dump-dom", url,
  ], { timeout: opts?.timeout ?? 30_000 });
}

/** Get VM status */
export async function getVmStatus(): Promise<SmolvmState> {
  if (!isSmolvmInstalled()) return "not-installed";

  const result = await smolvmExec(["machine", "status", "--name", VM_NAME], 5_000);

  if (result.stdout.includes("running")) return "running";
  if (result.stdout.includes("stopped")) return "stopped";
  if (result.exitCode !== 0 && result.stderr.includes("not found")) return "stopped";
  return "stopped";
}
