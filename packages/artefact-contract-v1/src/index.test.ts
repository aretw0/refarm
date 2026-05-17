import { describe, it, expect } from "vitest";
import { canTransition, ARTEFACT_TERMINAL_STATES } from "./types.js";

describe("canTransition", () => {
  it("draft → ready is valid", () => expect(canTransition("draft", "ready")).toBe(true));
  it("draft → archived is valid", () => expect(canTransition("draft", "archived")).toBe(true));
  it("draft → active is invalid", () => expect(canTransition("draft", "active")).toBe(false));
  it("ready → active is valid", () => expect(canTransition("ready", "active")).toBe(true));
  it("ready → draft is valid", () => expect(canTransition("ready", "draft")).toBe(true));
  it("ready → archived is valid", () => expect(canTransition("ready", "archived")).toBe(true));
  it("active → ready is valid", () => expect(canTransition("active", "ready")).toBe(true));
  it("active → archived is valid", () => expect(canTransition("active", "archived")).toBe(true));
  it("active → draft is invalid", () => expect(canTransition("active", "draft")).toBe(false));
  it("archived → anything is invalid", () => {
    expect(canTransition("archived", "draft")).toBe(false);
    expect(canTransition("archived", "ready")).toBe(false);
    expect(canTransition("archived", "active")).toBe(false);
  });
});

describe("ARTEFACT_TERMINAL_STATES", () => {
  it("contains only archived", () => {
    expect(ARTEFACT_TERMINAL_STATES.has("archived")).toBe(true);
    expect(ARTEFACT_TERMINAL_STATES.size).toBe(1);
  });
});
