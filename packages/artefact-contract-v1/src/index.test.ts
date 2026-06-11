import { describe, expect, it } from "vitest";
import type { TaskArtefactManifest } from "./types.js";
import { ARTEFACT_CAPABILITY, ARTEFACT_TERMINAL_STATES, canTransition } from "./types.js";

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

describe("ARTEFACT_CAPABILITY", () => {
  it("is artefact:v1", () => expect(ARTEFACT_CAPABILITY).toBe("artefact:v1"));
});

describe("TaskArtefactManifest", () => {
  it("represents task outputs with provenance and review state", () => {
    const manifest: TaskArtefactManifest = {
      schema: "refarm.task-artefacts.v1",
      taskId: "task-wallet-poc",
      effortId: "effort-wallet-poc-001",
      createdAt: "2026-06-11T00:00:00.000Z",
      artefacts: [
        {
          id: "wallet-audit-trail",
          uri: "fixtures/expected/audit-trail.md",
          mediaType: "text/markdown",
          role: "audit-trail",
          reviewState: "accepted",
          hash: {
            algorithm: "sha256",
            value: "0".repeat(64),
          },
          provenance: {
            runId: "wallet-poc-001",
            producer: "wallet:poc",
            command: "pnpm run wallet:poc",
            source: "validations/citizen-data-wallet-poc",
            sourceVersion: "synthetic-v1",
            producedAt: "2026-06-11T00:00:00.000Z",
          },
        },
      ],
    };

    expect(manifest.schema).toBe("refarm.task-artefacts.v1");
    expect(manifest.artefacts[0]?.provenance.runId).toBe("wallet-poc-001");
    expect(manifest.artefacts[0]?.role).toBe("audit-trail");
  });
});
