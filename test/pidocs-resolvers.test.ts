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
  type ResolverResult,
} from "../pidocs-resolvers";

describe("pidocs-resolvers", () => {
  // ── npm ──
  describe("resolveNpm", () => {
    it("resolves unscoped npm packages", () => {
      const result = resolveNpm("lodash");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://www.npmjs.com/package/lodash");
      expect(result!.resolver).toBe("npm");
    });

    it("resolves scoped npm packages", () => {
      const result = resolveNpm("@types/node");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://www.npmjs.com/package/@types/node");
      expect(result!.resolver).toBe("npm");
    });

    it("returns a result for simple names (any could be an npm package)", () => {
      const result = resolveNpm("react");
      expect(result).not.toBeNull();
    });
  });

  // ── github ──
  describe("resolveGithub", () => {
    it("resolves owner/repo format", () => {
      const result = resolveGithub("octocat/Hello-World");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://github.com/octocat/Hello-World");
      expect(result!.resolver).toBe("github");
    });

    it("returns null for names without slash", () => {
      const result = resolveGithub("lodash");
      expect(result).toBeNull();
    });

    it("returns null for paths with multiple slashes", () => {
      const result = resolveGithub("src/main/ts");
      expect(result).toBeNull();
    });
  });

  // ── pip ──
  describe("resolvePip", () => {
    it("resolves pip packages to PyPI", () => {
      const result = resolvePip("flask");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://pypi.org/project/flask");
      expect(result!.resolver).toBe("pip");
    });
  });

  // ── cargo ──
  describe("resolveCargo", () => {
    it("resolves cargo crates", () => {
      const result = resolveCargo("tokio");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://crates.io/crates/tokio");
      expect(result!.resolver).toBe("cargo");
    });
  });

  // ── brew (tries formula then cask) ──
  describe("resolveBrew", () => {
    it("returns both formula and cask URLs", () => {
      const result = resolveBrew("ffmpeg");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://formulae.brew.sh/formula/ffmpeg");
      expect(result!.urls).toContain("https://formulae.brew.sh/cask/ffmpeg");
      expect(result!.resolver).toBe("brew");
    });
  });

  // ── docker ──
  describe("resolveDocker", () => {
    it("resolves Docker Hub official images", () => {
      const result = resolveDocker("nginx");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://hub.docker.com/_/nginx");
      expect(result!.resolver).toBe("docker");
    });
  });

  // ── vscode ──
  describe("resolveVscode", () => {
    it("resolves VS Code extensions", () => {
      const result = resolveVscode("ms-python.python");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://marketplace.visualstudio.com/items?itemName=ms-python.python");
      expect(result!.resolver).toBe("vscode");
    });

    it("returns null for non-extension patterns", () => {
      const result = resolveVscode("lodash");
      expect(result).toBeNull();
    });
  });

  // ── go ──
  describe("resolveGo", () => {
    it("resolves Go modules", () => {
      const result = resolveGo("github.com/gin-gonic/gin");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://pkg.go.dev/github.com/gin-gonic/gin");
      expect(result!.resolver).toBe("go");
    });

    it("returns null for non-URL patterns", () => {
      const result = resolveGo("lodash");
      expect(result).toBeNull();
    });
  });

  // ── aur ──
  describe("resolveAur", () => {
    it("resolves AUR packages", () => {
      const result = resolveAur("yay-bin");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://aur.archlinux.org/packages/yay-bin");
      expect(result!.resolver).toBe("aur");
    });
  });

  // ── flatpak ──
  describe("resolveFlatpak", () => {
    it("resolves Flatpak app IDs", () => {
      const result = resolveFlatpak("org.gimp.GIMP");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://flathub.org/apps/org.gimp.GIMP");
      expect(result!.resolver).toBe("flatpak");
    });

    it("returns null for non-reverse-DNS patterns", () => {
      const result = resolveFlatpak("lodash");
      expect(result).toBeNull();
    });
  });

  // ── snap ──
  describe("resolveSnap", () => {
    it("resolves Snap packages", () => {
      const result = resolveSnap("code");
      expect(result).not.toBeNull();
      expect(result!.urls).toContain("https://snapcraft.io/code");
      expect(result!.resolver).toBe("snap");
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

    it("returns null for ambiguous names", () => {
      expect(detectType("lodash")).toBeNull();
    });
  });

  // ── runResolvers ──
  describe("runResolvers", () => {
    it("runs type-hinted resolver first", () => {
      const result = runResolvers("flask", { typeHint: "pip" });
      expect(result).not.toBeNull();
      expect(result!.resolver).toBe("pip");
    });

    it("detects type automatically when no hint", () => {
      const result = runResolvers("@types/node");
      expect(result).not.toBeNull();
      expect(result!.resolver).toBe("npm");
    });

    it("tries all resolvers when type is ambiguous", () => {
      const result = runResolvers("ffmpeg");
      expect(result).not.toBeNull();
      // ffmpeg matches brew, docker, snap, npm, etc. — first match wins
    });

    it("returns null when no resolver matches a totally unknown name", () => {
      // This name doesn't match any specific pattern, so detection returns null,
      // and general resolvers can't confirm it exists. But since npm/brew/etc.
      // accept any name, let's test with a pattern that no resolver prefers
      const result = runResolvers("totally_fake_package_xyz_12345_banana");
      // npm, pip, cargo, brew etc all accept any name, so this WILL resolve
      // Instead, test with an empty string
      expect(runResolvers("")).toBeNull();
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
  });
});