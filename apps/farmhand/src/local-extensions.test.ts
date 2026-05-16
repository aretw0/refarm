import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
  const fns = {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
  return { ...fns, default: fns };
});

const mockFs = await import("node:fs");

const makeTractor = () => ({
  registry: {
    register: vi.fn().mockResolvedValue(undefined),
    trust: vi.fn().mockResolvedValue(undefined),
  },
  plugins: {
    load: vi.fn().mockResolvedValue({}),
  },
});

describe("LocalExtensionRegistry", () => {
  const home = "/fake/home";
  const cwd = "/fake/project";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a valid project-local extension", async () => {
    vi.mocked(mockFs.existsSync).mockImplementation((p) => {
      const s = String(p);
      // Only the cwd-based extensions dir exists (not home)
      if (s.includes("/fake/project/.refarm/extensions")) return true;
      return false;
    });
    vi.mocked(mockFs.readdirSync).mockImplementation((dir) => {
      if (String(dir).endsWith("extensions")) {
        return [{ name: "my-tool", isDirectory: () => true }] as unknown as ReturnType<typeof import("node:fs").readdirSync>;
      }
      return [] as unknown as ReturnType<typeof import("node:fs").readdirSync>;
    });
    vi.mocked(mockFs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith("ext.json"))
        return JSON.stringify({ id: "@local/my-tool", name: "My Tool", version: "0.0.1" });
      throw new Error("ENOENT");
    });

    const { LocalExtensionRegistry } = await import("./local-extensions.js");
    const registry = new LocalExtensionRegistry(cwd, home);
    const tractor = makeTractor();
    const summary = await registry.load(tractor as never);

    expect(summary.loaded).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(tractor.registry.register).toHaveBeenCalledOnce();
    expect(tractor.plugins.load).toHaveBeenCalledOnce();
  });

  it("skips extension without ext.json", async () => {
    vi.mocked(mockFs.existsSync).mockImplementation((p) => {
      const s = String(p);
      // Only the cwd-based extensions dir exists (not home)
      if (s.includes("/fake/project/.refarm/extensions")) return true;
      return false;
    });
    vi.mocked(mockFs.readdirSync).mockReturnValue(
      [{ name: "broken", isDirectory: () => true }] as unknown as ReturnType<typeof import("node:fs").readdirSync>,
    );
    vi.mocked(mockFs.readFileSync).mockImplementation(() => { throw new Error("ENOENT"); });

    const { LocalExtensionRegistry } = await import("./local-extensions.js");
    const registry = new LocalExtensionRegistry(cwd, home);
    const tractor = makeTractor();
    const summary = await registry.load(tractor as never);

    expect(summary.loaded).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(tractor.plugins.load).not.toHaveBeenCalled();
  });

  it("getLoadedIds returns loaded extension IDs", async () => {
    vi.mocked(mockFs.existsSync).mockReturnValue(true);
    vi.mocked(mockFs.readdirSync).mockImplementation((dir) => {
      if (String(dir).endsWith("extensions"))
        return [{ name: "my-tool", isDirectory: () => true }] as unknown as ReturnType<typeof import("node:fs").readdirSync>;
      return [] as unknown as ReturnType<typeof import("node:fs").readdirSync>;
    });
    vi.mocked(mockFs.readFileSync).mockReturnValue(
      JSON.stringify({ id: "@local/my-tool", name: "My Tool", version: "0.0.1" }),
    );

    const { LocalExtensionRegistry } = await import("./local-extensions.js");
    const registry = new LocalExtensionRegistry(cwd, home);
    await registry.load(makeTractor() as never);

    expect(registry.getLoadedIds()).toContain("@local/my-tool");
  });
});
