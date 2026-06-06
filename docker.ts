// docker.ts — Docker container manager for heavy-tier browser operations + SearXNG search
// Uses puppeteer-core inside the container for CDP-driven browser automation
// SearXNG runs as a supervised process inside the same container

import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ContainerState } from "./types";

const execFileAsync = promisify(execFileCb);

const CONTAINER_NAME = "piargus";
const DOCKER_IMAGE = process.env.PIARGUS_DOCKER_IMAGE || "genegulanesjr/piargus:latest";
const CACHE_TTL_MS = 30_000;

export const SEARXNG_PORT = parseInt(process.env.PIARGUS_SEARXNG_PORT || "8888", 10);
export const CHROME_PORT = parseInt(process.env.PIARGUS_CHROME_PORT || "9222", 10);
export const SEARXNG_LOCAL_URL = `http://localhost:${SEARXNG_PORT}`;

let _cacheRunning = false;
let _cacheCheckedAt = 0;

export type InteractionAction =
  | { type: "click"; selector: string }
  | { type: "click_at"; x: number; y: number }
  | { type: "fill"; selector: string; value: string }
  | { type: "hover"; selector: string }
  | { type: "wait_for"; selector: string; timeout?: number }
  | { type: "scroll"; x?: number; y?: number }
  | { type: "keypress"; key: string };

export interface InteractionResult {
  success: boolean;
  html?: string;
  error?: string;
}

export function getContainerName(): string {
  return process.env.PIARGUS_CONTAINER_NAME || CONTAINER_NAME;
}

