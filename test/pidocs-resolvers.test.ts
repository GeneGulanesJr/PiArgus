// test/pidocs-resolvers.test.ts
import { describe, it, expect } from "vitest";
import {
  resolveNpm,
  resolveGithub,
  resolvePip,
  resolveCargo,
  resolveBrew,
  resolveDocker,
  resolveVscode,
  resolveGo,
  resolveAur,
  resolveFlatpak,
  resolveSnap,
  detectType,
  runResolvers,
  loadPidocsConfig,
} from "../pidocs-resolvers";

describe("pidocs-resolvers", () => {
  // ── npm ──
  describe("resolveNpm", () => {
    it("resolves unscoped npm packages with correct URL", () => {
      const result = resolveNpm("lodash");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toBe("https://www.npmjs.com/package/lodash");
      expect(result!.resolver).toBe("npm");
    });

    it("resolves scoped npm packages", () => {
      const result = resolveNpm("@types/node");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toBe("https://www.npmjs.com/package/@types/node");
    });

    it("resolves packages with dots in name", () => {
      const result = resolveNpm("core-js");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toContain("npmjs.com");
    });

    it("returns null for empty string", () => {
      expect(resolveNpm("")).toBeNull();
    });

    it("returns null for URLs", () => {
      expect(resolveNpm("https://example.com")).toBeNull();
    });

    it("returns null for names starting with digits", () => {
      expect(resolveNpm("123abc")).toBeNull();
    });

    it("returns null for names with spaces", () => {
      expect(resolveNpm("my package")).toBeNull();
    });
  });

  // ── github ──
  describe("resolveGithub", () => {
    it("resolves owner/repo format with correct URL", () => {
      const result = resolveGithub("octocat/Hello-World");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toBe("https://github.com/octocat/Hello-World");
      expect(result!.resolver).toBe("github");
    });

    it("returns null for names without slash", () => {
      expect(resolveGithub("lodash")).toBeNull();
    });

    it("returns null for paths with multiple slashes", () => {
      expect(resolveGithub("src/main/ts")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(resolveGithub("")).toBeNull();
    });

    it("returns null for single-segment path like /repo", () => {
      expect(resolveGithub("/repo")).toBeNull();
    });
  });

  // ── pip ──
  describe("resolvePip", () => {
    it("resolves pip packages to PyPI with correct URL", () => {
      const result = resolvePip("flask");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toBe("https://pypi.org/project/flask");
      expect(result!.resolver).toBe("pip");
    });

    it("resolves packages with dots and hyphens", () => {
      const result = resolvePip("python-dateutil");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toContain("pypi.org");
    });

    it("returns null for scoped packages (@scope/name)", () => {
      expect(resolvePip("@types/node")).toBeNull();
    });

    it("returns null for paths with slashes", () => {
      expect(resolvePip("some/path")).toBeNull();
    });

    it("returns null for names starting with digits", () => {
      expect(resolvePip("3to2")).toBeNull();
    });
  });

  // ── cargo ──
  describe("resolveCargo", () => {
    it("resolves cargo crates with correct URL", () => {
      const result = resolveCargo("tokio");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toBe("https://crates.io/crates/tokio");
      expect(result!.resolver).toBe("cargo");
    });

    it("resolves crates with hyphens", () => {
      const result = resolveCargo("serde-json");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toContain("crates.io");
    });

    it("returns null for scoped names", () => {
      expect(resolveCargo("@scope/name")).toBeNull();
    });

    it("returns null for names with slashes", () => {
      expect(resolveCargo("some/path")).toBeNull();
    });

    it("returns null for names starting with digits", () => {
      expect(resolveCargo("42crate")).toBeNull();
    });
  });

  // ── brew ──
  describe("resolveBrew", () => {
    it("returns both formula and cask URLs", () => {
      const result = resolveBrew("ffmpeg");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://formulae.brew.sh/formula/ffmpeg");
      expect(result!.urls).toContain("https://formulae.brew.sh/cask/ffmpeg");
      expect(result!.resolver).toBe("brew");
    });

    it("returns null for names starting with digits", () => {
      expect(resolveBrew("2to3")).toBeNull();
    });

    it("returns null for names with slashes", () => {
      expect(resolveBrew("some/formula")).toBeNull();
    });
  });

  // ── docker ──
  describe("resolveDocker", () => {
    it("resolves Docker Hub official images", () => {
      const result = resolveDocker("nginx");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toBe("https://hub.docker.com/_/nginx");
      expect(result!.resolver).toBe("docker");
    });

    it("returns null for scoped names with @", () => {
      expect(resolveDocker("@scope/image")).toBeNull();
    });

    it("returns null for user images with slash (use github instead)", () => {
      expect(resolveDocker("user/image")).toBeNull();
    });

    it("returns null for names starting with digits", () => {
      expect(resolveDocker("123image")).toBeNull();
    });
  });

  // ── vscode ──
  describe("resolveVscode", () => {
    it("resolves VS Code extensions with correct URL", () => {
      const result = resolveVscode("ms-python.python");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toBe("https://marketplace.visualstudio.com/items?itemName=ms-python.python");
      expect(result!.resolver).toBe("vscode");
    });

    it("returns null for names without dots", () => {
      expect(resolveVscode("lodash")).toBeNull();
    });

    it("returns null for names starting with @", () => {
      expect(resolveVscode("@scope/name")).toBeNull();
    });

    it("returns null for names with slashes", () => {
      expect(resolveVscode("some/thing.ext")).toBeNull();
    });
  });

  // ── go ──
  describe("resolveGo", () => {
    it("resolves Go modules with correct URL", () => {
      const result = resolveGo("github.com/gin-gonic/gin");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toBe("https://pkg.go.dev/github.com/gin-gonic/gin");
      expect(result!.resolver).toBe("go");
    });

    it("returns null for names without dots or slashes", () => {
      expect(resolveGo("lodash")).toBeNull();
    });

    it("returns null for names without domain (no dot)", () => {
      expect(resolveGo("github/something")).toBeNull();
    });
  });

  // ── aur ──
  describe("resolveAur", () => {
    it("resolves AUR packages with correct URL", () => {
      const result = resolveAur("yay-bin");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toBe("https://aur.archlinux.org/packages/yay-bin");
      expect(result!.resolver).toBe("aur");
    });

    it("returns null for names starting with digits", () => {
      expect(resolveAur("123pkg")).toBeNull();
    });

    it("returns null for names with slashes", () => {
      expect(resolveAur("some/pkg")).toBeNull();
    });
  });

  // ── flatpak ──
  describe("resolveFlatpak", () => {
    it("resolves Flatpak app IDs with correct URL", () => {
      const result = resolveFlatpak("org.gimp.GIMP");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toBe("https://flathub.org/apps/org.gimp.GIMP");
      expect(result!.resolver).toBe("flatpak");
    });

    it("returns null for simple names without dots", () => {
      expect(resolveFlatpak("lodash")).toBeNull();
    });

    it("returns null for names with slashes", () => {
      expect(resolveFlatpak("org/example/app")).toBeNull();
    });
  });

  // ── snap ──
  describe("resolveSnap", () => {
    it("resolves Snap packages with correct URL", () => {
      const result = resolveSnap("code");
      expect(result).not.toBeNull();
      expect(result!.urls[0]).toBe("https://snapcraft.io/code");
      expect(result!.resolver).toBe("snap");
    });

    it("returns null for names with dots (likely flatpak/vscode)", () => {
      expect(resolveSnap("org.gimp.GIMP")).toBeNull();
    });

    it("returns null for names with slashes", () => {
      expect(resolveSnap("some/snap")).toBeNull();
    });

    it("returns null for names starting with digits", () => {
      expect(resolveSnap("123snap")).toBeNull();
    });
  });

  // ── type detection ──
  describe("detectType", () => {
    it("detects npm scoped packages", () => {
      expect(detectType("@types/node")).toBe("npm");
    });

    it("detects github owner/repo", () => {
      expect(detectType("octocat/Hello-World")).toBe("github");
    });

    it("detects VS Code extensions", () => {
      expect(detectType("ms-python.python")).toBe("vscode");
    });

    it("detects Flatpak app IDs", () => {
      expect(detectType("org.gimp.GIMP")).toBe("flatpak");
    });

    it("detects Go modules", () => {
      expect(detectType("github.com/gin-gonic/gin")).toBe("go");
    });

    it("returns null for ambiguous single-word names", () => {
      expect(detectType("lodash")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(detectType("")).toBeNull();
    });
  });

  // ── runResolvers ──
  describe("runResolvers", () => {
    it("runs type-hinted resolver first", () => {
      const result = runResolvers("flask", { typeHint: "pip" });
      expect(result).not.toBeNull();
      expect(result!.resolver).toBe("pip");
    });

    it("detects type automatically for scoped npm packages", () => {
      const result = runResolvers("@types/node");
      expect(result).not.toBeNull();
      expect(result!.resolver).toBe("npm");
    });

    it("returns null for invalid names when no resolver matches", () => {
      // Names that don't match any resolver pattern
      expect(runResolvers("")).toBeNull();
      expect(runResolvers("123numbers")).toBeNull();
      expect(runResolvers("   ")).toBeNull();
    });

    it("returns null when all resolvers are disabled", () => {
      const disabledConfig = {
        resolvers: {
          npm: { enabled: false },
          github: { enabled: false },
          pip: { enabled: false },
          cargo: { enabled: false },
          brew: { enabled: false },
          docker: { enabled: false },
          vscode: { enabled: false },
          go: { enabled: false },
          aur: { enabled: false },
          flatpak: { enabled: false },
          snap: { enabled: false },
          custom: [],
        },
      };
      expect(runResolvers("lodash", { config: disabledConfig as any })).toBeNull();
    });

    it("uses type hint even when auto-detection would choose differently", () => {
      // "ffmpeg" with brew type hint → brew resolver
      const result = runResolvers("ffmpeg", { typeHint: "brew" });
      expect(result).not.toBeNull();
      expect(result!.resolver).toBe("brew");
    });
  });

  // ── config loading ──
  describe("loadPidocsConfig", () => {
    it("returns defaults when no config file exists", () => {
      const config = loadPidocsConfig("/nonexistent/path/.pidocs.json");
      expect(config.searxngUrl).toBeUndefined();
      expect(config.resolvers.npm.enabled).toBe(true);
      expect(config.resolvers.custom).toEqual([]);
    });

    it("enables all resolvers by default", () => {
      const config = loadPidocsConfig("/nonexistent/path/.pidocs.json");
      const resolverKeys = ["npm", "github", "pip", "cargo", "brew", "docker", "vscode", "go", "aur", "flatpak", "snap"] as const;
      for (const key of resolverKeys) {
        expect(config.resolvers[key].enabled).toBe(true);
      }
    });
  });
});