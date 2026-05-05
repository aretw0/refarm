import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSow, mockInquirerPrompt } = vi.hoisted(() => ({
  mockSow: vi.fn().mockResolvedValue({
    storagePath: "/home/user/.refarm/identity.json",
    github: { ok: true, count: 3 },
    cloudflare: { ok: true },
  }),
  mockInquirerPrompt: vi.fn().mockResolvedValue({
    owner: "refarm-dev",
    githubToken: "ghp_test",
    cloudflareToken: "cf_test",
  }),
}));

vi.mock("inquirer", () => ({ default: { prompt: mockInquirerPrompt } }));

vi.mock("@refarm.dev/sower", () => ({
  SowerCore: vi.fn().mockImplementation(function () {
    return { sow: mockSow };
  }),
}));

vi.mock("@refarm.dev/silo", () => ({
  SiloCore: vi.fn().mockImplementation(function () { return {}; }),
}));

vi.mock("@refarm.dev/windmill", () => ({
  Windmill: vi.fn().mockImplementation(function () { return {}; }),
}));

import { sowCommand } from "../../src/commands/sow.js";

describe("sowCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInquirerPrompt.mockResolvedValue({
      owner: "refarm-dev",
      githubToken: "ghp_test",
      cloudflareToken: "cf_test",
    });
    mockSow.mockResolvedValue({
      storagePath: "/home/user/.refarm/identity.json",
      github: { ok: true, count: 3 },
      cloudflare: { ok: true },
    });
  });

  it("calls sower.sow with tokens from prompt", async () => {
    await sowCommand.parseAsync([], { from: "user" });
    expect(mockSow).toHaveBeenCalledWith(
      expect.objectContaining({ githubToken: "ghp_test", cloudflareToken: "cf_test" }),
      expect.objectContaining({ owner: "refarm-dev" }),
    );
  });

  it("prompts for github token, cloudflare token, and owner", async () => {
    await sowCommand.parseAsync([], { from: "user" });
    expect(mockInquirerPrompt).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "githubToken" }),
        expect.objectContaining({ name: "cloudflareToken" }),
        expect.objectContaining({ name: "owner" }),
      ]),
    );
  });
});
