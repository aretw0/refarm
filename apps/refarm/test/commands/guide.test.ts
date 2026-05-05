import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockProvision, mockWriteFileSync } = vi.hoisted(() => ({
  mockProvision: vi.fn().mockReturnValue({
    REFARM_GITHUB_TOKEN: "ghp_test",
    REFARM_CLOUDFLARE_API_TOKEN: undefined,
  }),
  mockWriteFileSync: vi.fn(),
}));

vi.mock("@refarm.dev/config", () => ({
  loadConfig: vi.fn().mockReturnValue({ brand: { name: "test-farm" } }),
}));

vi.mock("@refarm.dev/silo", () => ({
  SiloCore: vi.fn().mockImplementation(function () {
    return { provision: mockProvision };
  }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    writeFileSync: mockWriteFileSync,
    default: { ...actual.default, writeFileSync: mockWriteFileSync },
  };
});

import { guideCommand } from "../../src/commands/guide.js";

describe("guideCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes a markdown file", async () => {
    await guideCommand.parseAsync([], { from: "user" });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".md"),
      expect.stringContaining("# Sovereign"),
    );
  });

  it("reflects token presence in the generated content", async () => {
    await guideCommand.parseAsync([], { from: "user" });
    const content = mockWriteFileSync.mock.calls[0][1] as string;
    expect(content).toContain("GITHUB_TOKEN");
  });
});
