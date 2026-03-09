import { describe, expect, it, vi } from "vitest";
import { CommandHost } from "../src/lib/command-host";

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
    expect(commands[0].id).toBe("cmd:1");
    expect(commands[1].category).toBe("Test");
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
});
