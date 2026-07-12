import { describe, expect, it, vi } from "vitest";
import { CommandDeniedError, CommandHost } from "../src/lib/command-host";

describe("CommandHost Registry & Governance", () => {
  it("should register and execute a command", async () => {
    const emit = vi.fn();
    const host = new CommandHost(emit);
    const handler = vi.fn().mockResolvedValue("success");

    host.register({
      id: "test:cmd",
      title: "Test Command",
      handler
    });

    const result = await host.execute("test:cmd", { foo: "bar" });

    expect(result).toBe("success");
    expect(handler).toHaveBeenCalledWith({ foo: "bar" });
    expect(emit).toHaveBeenCalledWith("system:command_executed", expect.objectContaining({
      id: "test:cmd",
      success: true
    }));
  });

  it("should list all registered commands metadata", () => {
    const host = new CommandHost(vi.fn());
    host.register({ id: "cmd:1", title: "Cmd 1", handler: () => {} });
    host.register({ id: "cmd:2", title: "Cmd 2", category: "Test", handler: () => {} });

    const commands = host.getCommands();
    expect(commands).toHaveLength(2);
    expect(commands[0]!.id).toBe("cmd:1");
    expect(commands[1]!.category).toBe("Test");
  });

  it("should throw error for non-existent commands", async () => {
    const host = new CommandHost(vi.fn());
    await expect(host.execute("ghost")).rejects.toThrow("[commands] Command not found: ghost");
  });

  it("should log telemetry on failure", async () => {
    const emit = vi.fn();
    const host = new CommandHost(emit);
    const handler = vi.fn().mockRejectedValue(new Error("Boom"));

    host.register({ id: "fail:cmd", title: "Fail", handler });

    await expect(host.execute("fail:cmd")).rejects.toThrow("Boom");
    expect(emit).toHaveBeenCalledWith("system:command_failed", expect.objectContaining({
      id: "fail:cmd",
      success: false,
      error: "Boom"
    }));
  });

  // ── §3 Governance ──────────────────────────────────────────────────────────
  describe("governance (§3)", () => {
    it("runs a capability-gated command when the gate allows", async () => {
      const gate = vi.fn().mockReturnValue(true);
      const host = new CommandHost(vi.fn(), gate);
      const handler = vi.fn().mockResolvedValue("ok");
      host.register({ id: "sec:trust", title: "Trust", capability: "security:trust", handler });

      await expect(host.execute("sec:trust")).resolves.toBe("ok");
      expect(gate).toHaveBeenCalledWith("security:trust");
      expect(handler).toHaveBeenCalled();
    });

    it("DENIES a capability-gated command when the gate refuses, before the handler runs", async () => {
      const emit = vi.fn();
      const host = new CommandHost(emit, () => false);
      const handler = vi.fn();
      host.register({ id: "sec:trust", title: "Trust", capability: "security:trust", handler });

      await expect(host.execute("sec:trust")).rejects.toBeInstanceOf(CommandDeniedError);
      expect(handler).not.toHaveBeenCalled(); // gated BEFORE execution
      expect(emit).toHaveBeenCalledWith("system:command_denied", {
        id: "sec:trust",
        capability: "security:trust",
      });
    });

    it("allows a command with NO capability regardless of the gate", async () => {
      const host = new CommandHost(vi.fn(), () => false);
      host.register({ id: "open:cmd", title: "Open", handler: () => "done" });
      await expect(host.execute("open:cmd")).resolves.toBe("done");
    });

    it("is permissive when no gate is configured (back-compat)", async () => {
      const host = new CommandHost(vi.fn()); // no gate
      host.register({ id: "sec:x", title: "X", capability: "security:trust", handler: () => "ran" });
      await expect(host.execute("sec:x")).resolves.toBe("ran");
    });

    it("canExecute reflects the gate without running the command", () => {
      const handler = vi.fn();
      const allow = new CommandHost(vi.fn(), (c) => c === "ok");
      allow.register({ id: "a", title: "A", capability: "ok", handler });
      allow.register({ id: "b", title: "B", capability: "nope", handler });
      allow.register({ id: "c", title: "C", handler }); // no capability
      expect(allow.canExecute("a")).toBe(true);
      expect(allow.canExecute("b")).toBe(false);
      expect(allow.canExecute("c")).toBe(true);
      expect(allow.canExecute("ghost")).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── §2 Extensibility / Overrides ───────────────────────────────────────────
  describe("decoration (§2)", () => {
    it("wraps an existing handler, composing behavior", async () => {
      const host = new CommandHost(vi.fn());
      host.register({ id: "editor:save", title: "Save", handler: () => "saved" });
      host.decorate("editor:save", (inner) => async (args) => `vim(${await inner(args)})`);

      await expect(host.execute("editor:save")).resolves.toBe("vim(saved)");
    });

    it("stacks decorations innermost-first (original innermost)", async () => {
      const host = new CommandHost(vi.fn());
      host.register({ id: "x", title: "X", handler: () => "core" });
      host.decorate("x", (inner) => async () => `a(${await inner()})`);
      host.decorate("x", (inner) => async () => `b(${await inner()})`);
      // b wraps a wraps core
      await expect(host.execute("x")).resolves.toBe("b(a(core))");
    });

    it("preserves capability metadata through decoration", async () => {
      const host = new CommandHost(vi.fn(), () => false);
      host.register({ id: "x", title: "X", capability: "cap", handler: () => "core" });
      host.decorate("x", (inner) => inner);
      // still gated after decoration
      await expect(host.execute("x")).rejects.toBeInstanceOf(CommandDeniedError);
    });

    it("throws when decorating an unknown command", () => {
      const host = new CommandHost(vi.fn());
      expect(() => host.decorate("ghost", (h) => h)).toThrow(/Cannot decorate unknown/);
    });
  });

  // ── §4 Accessibility ───────────────────────────────────────────────────────
  describe("accessibility (§4)", () => {
    it("derives an ariaLabel from category + title + description", () => {
      const host = new CommandHost(vi.fn());
      host.register({
        id: "sec:trust",
        title: "Trust Plugin",
        category: "Security",
        description: "Grant fast execution.",
        handler: () => {},
      });
      const [cmd] = host.getCommands();
      expect(cmd!.ariaLabel).toBe("Security: Trust Plugin. Grant fast execution.");
    });

    it("getCommands carries the runnable flag from the gate", () => {
      const host = new CommandHost(vi.fn(), (c) => c === "yes");
      host.register({ id: "a", title: "A", capability: "yes", handler: () => {} });
      host.register({ id: "b", title: "B", capability: "no", handler: () => {} });
      const cmds = host.getCommands();
      expect(cmds.find((c) => c.id === "a")!.runnable).toBe(true);
      expect(cmds.find((c) => c.id === "b")!.runnable).toBe(false);
    });
  });
});
