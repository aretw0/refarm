import { describe, it, expect, vi } from "vitest";
import {
  buildCommitCommand,
  processCommits,
  resolveCommitMessage,
  parseCommitAutoOptions,
  isGenericCommitMessage,
} from "../src/git-commit-auto.mjs";

// In v7.0, groups no longer have a static `msg` field.
// The message is derived dynamically by deriveCommitMessage(group.id, group.items).
// We use a known group id ("pkg_updates") with a simple item so the derived message is predictable.

const makeGroup = (id, path, signals = []) => ({
  id,
  title: "Test Group",
  items: [{ status: "M", path, signals: new Set(signals) }]
});

describe("Git Commit Automator Logic (Pure Function)", () => {
  it("should quote paths and commit message safely when building commands", () => {
    const command = buildCommitCommand(["docs/space name.md", "packages/toolbox/src/cli.mjs"], 'docs: update "resolution" notes');
    expect(command).toContain('git add "docs/space name.md" "packages/toolbox/src/cli.mjs"');
    expect(command).toContain('git commit -m "docs: update \\\"resolution\\\" notes"');
  });

  it("should execute command when user answers 'y'", async () => {
    const mockGroups = [makeGroup("pkg_updates", "file.txt")];

    const execFn = vi.fn();
    const mockRl = {
      question: vi.fn().mockImplementation((_q, cb) => cb("y"))
    };

    await processCommits(mockGroups, {
      execFn,
      readlineInterface: mockRl
    });

    expect(execFn).toHaveBeenCalledOnce();
    const cmd = execFn.mock.calls[0][0];
    expect(cmd).toContain('git add "file.txt"');
    expect(cmd).toContain("git commit -m");
    expect(cmd).not.toContain('"undefined"');
  });

  it("should skip command when user answers 'n'", async () => {
    const mockGroups = [makeGroup("pkg_updates", "file.txt")];

    const execFn = vi.fn();
    const mockRl = {
      question: vi.fn().mockImplementation((_q, cb) => cb("n"))
    };

    await processCommits(mockGroups, {
      execFn,
      readlineInterface: mockRl
    });

    expect(execFn).not.toHaveBeenCalled();
  });

  it("should allow editing message when user answers 'e'", async () => {
    const mockGroups = [makeGroup("pkg_updates", "file.txt")];

    const execFn = vi.fn();
    const mockRl = {
      question: vi.fn()
        .mockImplementationOnce((_q, cb) => cb("e"))
        .mockImplementationOnce((_q, cb) => cb("feat: custom message"))
    };

    await processCommits(mockGroups, {
      execFn,
      readlineInterface: mockRl
    });

    expect(execFn).toHaveBeenCalledWith('git add "file.txt" && git commit -m "feat: custom message"');
  });

  it("should stop processing when user answers 'q'", async () => {
    const mockGroups = [
      makeGroup("pkg_updates", "f1.txt"),
      makeGroup("pkg_updates", "f2.txt")
    ];

    const execFn = vi.fn();
    const mockRl = {
      question: vi.fn().mockImplementation((_q, cb) => cb("q"))
    };

    await processCommits(mockGroups, {
      execFn,
      readlineInterface: mockRl
    });

    expect(execFn).not.toHaveBeenCalled();
    expect(mockRl.question).toHaveBeenCalledTimes(1);
  });

  it("should generate a semantic message for typecheck_fix group", async () => {
    const mockGroups = [{
      id: "typecheck_fix",
      title: "🔧 Fix: TypeScript Module Resolution",
      items: [{
        status: "M",
        path: "apps/me/tsconfig.json",
        signals: new Set(["homestead-subpath", "tsconfig-paths", "tsconfig-file", "app"])
      }]
    }];

    const execFn = vi.fn();
    const mockRl = {
      question: vi.fn().mockImplementation((_q, cb) => cb("y"))
    };

    await processCommits(mockGroups, {
      execFn,
      readlineInterface: mockRl
    });

    const cmd = execFn.mock.calls[0][0];
    expect(cmd).toContain("fix(types):");
    expect(cmd).toContain("homestead");
  });

  it("should require explicit message confirmation for important groups", async () => {
    const importantGroup = {
      id: "security",
      title: "Security",
      items: [{ status: "M", path: "package.json", signals: new Set(["security"]) }]
    };

    const mockRl = {
      question: vi.fn().mockImplementation((_q, cb) => cb("fix(security): tighten audit overrides"))
    };

    const msg = await resolveCommitMessage(importantGroup, "fix(security): baseline", {
      readlineInterface: mockRl,
      autoYes: false,
    });

    expect(msg).toBe("fix(security): tighten audit overrides");
    expect(mockRl.question).toHaveBeenCalledTimes(1);
  });

  it("should stop execution when important-group message prompt returns q", async () => {
    const importantGroup = {
      id: "security",
      title: "Security",
      items: [{ status: "M", path: "package.json", signals: new Set(["security"]) }]
    };

    const execFn = vi.fn();
    const mockRl = {
      question: vi.fn()
        .mockImplementationOnce((_q, cb) => cb("q"))
    };

    await processCommits([importantGroup], {
      execFn,
      readlineInterface: mockRl
    });

    expect(execFn).not.toHaveBeenCalled();
  });

  it("should parse strict mode from env or argv", () => {
    const fromEnv = parseCommitAutoOptions(["node", "script"], {
      GIT_COMMIT_AUTO_STRICT: "1",
    });
    expect(fromEnv.strictImportant).toBe(true);

    const fromArgv = parseCommitAutoOptions(
      ["node", "script", "--strict-important"],
      {},
    );
    expect(fromArgv.strictImportant).toBe(true);

    const disabled = parseCommitAutoOptions(["node", "script"], {});
    expect(disabled.strictImportant).toBe(false);
  });

  it("should reject generic messages in strict mode", async () => {
    const importantGroup = {
      id: "security",
      title: "Security",
      items: [{ status: "M", path: "package.json", signals: new Set(["security"]) }]
    };

    const mockRl = {
      question: vi.fn()
        .mockImplementationOnce((_q, cb) => cb("chore(security): update things"))
        .mockImplementationOnce((_q, cb) => cb("fix(security): harden uuid override policy"))
    };

    const msg = await resolveCommitMessage(importantGroup, "fix(security): baseline", {
      readlineInterface: mockRl,
      strictImportant: true,
    });

    expect(msg).toBe("fix(security): harden uuid override policy");
    expect(mockRl.question).toHaveBeenCalledTimes(2);
  });

  it("detects generic commit messages", () => {
    expect(isGenericCommitMessage("chore(toolbox): update implementation")).toBe(true);
    expect(isGenericCommitMessage("feat(toolbox): add strict important commit guard")).toBe(false);
  });
});
