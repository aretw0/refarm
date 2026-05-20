import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  };
});

const mockFs = await import("node:fs");

describe("extension commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("extensionCommand exports a Commander Command named 'extension'", async () => {
    const { extensionCommand } = await import("./extension.js");
    expect(extensionCommand.name()).toBe("extension");
  });

  it("extension new generates id as @local/<name>", async () => {
    vi.mocked(mockFs.existsSync).mockReturnValue(false);
    const { buildExtJson } = await import("./extension.js");
    const ext = buildExtJson("my-tool");
    expect(ext.id).toBe("@local/my-tool");
    expect(ext.version).toBe("0.0.1");
  });

  it("extension list reads project and global dirs", async () => {
    vi.mocked(mockFs.existsSync).mockReturnValue(true);
    vi.mocked(mockFs.readdirSync).mockReturnValue(
      [{ name: "my-tool", isDirectory: () => true }] as unknown as ReturnType<typeof import("node:fs").readdirSync>,
    );
    vi.mocked(mockFs.readFileSync).mockReturnValue(
      JSON.stringify({ id: "@local/my-tool", name: "My Tool", version: "0.0.1" }),
    );

    const { listExtensions } = await import("./extension.js");
    const result = listExtensions(process.cwd(), os.homedir());
    expect(result.some((e) => e.id === "@local/my-tool")).toBe(true);
  });

  it("save command errors when neither --global nor --local is passed", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { extensionCommand } = await import("./extension.js");

    await extensionCommand.parseAsync(["save", "my-tool"], { from: "user" });

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--global"),
    );
    consoleErrorSpy.mockRestore();
  });

  it("new command rejects names with path separators", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { extensionCommand } = await import("./extension.js");

    await extensionCommand.parseAsync(["new", "../evil"], { from: "user" });

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid extension name"),
    );
    consoleErrorSpy.mockRestore();
  });
});
