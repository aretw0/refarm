import { describe, expect, it } from "vitest";
import type { TaskArtefactManifest } from "./types.js";
import {
	ARTEFACT_CAPABILITY,
	ARTEFACT_TERMINAL_STATES,
	canTransition,
	isTaskArtefactManifest,
	validateTaskArtefactManifest,
} from "./types.js";

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
  function sampleManifest(): TaskArtefactManifest {
    return {
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
  }

  it("represents task outputs with provenance and review state", () => {
    const manifest = sampleManifest();

    expect(manifest.schema).toBe("refarm.task-artefacts.v1");
    expect(manifest.artefacts[0]?.provenance.runId).toBe("wallet-poc-001");
    expect(manifest.artefacts[0]?.role).toBe("audit-trail");
  });

  it("validates a complete task artefact manifest at runtime", () => {
    const manifest = sampleManifest();

    expect(validateTaskArtefactManifest(manifest)).toEqual({ ok: true, issues: [] });
    expect(isTaskArtefactManifest(manifest)).toBe(true);
  });

  it("reports path-aware issues for malformed manifests", () => {
    const result = validateTaskArtefactManifest({
      schema: "wrong",
      createdAt: "",
      artefacts: [
        {
          id: "",
          uri: "audit-trail.md",
          mediaType: "text/markdown",
          role: "unknown",
          hash: { algorithm: "sha1", value: "abc" },
          reviewState: "maybe",
          provenance: { runId: "", producer: "wallet:poc", producedAt: "" },
          labels: ["ok", ""],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual([
      "$.schema",
      "$.createdAt",
      "$.artefacts.0.id",
      "$.artefacts.0.role",
      "$.artefacts.0.hash.algorithm",
      "$.artefacts.0.hash.value",
      "$.artefacts.0.reviewState",
      "$.artefacts.0.provenance.runId",
      "$.artefacts.0.provenance.producedAt",
      "$.artefacts.0.labels.1",
    ]);
  });
});