export function isDockerInstalled(): boolean {
  try {
    execFileSync("docker", ["--version"], { stdio: "pipe", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

async function dockerExec(
  args: string[],
  timeoutMs = 60_000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("docker", args, {
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

async function containerExec(
  command: string[],
  opts?: { timeout?: number; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const name = getContainerName();
  const args: string[] = ["exec"];

  if (opts?.env) {
    for (const [key, value] of Object.entries(opts.env)) {
      args.push("-e", `${key}=${value}`);
    }
  }

  args.push(name, ...command);
  return dockerExec(args, opts?.timeout ?? 60_000);
}

let _ensureContainerPromise: Promise<{ running: boolean; error?: string }> | null = null;

export function invalidateContainerCache(): void {
  _cacheRunning = false;
  _cacheCheckedAt = 0;
}

export async function ensureContainer(): Promise<{ running: boolean; error?: string }> {
  if (_cacheRunning && Date.now() - _cacheCheckedAt < CACHE_TTL_MS) {
    return { running: true };
  }

  if (_ensureContainerPromise) return _ensureContainerPromise;

  _ensureContainerPromise = _ensureContainerImpl();
  try {
    return await _ensureContainerPromise;
  } finally {
    _ensureContainerPromise = null;
  }
}

async function _ensureContainerImpl(): Promise<{ running: boolean; error?: string }> {
  if (!isDockerInstalled()) {
    return { running: false, error: "Docker not installed. Install: https://docs.docker.com/get-docker/" };
  }

  const name = getContainerName();

  const inspect = await dockerExec(["inspect", "--format={{.State.Status}}", name], 5_000);

  if (inspect.exitCode === 0 && inspect.stdout.trim() === "running") {
    _cacheRunning = true;
    _cacheCheckedAt = Date.now();
    return { running: true };
  }

  if (inspect.exitCode === 0 && inspect.stdout.trim() === "exited") {
    const startResult = await dockerExec(["start", name], 30_000);
    if (startResult.exitCode !== 0) {
      _cacheRunning = false;
      return { running: false, error: `Failed to start container: ${startResult.stderr}` };
    }
    const ready = await waitForContainerReady();
    if (!ready) {
      _cacheRunning = false;
      return { running: false, error: "Container not ready after start" };
    }
    _cacheRunning = true;
    _cacheCheckedAt = Date.now();
    return { running: true };
  }

  if (inspect.exitCode === 0 && inspect.stdout.trim() === "paused") {
    const unpauseResult = await dockerExec(["unpause", name], 15_000);
    if (unpauseResult.exitCode !== 0) {
      _cacheRunning = false;
      return { running: false, error: `Failed to unpause container: ${unpauseResult.stderr}` };
    }
    const ready = await waitForContainerReady();
    if (!ready) {
      _cacheRunning = false;
      return { running: false, error: "Container not ready after unpause" };
    }
    _cacheRunning = true;
    _cacheCheckedAt = Date.now();
    return { running: true };
  }

  if (inspect.exitCode === 0) {
    const status = inspect.stdout.trim();
    if (status === "removing") {
      await waitForContainerRemoval(name);
    } else if (status === "created" || status === "dead" || status === "restarting") {
      await dockerExec(["rm", "-f", name], 10_000);
    }
  }

  _cacheRunning = false;
  const runResult = await dockerExec([
    "run", "-d",
    "--name", name,
    "-p", `127.0.0.1:${CHROME_PORT}:9222`,
    "-p", `127.0.0.1:${SEARXNG_PORT}:8080`,
    DOCKER_IMAGE,
  ], 120_000);

  if (runResult.exitCode !== 0) {
    const stderr = runResult.stderr;
    if (stderr.includes("port is already allocated")) {
      return { running: false, error: `Port ${CHROME_PORT} or ${SEARXNG_PORT} is already in use. Stop the conflicting service or change PIARGUS_CHROME_PORT/PIARGUS_SEARXNG_PORT.` };
    }
    return { running: false, error: `Failed to create container: ${stderr}` };
  }

  const ready = await waitForContainerReady();
  if (!ready) {
    return { running: false, error: "Container not ready after creation" };
  }

  _cacheRunning = true;
  _cacheCheckedAt = Date.now();
  return { running: true };
}

async function waitForContainerRemoval(name: string, retries = 15): Promise<void> {
  const delayMs = 1000;
  for (let i = 0; i < retries; i++) {
    const result = await dockerExec(["inspect", "--format={{.State.Status}}", name], 3_000);
    if (result.exitCode !== 0) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function waitForContainerReady(retries = 15): Promise<boolean> {
  const delayMs = 2000;
  for (let i = 0; i < retries; i++) {
    try {
      const result = await containerExec(["echo", "ready"], { timeout: 3_000 });
      if (result.exitCode === 0 && result.stdout.includes("ready")) return true;
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

const NODE_PATH = "/usr/local/lib/node_modules";

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
  await page.screenshot({ path: '/tmp/piargus-screenshot.png', fullPage });
  await browser.close();
  console.log('OK');
})().catch(e => { console.error(e.message); process.exit(1); });
`.trim();

export async function screenshot(
  url: string,
  outputPath: string,
  opts?: { fullPage?: boolean; width?: number; height?: number }
): Promise<{ path: string; error?: string }> {
  const ensure = await ensureContainer();
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

  const writeResult = await containerExec(
    ["sh", "-c", `cat > /tmp/screenshot.js << 'SCRIPT'\n${SCREENSHOT_SCRIPT}\nSCRIPT`],
    { timeout: 5_000 }
  );

  if (writeResult.exitCode !== 0) {
    return { path: outputPath, error: `Failed to write screenshot script: ${writeResult.stderr}` };
  }

  const nodeResult = await containerExec(["node", "/tmp/screenshot.js"], {
    timeout: 30_000,
    env: envVars,
  });

  if (nodeResult.exitCode !== 0) {
    return { path: outputPath, error: `Screenshot failed: ${nodeResult.stderr || nodeResult.stdout}` };
  }

  const b64Result = await containerExec(["base64", "/tmp/piargus-screenshot.png"], { timeout: 10_000 });

  if (b64Result.exitCode !== 0) {
    return { path: outputPath, error: `Failed to extract screenshot: ${b64Result.stderr}` };
  }

  const imageBuffer = Buffer.from(b64Result.stdout.trim(), "base64");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, imageBuffer);

  return { path: outputPath };
}

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

export async function interact(
  url: string,
  actions: InteractionAction[],
  opts?: { timeout?: number; stealth?: boolean }
): Promise<InteractionResult> {
  const ensure = await ensureContainer();
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

  const writeResult = await containerExec(
    ["sh", "-c", `cat > /tmp/interact.js << 'SCRIPT'\n${INTERACT_SCRIPT}\nSCRIPT`],
    { timeout: 5_000 }
  );

  if (writeResult.exitCode !== 0) {
    return { success: false, error: `Failed to write interaction script: ${writeResult.stderr}` };
  }

  const nodeResult = await containerExec(["node", "/tmp/interact.js"], {
    timeout: timeoutMs,
    env: envVars,
  });

  if (nodeResult.exitCode !== 0) {
    return { success: false, error: nodeResult.stderr || nodeResult.stdout };
  }

  return { success: true, html: nodeResult.stdout };
}

export async function getContainerStatus(): Promise<ContainerState> {
  if (!isDockerInstalled()) return "not-installed";

  const name = getContainerName();
  const result = await dockerExec(["inspect", "--format={{.State.Status}}", name], 5_000);

  if (result.stdout.trim() === "running") return "running";
  if (result.stdout.trim() === "exited") return "stopped";
  if (result.exitCode !== 0) return "stopped";
  return "stopped";
}

export async function ensureSearchVm(): Promise<{ running: boolean; url?: string; error?: string }> {
  const ensure = await ensureContainer();
  if (!ensure.running) {
    return { running: false, error: ensure.error };
  }

  if (await isSearXNGReady()) {
    return { running: true, url: SEARXNG_LOCAL_URL };
  }

  const ready = await waitForSearXNG(60);
  if (ready) return { running: true, url: SEARXNG_LOCAL_URL };

  return { running: false, error: "SearXNG failed to respond. Check container logs: docker logs piargus" };
}

export async function stopContainer(): Promise<{ stopped: boolean; error?: string }> {
  _cacheRunning = false;
  _cacheCheckedAt = 0;
  const name = getContainerName();
  const stopResult = await dockerExec(["stop", name], 15_000);
  if (stopResult.exitCode !== 0 && !stopResult.stderr.includes("No such container")) {
    return { stopped: false, error: stopResult.stderr };
  }
  await dockerExec(["rm", name], 10_000);
  return { stopped: true };
}

export async function stopSearchVm(): Promise<{ stopped: boolean; error?: string }> {
  return stopContainer();
}

export async function getSearchVmStatus(): Promise<ContainerState> {
  if (await isSearXNGReady()) return "running";

  if (!isDockerInstalled()) return "not-installed";

  const status = await getContainerStatus();
  return status;
}

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

async function waitForSearXNG(maxRetries?: number): Promise<boolean> {
  const retries = maxRetries ?? 15;
  const delayMs = 500;
  for (let i = 0; i < retries; i++) {
    if (await isSearXNGReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}
