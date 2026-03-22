import fs from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { switchResolution } from "../../reso.mjs";

// Mock do fs para não alterar arquivos reais durante os testes
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    default: {
      ...actual.default,
      readdirSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      existsSync: vi.fn(),
    },
  };
});

vi.mock("chalk", () => ({
  default: {
    blue: (s) => s,
    green: (s) => s,
    yellow: (s) => s,
    gray: (s) => s,
    bold: (s) => s,
    dim: (s) => s,
  },
}));

describe("switchResolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should identify a package as LOCAL if it points to src/", async () => {
    const mockPkgJson = JSON.stringify({
      name: "@refarm.dev/test-pkg",
      main: "./src/index.ts",
      types: "./src/index.ts",
    });

    vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (p.toString().includes("packages")) return ["test-pkg"];
        return [];
    });
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p.toString().includes("package.json") || p.toString().includes("packages") || p.toString().includes("apps"),
    );
    vi.mocked(fs.readFileSync).mockReturnValue(mockPkgJson);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await switchResolution("status", { rootDir: "/mock/root" });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("LOCAL (src)"),
    );
    consoleSpy.mockRestore();
  });

  it("should identify a package as PUBLISHED if it points to dist/", async () => {
    const mockPkgJson = JSON.stringify({
      name: "@refarm.dev/test-pkg",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
    });

    vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (p.toString().includes("packages")) return ["test-pkg"];
        return [];
    });
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p.toString().includes("package.json") || p.toString().includes("packages") || p.toString().includes("apps"),
    );
    vi.mocked(fs.readFileSync).mockReturnValue(mockPkgJson);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await switchResolution("status", { rootDir: "/mock/root" });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("PUBLISHED (dist)"),
    );
    consoleSpy.mockRestore();
  });

  it("should handle complex exports and identify LOCAL status only if entry point is src", async () => {
    const mockPkgJson = JSON.stringify({
      name: "@refarm.dev/complex-pkg",
      exports: {
        ".": "./src/index.ts",
        "./test-utils": "./dist/test/test-utils.js",
      },
    });

    vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (p.toString().includes("packages")) return ["complex-pkg"];
        return [];
    });
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p.toString().includes("package.json") || p.toString().includes("packages") || p.toString().includes("apps"),
    );
    vi.mocked(fs.readFileSync).mockReturnValue(mockPkgJson);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await switchResolution("status", { rootDir: "/mock/root" });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("LOCAL (src)"),
    );
    consoleSpy.mockRestore();
  });

  it("should identify PUBLISHED if exports root points to dist even if sub-exports point to src", async () => {
    const mockPkgJson = JSON.stringify({
      name: "@refarm.dev/complex-pkg",
      exports: {
        ".": "./dist/index.js",
        "./test-utils": "./src/test-utils.ts",
      },
    });

    vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (p.toString().includes("packages")) return ["complex-pkg"];
        return [];
    });
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p.toString().includes("package.json") || p.toString().includes("packages") || p.toString().includes("apps"),
    );
    vi.mocked(fs.readFileSync).mockReturnValue(mockPkgJson);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await switchResolution("status", { rootDir: "/mock/root" });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("PUBLISHED (dist)"),
    );
    consoleSpy.mockRestore();
  });
});
