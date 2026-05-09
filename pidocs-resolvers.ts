// pidocs-resolvers.ts — Built-in registry resolvers + config + type detection
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResolverResult {
  urls: string[];
  installUrl?: string;
  resolver: string;
}

export interface ResolverConfig {
  enabled: boolean;
}

export interface CustomResolverConfig {
  name: string;
  pattern: string;        // Regex pattern string
  urlTemplate: string;    // URL template with {name} placeholder
  type: string;            // Maps to which built-in type for install extraction
}

export interface PidocsConfig {
  searxngUrl?: string;
  resolvers: {
    npm: ResolverConfig;
    github: ResolverConfig;
    pip: ResolverConfig;
    cargo: ResolverConfig;
    brew: ResolverConfig;
    docker: ResolverConfig;
    vscode: ResolverConfig;
    go: ResolverConfig;
    aur: ResolverConfig;
    flatpak: ResolverConfig;
    snap: ResolverConfig;
    custom: CustomResolverConfig[];
  };
}

const DEFAULT_CONFIG: PidocsConfig = {
  resolvers: {
    npm: { enabled: true },
    github: { enabled: true },
    pip: { enabled: true },
    cargo: { enabled: true },
    brew: { enabled: true },
    docker: { enabled: true },
    vscode: { enabled: true },
    go: { enabled: true },
    aur: { enabled: true },
    flatpak: { enabled: true },
    snap: { enabled: true },
    custom: [],
  },
};

// ─── Config loading ──────────────────────────────────────────────────────────

