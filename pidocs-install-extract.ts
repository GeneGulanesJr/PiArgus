// pidocs-install-extract.ts — Extract install commands from fetched documentation pages

export interface InstallCommand {
  platform: string;   // "linux" | "mac" | "windows" | "cross-platform"
  manager: string;     // "npm" | "pip" | "brew" | "apt" | etc.
  command: string;     // The actual install command
  notes?: string;      // Prerequisites, version notes
}

// ─── Manager detection patterns ────────────────────────────────────────────────

const MANAGER_PATTERNS: Array<{ source: string; manager: string }> = [
  { source: "\\bnpm\\s+install\\b", manager: "npm" },
  { source: "\\byarn\\s+add\\b", manager: "npm" },
  { source: "\\bpnpm\\s+add\\b", manager: "npm" },
  { source: "\\bpip\\s+install\\b", manager: "pip" },
  { source: "\\bpip3\\s+install\\b", manager: "pip" },
  { source: "\\bpython\\s+-m\\s+pip\\s+install\\b", manager: "pip" },
  { source: "\\bbrew\\s+install\\s+--cask\\b", manager: "brew" },
  { source: "\\bbrew\\s+install\\b", manager: "brew" },
  { source: "\\bsudo\\s+apt(-get)?\\s+install\\b", manager: "apt" },
  { source: "\\bapt(-get)?\\s+install\\b", manager: "apt" },
  { source: "\\bcargo\\s+add\\b", manager: "cargo" },
  { source: "\\bdocker\\s+pull\\b", manager: "docker" },
  { source: "\\bgo\\s+install\\b", manager: "go" },
  { source: "\\bgo\\s+get\\b", manager: "go" },
  { source: "\\bsnap\\s+install\\b", manager: "snap" },
  { source: "\\bflatpak\\s+install\\b", manager: "flatpak" },
  { source: "\\bpacman\\s+-S\\b", manager: "pacman" },
  { source: "\\bdnf\\s+install\\b", manager: "dnf" },
  { source: "\\bchoco\\s+install\\b", manager: "choco" },
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

const INSTALL_COMMAND_PATTERN_SOURCES: string[] = [
  "npm\\s+install\\s+[\\w@/.-]+",
  "yarn\\s+add\\s+[\\w@/.-]+",
  "pnpm\\s+add\\s+[\\w@/.-]+",
  "pip3?\\s+install\\s+[\\w.-]+",
  "python\\s+-m\\s+pip\\s+install\\s+[\\w.-]+",
  "brew\\s+install\\s+(?:--cask\\s+)?[\\w.-]+",
  "sudo\\s+apt(-get)?\\s+install\\s+[\\w.-]+",
  "apt(-get)?\\s+install\\s+[\\w.-]+",
  "cargo\\s+add\\s+[\\w.-]+",
  "docker\\s+pull\\s+[\\w/.-]+",
  "go\\s+(?:get|install)\\s+[\\w./@-]+",
  "snap\\s+install\\s+[\\w.-]+",
  "flatpak\\s+install\\s+[\\w.-]+",
  "pacman\\s+-S\\s+[\\w.-]+",
  "dnf\\s+install\\s+[\\w.-]+",
  "choco\\s+install\\s+[\\w.-]+",
  "curl\\s+\\S+.*\\|\\s*(?:sudo\\s+)?sh",
  "make\\s+install",
];

// ─── Prerequisite patterns ────────────────────────────────────────────────────

const PREREQ_PATTERN_SOURCES: string[] = [
  "requires?\\s+([\\w.]+\\s[\\d.]+[^.]*?)(?:\\.|,|;|$)",
  "prerequisites?:?\\s+([^.\\n]+)",
  "needs?\\s+([\\w.]+\\s[\\d.]+[^.]*?)(?:\\.|,|;|$)",
  "Node\\.?js\\s+(\\d+|latest|LTS)",
  "Python\\s+(\\d+|[\\d.]+)",
  "Rust\\s+([\\d.]+|stable|nightly)",
  "Go\\s+(\\d+|[\\d.]+)",
];

// ─── Public API ────────────────────────────────────────────────────────────────

/** Determine the package manager from a line of text */
export function extractManager(line: string): string | null {
  for (const { source, manager } of MANAGER_PATTERNS) {
    if (new RegExp(source).test(line)) return manager;
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

  const prereqPatterns = PREREQ_PATTERN_SOURCES.map(s => new RegExp(s, "gi"));

  const notes: string[] = [];
  for (const pattern of prereqPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(pageText)) !== null) {
      const note = match[0].trim();
      if (note && note.length < 200 && !notes.some((n) => n.includes(note))) {
        notes.push(note);
      }
    }
  }

  const installPatterns = INSTALL_COMMAND_PATTERN_SOURCES.map(s => new RegExp(s, "g"));

  for (const pattern of installPatterns) {
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