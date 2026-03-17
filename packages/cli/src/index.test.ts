import { describe, it, expect } from "vitest";
import { program } from "./program.js";

describe("refarm CLI — command routing", () => {
  it("registers all expected commands", () => {
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("init");
    expect(names).toContain("sow");
    expect(names).toContain("guide");
    expect(names).toContain("health");
    expect(names).toContain("migrate");
    expect(names).toContain("deploy");
    expect(names).toContain("plugin");
  });

  it("init command has correct description", () => {
    const init = program.commands.find((c) => c.name() === "init");
    expect(init?.description()).toMatch(/scaffold/i);
  });

  it("sow command has a description", () => {
    const sow = program.commands.find((c) => c.name() === "sow");
    expect(sow?.description()).toBeTruthy();
  });

  it("program name and description are set", () => {
    expect(program.name()).toBe("refarm");
    expect(program.description()).toBe("The Sovereign Farm CLI");
  });
});
