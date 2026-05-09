// pidocs-install-extract.ts — Extract install commands from fetched documentation pages

export interface InstallCommand {
  platform: string;   // "linux" | "mac" | "windows" | "cross-platform"
  manager: string;     // "npm" | "pip" | "brew" | "apt" | etc.
  command: string;     // The actual install command
  notes?: string;      // Prerequisites, version notes
}

// ─── Manager detection patterns ────────────────────────────────────────────────

const MANAGER_PATTERNS: Array<{ pattern: RegExp; manager: string }> = [
  { pattern: /\bnpm\s+install\b/, manager: "npm" },
  { pattern: /\byarn\s+add\b/, manager: "npm" },
  { pattern: /\bpnpm\s+add\b/, manager: "npm" },
  { pattern: /\bpip\s+install\b/, manager: "pip" },
  { pattern: /\bpip3\s+install\b/, manager: "pip" },
  { pattern: /\bpython\s+-m\s+pip\s+install\b/, manager: "pip" },
  { pattern: /\bbrew\s+install\s+--cask\b/, manager: "brew" },
  { pattern: /\bbrew\s+install\b/, manager: "brew" },
  { pattern: /\bsudo\s+apt(-get)?\s+install\b/, manager: "apt" },
  { pattern: /\bapt(-get)?\s+install\b/, manager: "apt" },
  { pattern: /\bcargo\s+add\b/, manager: "cargo" },
  { pattern: /\bdocker\s+pull\b/, manager: "docker" },
  { pattern: /\bgo\s+install\b/, manager: "go" },
  { pattern: /\bgo\s+get\b/, manager: "go" },
  { pattern: /\bsnap\s+install\b/, manager: "snap" },
  { pattern: /\bflatpak\s+install\b/, manager: "flatpak" },
  { pattern: /\bpacman\s+-S\b/, manager: "pacman" },
  { pattern: /\bdnf\s+install\b/, manager: "dnf" },
  { pattern: /\bchoco\s+install\b/, manager: "choco" },
];

// ─── Platform mapping ─────────────────────────────────────────────────────────

const MANAGER_PLATFORM: Record<string, string> = {
  npm: "cross-platform",
  pip: "cross-platform",
  cargo: "cross-platform",
  docker: "cross-platform",
  go: "cross-platform",
  brew: "mac",
  apt: "linux",
  pacman: "linux",
  dnf: "linux",
  snap: "linux",
  flatpak: "linux",
  choco: "windows",
};

// ─── Install command regex patterns ────────────────────────────────────────────

const INSTALL_COMMAND_PATTERNS: RegExp[] = [
  // Package manager commands
  /npm\s+install\s+[\w@/.-]+/g,
  /yarn\s+add\s+[\w@/.-]+/g,
  /pnpm\s+add\s+[\w@/.-]+/g,
  /pip3?\s+install\s+[\w.-]+/g,
  /python\s+-m\s+pip\s+install\s+[\w.-]+/g,
  /brew\s+install\s+(?:--cask\s+)?[\w.-]+/g,
  /sudo\s+apt(-get)?\s+install\s+[\w.-]+/g,
  /apt(-get)?\s+install\s+[\w.-]+/g,
  /cargo\s+add\s+[\w.-]+/g,
  /docker\s+pull\s+[\w/.-]+/g,
  /go\s+(?:get|install)\s+[\w./@-]+/g,
  /snap\s+install\s+[\w.-]+/g,
  /flatpak\s+install\s+[\w.-]+/g,
  /pacman\s+-S\s+[\w.-]+/g,
  /dnf\s+install\s+[\w.-]+/g,
  /choco\s+install\s+[\w.-]+/g,
  // Generic shell commands
  /curl\s+\S+.*\|\s*(?:sudo\s+)?sh/g,
  /make\s+install/g,
];

// ─── Prerequisite patterns ────────────────────────────────────────────────────

const PREREQ_PATTERNS: RegExp[] = [
  /requires?\s+([\w.]+\s[\d.]+[^.]*?)(?:\.|,|;|$)/gi,
  /prerequisites?:?\s+([^.\n]+)/gi,
  /needs?\s+([\w.]+\s[\d.]+[^.]*?)(?:\.|,|;|$)/gi,
  /Node\.?js\s+(\d+|latest|LTS)/gi,
  /Python\s+(\d+|[\d.]+)/gi,
  /Rust\s+([\d.]+|stable|nightly)/gi,
  /Go\s+(\d+|[\d.]+)/gi,
];

// ─── Public API ────────────────────────────────────────────────────────────────

/** Determine the package manager from a line of text */
export function extractManager(line: string): string | null {
  for (const { pattern, manager } of MANAGER_PATTERNS) {
    if (pattern.test(line)) return manager;
  }
  return null;
}

/** Determine the platform from a package manager name */
export function extractPlatform(manager: string): string {
  return MANAGER_PLATFORM[manager] || "cross-platform";
}

/** Extract install commands and prerequisites from page text */
export function extractInstallCommands(name: string, pageText: string): InstallCommand[] {
  const commands: InstallCommand[] = [];
  const seen = new Set<string>();

  // Collect prerequisites
  const notes: string[] = [];
  for (const pattern of PREREQ_PATTERNS) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(pageText)) !== null) {
      const note = match[0].trim();
      if (note && note.length < 200 && !notes.some((n) => n.includes(note))) {
        notes.push(note);
      }
    }
  }

  // Extract install commands
  for (const pattern of INSTALL_COMMAND_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(pageText)) !== null) {
      const command = match[0].trim();
      const manager = extractManager(command);
      if (!manager) continue;

      const platform = extractPlatform(manager);
      const key = `${manager}:${command}`;
      if (seen.has(key)) continue;
      seen.add(key);

      commands.push({
        platform,
        manager,
        command,
        notes: notes.length > 0 ? notes.join("; ") : undefined,
      });
    }
  }

  return commands;
}