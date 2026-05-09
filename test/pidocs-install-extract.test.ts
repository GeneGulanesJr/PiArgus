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
    it("detects npm from npm install", () => {
      expect(extractManager("npm install lodash")).toBe("npm");
    });

    it("detects npm from yarn add", () => {
      expect(extractManager("yarn add react")).toBe("npm");
    });

    it("detects npm from pnpm add", () => {
      expect(extractManager("pnpm add vue")).toBe("npm");
    });

    it("detects pip from pip install", () => {
      expect(extractManager("pip install flask")).toBe("pip");
    });

    it("detects pip from pip3 install", () => {
      expect(extractManager("pip3 install flask")).toBe("pip");
    });

    it("detects pip from python -m pip install", () => {
      expect(extractManager("python -m pip install flask")).toBe("pip");
    });

    it("detects brew from brew install", () => {
      expect(extractManager("brew install ffmpeg")).toBe("brew");
    });

    it("detects brew from brew install --cask (cask variant)", () => {
      expect(extractManager("brew install --cask firefox")).toBe("brew");
    });

    it("detects apt from apt install", () => {
      expect(extractManager("sudo apt install nginx")).toBe("apt");
    });

    it("detects apt from apt-get install", () => {
      expect(extractManager("sudo apt-get install nginx")).toBe("apt");
    });

    it("detects cargo from cargo add", () => {
      expect(extractManager("cargo add tokio")).toBe("cargo");
    });

    it("detects docker from docker pull", () => {
      expect(extractManager("docker pull nginx")).toBe("docker");
    });

    it("detects snap from snap install", () => {
      expect(extractManager("snap install code")).toBe("snap");
    });

    it("detects flatpak from flatpak install", () => {
      expect(extractManager("flatpak install org.gimp.GIMP")).toBe("flatpak");
    });

    it("detects pacman from pacman -S", () => {
      expect(extractManager("pacman -S yay")).toBe("pacman");
    });

    it("detects dnf from dnf install", () => {
      expect(extractManager("dnf install nodejs")).toBe("dnf");
    });

    it("detects choco from choco install", () => {
      expect(extractManager("choco install firefox")).toBe("choco");
    });

    it("detects go from go install", () => {
      expect(extractManager("go install golang.org/x/tools/cmd/guru@latest")).toBe("go");
    });

    it("detects go from go get", () => {
      expect(extractManager("go get github.com/gin-gonic/gin")).toBe("go");
    });

    it("returns null for unrecognized commands", () => {
      expect(extractManager("ls -la")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(extractManager("")).toBeNull();
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

    it("maps cargo to cross-platform", () => {
      expect(extractPlatform("cargo")).toBe("cross-platform");
    });

    it("maps docker to cross-platform", () => {
      expect(extractPlatform("docker")).toBe("cross-platform");
    });

    it("maps go to cross-platform", () => {
      expect(extractPlatform("go")).toBe("cross-platform");
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

    it("maps dnf to linux", () => {
      expect(extractPlatform("dnf")).toBe("linux");
    });

    it("maps snap to linux", () => {
      expect(extractPlatform("snap")).toBe("linux");
    });

    it("maps flatpak to linux", () => {
      expect(extractPlatform("flatpak")).toBe("linux");
    });

    it("maps choco to windows", () => {
      expect(extractPlatform("choco")).toBe("windows");
    });

    it("returns cross-platform for unknown manager", () => {
      expect(extractPlatform("unknown")).toBe("cross-platform");
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
      expect(commands.length).toBeGreaterThanOrEqual(2);
      const npmCmd = commands.find((c) => c.manager === "npm" && c.command === "npm install lodash");
      const yarnCmd = commands.find((c) => c.manager === "npm" && c.command === "yarn add lodash");
      expect(npmCmd).toBeDefined();
      expect(yarnCmd).toBeDefined();
    });

    it("extracts pip install from page text", () => {
      const text = `
        ## Installation
        \`\`\`bash
        pip install flask
        \`\`\`
        Or with pip3:
        \`\`\`bash
        pip3 install flask
        \`\`\`
      `;
      const commands = extractInstallCommands("flask", text);
      expect(commands.length).toBeGreaterThanOrEqual(1);
      const pipCmd = commands.find((c) => c.manager === "pip");
      expect(pipCmd).toBeDefined();
      // Both "pip install" and "pip3 install" should be extracted
      const pipCommands = commands.filter((c) => c.manager === "pip");
      expect(pipCommands.length).toBe(2);
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

    it("extracts brew install --cask from page text", () => {
      const text = `
        ## Installation
        Install the cask version:
        \`\`\`bash
        brew install --cask firefox
        \`\`\`
        Or the formula:
        \`\`\`bash
        brew install firefox
        \`\`\`
      `;
      const commands = extractInstallCommands("firefox", text);
      const brewCommands = commands.filter((c) => c.manager === "brew");
      expect(brewCommands.length).toBe(2);
      expect(brewCommands.some((c) => c.command.includes("--cask"))).toBe(true);
      expect(brewCommands.some((c) => !c.command.includes("--cask"))).toBe(true);
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
      expect(aptCmd!.platform).toBe("linux");
      expect(brewCmd).toBeDefined();
      expect(brewCmd!.platform).toBe("mac");
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

    it("extracts prerequisites as notes", () => {
      const text = `
        # Installation
        Requires Node.js 18 or later.

        \`\`\`bash
        npm install mypkg
        \`\`\`
      `;
      const commands = extractInstallCommands("mypkg", text);
      expect(commands.length).toBeGreaterThanOrEqual(1);
      // Prerequisites should be captured in notes
      const npmCmd = commands.find((c) => c.manager === "npm");
      expect(npmCmd).toBeDefined();
      expect(npmCmd!.notes).toBeTruthy();
      expect(npmCmd!.notes!.toLowerCase()).toContain("node");
    });

    it("extracts Python version prerequisite", () => {
      const text = `
        ## Setup
        Requires Python 3.8+.

        \`\`\`bash
        pip install flask
        \`\`\`
      `;
      const commands = extractInstallCommands("flask", text);
      const pipCmd = commands.find((c) => c.manager === "pip");
      expect(pipCmd).toBeDefined();
      expect(pipCmd!.notes).toBeTruthy();
      expect(pipCmd!.notes!.toLowerCase()).toContain("python");
    });

    it("extracts go get and go install commands", () => {
      const text = `
        \`\`\`bash
        go get github.com/gin-gonic/gin
        \`\`\`
        Or:
        \`\`\`bash
        go install golang.org/x/tools/cmd/guru@latest
        \`\`\`
      `;
      const commands = extractInstallCommands("gin", text);
      const goCommands = commands.filter((c) => c.manager === "go");
      expect(goCommands.length).toBe(2);
    });

    it("assigns correct platform to each manager", () => {
      const text = `
        \`\`\`bash
        npm install lodash
        \`\`\`
        \`\`\`bash
        brew install ffmpeg
        \`\`\`
        \`\`\`bash
        sudo apt install nginx
        \`\`\`
        \`\`\`bash
        choco install firefox
        \`\`\`
      `;
      const commands = extractInstallCommands("test", text);
      const npmCmd = commands.find((c) => c.manager === "npm");
      const brewCmd = commands.find((c) => c.manager === "brew");
      const aptCmd = commands.find((c) => c.manager === "apt");
      const chocoCmd = commands.find((c) => c.manager === "choco");

      expect(npmCmd!.platform).toBe("cross-platform");
      expect(brewCmd!.platform).toBe("mac");
      expect(aptCmd!.platform).toBe("linux");
      expect(chocoCmd!.platform).toBe("windows");
    });
  });
});