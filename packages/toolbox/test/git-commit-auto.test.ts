import { describe, it, expect, vi } from "vitest";
import { processCommits } from "../src/git-commit-auto.mjs";

describe("Git Commit Automator Logic (Pure Function)", () => {
  it("should execute command when user answers 'y'", async () => {
    const mockGroups = [
      {
        title: "Test Group",
        msg: "feat: test",
        items: [{ status: "M", path: "file.txt" }]
      }
    ];
    
    const execFn = vi.fn();
    const mockRl = {
      question: vi.fn().mockImplementation((_q, cb) => cb("y"))
    };

    await processCommits(mockGroups, { 
      execFn, 
      readlineInterface: mockRl as any 
    });

    expect(execFn).toHaveBeenCalledWith('git add file.txt && git commit -m "feat: test"');
  });

  it("should skip command when user answers 'n'", async () => {
    const mockGroups = [
      {
        title: "Test Group",
        msg: "feat: test",
        items: [{ status: "M", path: "file.txt" }]
      }
    ];
    
    const execFn = vi.fn();
    const mockRl = {
      question: vi.fn().mockImplementation((_q, cb) => cb("n"))
    };

    await processCommits(mockGroups, { 
      execFn, 
      readlineInterface: mockRl as any 
    });

    expect(execFn).not.toHaveBeenCalled();
  });

  it("should allow editing message when user answers 'e'", async () => {
    const mockGroups = [
      {
        title: "Test Group",
        msg: "feat: test",
        items: [{ status: "M", path: "file.txt" }]
      }
    ];
    
    const execFn = vi.fn();
    const mockRl = {
      question: vi.fn()
        .mockImplementationOnce((_q, cb) => cb("e"))
        .mockImplementationOnce((_q, cb) => cb("feat: custom message"))
    };

    await processCommits(mockGroups, { 
      execFn, 
      readlineInterface: mockRl as any 
    });

    expect(execFn).toHaveBeenCalledWith('git add file.txt && git commit -m "feat: custom message"');
  });

  it("should stop processing when user answers 'q'", async () => {
    const mockGroups = [
      { title: "G1", msg: "m1", items: [{ status: "M", path: "f1.txt" }] },
      { title: "G2", msg: "m2", items: [{ status: "M", path: "f2.txt" }] }
    ];
    
    const execFn = vi.fn();
    const mockRl = {
      question: vi.fn().mockImplementation((_q, cb) => cb("q"))
    };

    await processCommits(mockGroups, { 
      execFn, 
      readlineInterface: mockRl as any 
    });

    expect(execFn).not.toHaveBeenCalled();
    expect(mockRl.question).toHaveBeenCalledTimes(1);
  });
});