export function loadPidocsConfig(configPath?: string): PidocsConfig {
  const path = configPath || join(homedir(), ".pidocs.json");
  try {
    if (!existsSync(path)) {
      return { ...DEFAULT_CONFIG, resolvers: { ...DEFAULT_CONFIG.resolvers, custom: [] } };
    }
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    // Merge with defaults
    return {
      searxngUrl: parsed.searxngUrl,
      resolvers: {
        ...DEFAULT_CONFIG.resolvers,
        ...parsed.resolvers,
        custom: parsed.resolvers?.custom || [],
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG, resolvers: { ...DEFAULT_CONFIG.resolvers, custom: [] } };
  }
}

// ─── Individual resolvers ────────────────────────────────────────────────────

export function resolveNpm(name: string): ResolverResult | null {
  if (!name || name.startsWith("http")) return null;
  // Must be scoped (@scope/name) or a plausible package name:
  // starts with letter, contains only letters, digits, hyphens, underscores, dots
  if (/^@[\w-]+\/[\w.-]+$/.test(name)) {
    // Scoped package — always valid
  } else if (/^[a-zA-Z][\w.-]*$/.test(name)) {
    // Unscoped — must look like a real package name (starts with letter)
  } else {
    return null;
  }
  return {
    urls: [`https://www.npmjs.com/package/${name}`],
    installUrl: `https://www.npmjs.com/package/${name}`,
    resolver: "npm",
  };
}

export function resolveGithub(name: string): ResolverResult | null {
  // Must be owner/repo format (exactly one slash, both parts start with letter/digit)
  const match = name.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (!match) return null;
  return {
    urls: [`https://github.com/${match[1]}/${match[2]}`],
    installUrl: `https://github.com/${match[1]}/${match[2]}`,
    resolver: "github",
  };
}

export function resolvePip(name: string): ResolverResult | null {
  if (!name || name.startsWith("@") || name.includes("/")) return null;
  // Must look like a Python package name: starts with letter, alphanumeric/hyphens/dots
  if (!/^[a-zA-Z][\w.-]*$/.test(name)) return null;
  return {
    urls: [`https://pypi.org/project/${name}`],
    installUrl: `https://pypi.org/project/${name}`,
    resolver: "pip",
  };
}

export function resolveCargo(name: string): ResolverResult | null {
  if (!name || name.startsWith("@") || name.includes("/")) return null;
  // Must look like a Rust crate name: starts with letter, alphanumeric + hyphens/underscores
  if (!/^[a-zA-Z][\w-]*$/.test(name)) return null;
  return {
    urls: [`https://crates.io/crates/${name}`],
    installUrl: `https://crates.io/crates/${name}`,
    resolver: "cargo",
  };
}

export function resolveBrew(name: string): ResolverResult | null {
  if (!name || name.startsWith("@") || name.includes("/")) return null;
  // Must look like a Homebrew formula/cask name: starts with letter, alphanumeric + hyphens
  if (!/^[a-zA-Z][\w-]*$/.test(name)) return null;
  // Try both formula and cask since we can't know which without fetching
  return {
    urls: [
      `https://formulae.brew.sh/formula/${name}`,
      `https://formulae.brew.sh/cask/${name}`,
    ],
    installUrl: `https://formulae.brew.sh/formula/${name}`,
    resolver: "brew",
  };
}

export function resolveDocker(name: string): ResolverResult | null {
  if (!name || name.startsWith("@") || name.includes("/")) return null;
  // Must look like a Docker official image name: starts with letter, alphanumeric + hyphens
  if (!/^[a-zA-Z][\w-]*$/.test(name)) return null;
  return {
    urls: [`https://hub.docker.com/_/${name}`],
    installUrl: `https://hub.docker.com/_/${name}`,
    resolver: "docker",
  };
}

export function resolveVscode(name: string): ResolverResult | null {
  // VS Code extension pattern: publisher.extension (e.g., ms-python.python)
  if (!name.includes(".") || name.startsWith("@") || name.includes("/")) return null;
  // Must have at least one dot separating publisher from extension name
  if (!/^[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+$/.test(name)) return null;
  return {
    urls: [`https://marketplace.visualstudio.com/items?itemName=${name}`],
    installUrl: `https://marketplace.visualstudio.com/items?itemName=${name}`,
    resolver: "vscode",
  };
}

export function resolveGo(name: string): ResolverResult | null {
  // Go module paths look like github.com/user/repo or other domain paths
  if (!name.includes(".") || !name.includes("/")) return null;
  return {
    urls: [`https://pkg.go.dev/${name}`],
    installUrl: `https://pkg.go.dev/${name}`,
    resolver: "go",
  };
}

export function resolveAur(name: string): ResolverResult | null {
  if (!name || name.startsWith("@") || name.includes("/")) return null;
  // AUR names: starts with letter, alphanumeric + hyphens, commonly ending in -git/-bin
  if (!/^[a-zA-Z][\w-]*$/.test(name)) return null;
  return {
    urls: [`https://aur.archlinux.org/packages/${name}`],
    installUrl: `https://aur.archlinux.org/packages/${name}`,
    resolver: "aur",
  };
}

export function resolveFlatpak(name: string): ResolverResult | null {
  // Flatpak app IDs use reverse-DNS format (e.g., org.gimp.GIMP)
  if (!name.includes(".") || name.includes("/")) return null;
  // Must look like a reverse-domain identifier
  if (!/^[a-zA-Z][\w.-]*$/.test(name)) return null;
  // Must have at least 1 dot to look like org.gimp.GIMP vs just some.project
  const dotCount = (name.match(/\./g) || []).length;
  if (dotCount < 1) return null;
  return {
    urls: [`https://flathub.org/apps/${name}`],
    installUrl: `https://flathub.org/apps/${name}`,
    resolver: "flatpak",
  };
}

export function resolveSnap(name: string): ResolverResult | null {
  if (!name || name.startsWith("@") || name.includes("/") || name.includes(".")) return null;
  // Snap names: starts with letter, alphanumeric + hyphens
  if (!/^[a-zA-Z][\w-]*$/.test(name)) return null;
  return {
    urls: [`https://snapcraft.io/${name}`],
    installUrl: `https://snapcraft.io/${name}`,
    resolver: "snap",
  };
}

// ─── Type detection ──────────────────────────────────────────────────────────

export function detectType(name: string): string | null {
  // Scoped npm package: @scope/name
  if (/^@[\w-]+\/[\w.-]+$/.test(name)) return "npm";

  // Go module path: contains dots and slashes like github.com/user/repo
  if (/^[a-zA-Z][\w.-]*\.[\w.-]+\/[\w.-]+/.test(name)) return "go";

  // VS Code extension: publisher.extension (dot-separated, starts with letter)
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+$/.test(name) && name.includes(".")) {
    // Distinguish from flatpak: vscode extensions typically have a short
    // publisher prefix like ms-python, esbenp, etc.
    const firstSegment = name.split(".")[0];
    if (/^[a-z]+-[a-z]+$/i.test(firstSegment) && firstSegment.length <= 15) {
      return "vscode";
    }
  }

  // Flatpak app ID: reverse-DNS (org.gimp.GIMP) — has 2+ dots
  if (/^[a-zA-Z][\w]*\.[\w]+\.[\w]+$/.test(name)) return "flatpak";

  // GitHub owner/repo: exactly one slash, both parts start with letter
  if (/^[a-zA-Z][\w-]*\/[a-zA-Z][\w.-]+$/.test(name)) return "github";

  // Ambiguous single word — could be npm, pip, cargo, brew, etc.
  return null;
}

// ─── Resolver config helper ────────────────────────────────────────────────

/** Check if a resolver config entry is disabled. Handles both ResolverConfig and CustomResolverConfig[]. */
function isResolverDisabled(config: ResolverConfig | CustomResolverConfig[]): boolean {
  if (Array.isArray(config)) return false; // custom array is never "disabled"
  return config.enabled === false;
}

// ─── Resolver runner ─────────────────────────────────────────────────────────

type ResolverFn = (name: string) => ResolverResult | null;

interface ResolverEntry {
  key: string;
  fn: ResolverFn;
}

const RESOLVERS: ResolverEntry[] = [
  { key: "npm", fn: resolveNpm },
  { key: "github", fn: resolveGithub },
  { key: "vscode", fn: resolveVscode },
  { key: "go", fn: resolveGo },
  { key: "flatpak", fn: resolveFlatpak },
  { key: "pip", fn: resolvePip },
  { key: "cargo", fn: resolveCargo },
  { key: "brew", fn: resolveBrew },
  { key: "docker", fn: resolveDocker },
  { key: "aur", fn: resolveAur },
  { key: "snap", fn: resolveSnap },
];

export function runResolvers(
  name: string,
  options?: { typeHint?: string; config?: PidocsConfig }
): ResolverResult | null {
  const config = options?.config || DEFAULT_CONFIG;

  // If type hint provided, try that resolver first
  if (options?.typeHint) {
    const entry = RESOLVERS.find((r) => r.key === options.typeHint);
    if (entry) {
      const resolverConfig = config.resolvers[entry.key as keyof typeof config.resolvers];
      if (!isResolverDisabled(resolverConfig)) {
        const result = entry.fn(name);
        if (result) return result;
      }
    }
  }

  // Auto-detect type
  const detectedType = detectType(name);
  if (detectedType) {
    const entry = RESOLVERS.find((r) => r.key === detectedType);
    if (entry) {
      const resolverConfig = config.resolvers[entry.key as keyof typeof config.resolvers];
      if (!isResolverDisabled(resolverConfig)) {
        const result = entry.fn(name);
        if (result) return result;
      }
    }
  }

  // Try all resolvers in priority order
  for (const entry of RESOLVERS) {
    const resolverConfig = config.resolvers[entry.key as keyof typeof config.resolvers];
    if (isResolverDisabled(resolverConfig)) continue;
    const result = entry.fn(name);
    if (result) return result;
  }

  // Custom resolvers
  for (const custom of config.resolvers.custom) {
    const regex = new RegExp(custom.pattern);
    if (regex.test(name)) {
      const url = custom.urlTemplate.replace("{name}", name);
      return {
        urls: [url],
        installUrl: url,
        resolver: custom.name,
      };
    }
  }

  return null;
}