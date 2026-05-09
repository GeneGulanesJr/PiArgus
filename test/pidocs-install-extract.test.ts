// test/pidocs-install-extract.test.ts
import { describe, it, expect } from "vitest";
import {
  extractInstallCommands,
  extractPlatform,
  extractManager,
  type InstallCommand,
} from "../pidocs-install-extract";

describe("pidocs-install-extract", () => {
  // ── extractManager ──
  describe("extractManager", () => {
    it("detects npm from text", () => {
      expect(extractManager("npm install lodash")).toBe("npm");
    });

    it("detects yarn from text", () => {
      expect(extractManager("yarn add react")).toBe("npm");
    });

    it("detects pnpm from text", () => {
      expect(extractManager("pnpm add vue")).toBe("npm");
    });

    it("detects pip from text", () => {
      expect(extractManager("pip install flask")).toBe("pip");
    });

    it("detects brew from text", () => {
      expect(extractManager("brew install ffmpeg")).toBe("brew");
    });

    it("detects apt from text", () => {
      expect(extractManager("sudo apt install nginx")).toBe("apt");
    });

    it("detects cargo from text", () => {
      expect(extractManager("cargo add tokio")).toBe("cargo");
    });

    it("detects docker from text", () => {
      expect(extractManager("docker pull nginx")).toBe("docker");
    });

    it("detects snap from text", () => {
      expect(extractManager("snap install code")).toBe("snap");
    });

    it("detects flatpak from text", () => {
      expect(extractManager("flatpak install org.gimp.GIMP")).toBe("flatpak");
    });

    it("detects pacman from text", () => {
      expect(extractManager("pacman -S yay")).toBe("pacman");
    });

    it("detects dnf from text", () => {
      expect(extractManager("dnf install nodejs")).toBe("dnf");
    });

    it("detects choco from text", () => {
      expect(extractManager("choco install firefox")).toBe("choco");
    });

    it("returns null for unrecognized commands", () => {
      expect(extractManager("ls -la")).toBeNull();
    });
  });

  // ── extractPlatform ──
  describe("extractPlatform", () => {
    it("maps npm/yarn/pnpm to cross-platform", () => {
      expect(extractPlatform("npm")).toBe("cross-platform");
    });

    it("maps pip to cross-platform", () => {
      expect(extractPlatform("pip")).toBe("cross-platform");
    });

    it("maps brew to mac", () => {
      expect(extractPlatform("brew")).toBe("mac");
    });

    it("maps apt to linux", () => {
      expect(extractPlatform("apt")).toBe("linux");
    });

    it("maps pacman to linux", () => {
      expect(extractPlatform("pacman")).toBe("linux");
    });

    it("maps choco to windows", () => {
      expect(extractPlatform("choco")).toBe("windows");
    });
  });

  // ── extractInstallCommands ──
  describe("extractInstallCommands", () => {
    it("extracts npm install from page text", () => {
      const text = `
        # Installation
        Install the package using npm:
        \`\`\`bash
        npm install lodash
        \`\`\`
        Or with yarn:
        \`\`\`bash
        yarn add lodash
        \`\`\`
      `;
      const commands = extractInstallCommands("lodash", text);
      expect(commands.length).toBeGreaterThanOrEqual(1);
      const npmCmd = commands.find((c) => c.manager === "npm");
      expect(npmCmd).toBeDefined();
      expect(npmCmd!.command).toContain("npm install lodash");
    });

    it("extracts pip install from page text", () => {
      const text = `
        ## Installation
        \`\`\`bash
        pip install flask
        \`\`\`
      `;
      const commands = extractInstallCommands("flask", text);
      expect(commands.length).toBeGreaterThanOrEqual(1);
      const pipCmd = commands.find((c) => c.manager === "pip");
      expect(pipCmd).toBeDefined();
      expect(pipCmd!.command).toContain("pip install flask");
    });

    it("extracts brew install from page text", () => {
      const text = `
        Install with Homebrew:
        \`\`\`bash
        brew install ffmpeg
        \`\`\`
      `;
      const commands = extractInstallCommands("ffmpeg", text);
      expect(commands.length).toBeGreaterThanOrEqual(1);
      const brewCmd = commands.find((c) => c.manager === "brew");
      expect(brewCmd).toBeDefined();
      expect(brewCmd!.command).toContain("brew install ffmpeg");
    });

    it("extracts multi-platform commands", () => {
      const text = `
        ## Installation
        Linux:
        \`\`\`bash
        sudo apt install nginx
        \`\`\`
        macOS:
        \`\`\`bash
        brew install nginx
        \`\`\`
      `;
      const commands = extractInstallCommands("nginx", text);
      expect(commands.length).toBeGreaterThanOrEqual(2);
      const aptCmd = commands.find((c) => c.manager === "apt");
      const brewCmd = commands.find((c) => c.manager === "brew");
      expect(aptCmd).toBeDefined();
      expect(brewCmd).toBeDefined();
    });

    it("returns empty array for pages with no install commands", () => {
      const text = `
        # About
        This is a description of the project.
        It does interesting things.
      `;
      const commands = extractInstallCommands("nothing", text);
      expect(commands).toEqual([]);
    });

    it("deduplicates commands for same manager", () => {
      const text = `
        \`\`\`bash
        npm install react
        \`\`\`
        Also you can:
        \`\`\`bash
        npm install react
        \`\`\`
      `;
      const commands = extractInstallCommands("react", text);
      const npmCommands = commands.filter((c) => c.manager === "npm");
      expect(npmCommands.length).toBe(1);
    });
  });
});