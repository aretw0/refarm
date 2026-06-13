import { describe, expect, it } from "vitest";
import type { TaskArtifactManifest } from "./types.js";
import {
	ARTIFACT_CAPABILITY,
	ARTIFACT_TERMINAL_STATES,
	canTransition,
	findTaskArtifactById,
	isTaskArtifactManifest,
	selectTaskArtifacts,
	validateTaskArtifactManifest,
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

describe("ARTIFACT_TERMINAL_STATES", () => {
  it("contains only archived", () => {
    expect(ARTIFACT_TERMINAL_STATES.has("archived")).toBe(true);
    expect(ARTIFACT_TERMINAL_STATES.size).toBe(1);
  });
});

describe("ARTIFACT_CAPABILITY", () => {
  it("is artifact:v1", () => expect(ARTIFACT_CAPABILITY).toBe("artifact:v1"));
});

describe("TaskArtifactManifest", () => {
  function sampleManifest(): TaskArtifactManifest {
    return {
      schema: "refarm.task-artifacts.v1",
      taskId: "task-wallet-poc",
      effortId: "effort-wallet-poc-001",
      createdAt: "2026-06-11T00:00:00.000Z",
      artifacts: [
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
            command: "node scripts/wallet-poc.mjs",
            process: {
              command: "node",
              args: ["scripts/wallet-poc.mjs"],
              display: "node scripts/wallet-poc.mjs",
              cwd: "validations/citizen-data-wallet-poc",
            },
            source: "validations/citizen-data-wallet-poc",
            sourceVersion: "synthetic-v1",
            producedAt: "2026-06-11T00:00:00.000Z",
          },
          labels: ["vault", "reviewed"],
        },
        {
          id: "wallet-dataset",
          uri: "fixtures/expected/presentation.json",
          mediaType: "application/json",
          role: "dataset",
          reviewState: "unreviewed",
          hash: {
            algorithm: "sha256",
            value: "1".repeat(64),
          },
          provenance: {
            runId: "wallet-poc-001",
            producer: "wallet:poc",
            command: "node scripts/wallet-poc.mjs",
            process: {
              command: "node",
              args: ["scripts/wallet-poc.mjs"],
              display: "node scripts/wallet-poc.mjs",
              cwd: "validations/citizen-data-wallet-poc",
            },
            source: "validations/citizen-data-wallet-poc",
            sourceVersion: "synthetic-v1",
            producedAt: "2026-06-11T00:00:00.000Z",
          },
          labels: ["lab"],
        },
      ],
    };
  }

  it("represents task outputs with provenance and review state", () => {
    const manifest = sampleManifest();

    expect(manifest.schema).toBe("refarm.task-artifacts.v1");
    expect(manifest.artifacts[0]?.provenance.runId).toBe("wallet-poc-001");
    expect(manifest.artifacts[0]?.provenance.process?.args).toEqual([
      "scripts/wallet-poc.mjs",
    ]);
    expect(
      manifest.artifacts.every(
        (artifact) => artifact.provenance.process?.display === artifact.provenance.command,
      ),
    ).toBe(true);
    expect(manifest.artifacts[0]?.role).toBe("audit-trail");
  });

  it("validates a complete task artifact manifest at runtime", () => {
    const manifest = sampleManifest();

    expect(validateTaskArtifactManifest(manifest)).toEqual({ ok: true, issues: [] });
    expect(isTaskArtifactManifest(manifest)).toBe(true);
  });

  it("selects task artifacts by consumer-facing metadata", () => {
    const manifest = sampleManifest();

    expect(selectTaskArtifacts(manifest, { roles: ["audit-trail"] }).map((item) => item.id)).toEqual([
      "wallet-audit-trail",
    ]);
    expect(selectTaskArtifacts(manifest, { reviewStates: ["unreviewed"] }).map((item) => item.id)).toEqual([
      "wallet-dataset",
    ]);
    expect(selectTaskArtifacts(manifest, { labels: ["vault", "reviewed"] }).map((item) => item.id)).toEqual([
      "wallet-audit-trail",
    ]);
    expect(selectTaskArtifacts(manifest, {
      mediaTypes: ["application/json"],
      producer: "wallet:poc",
      source: "validations/citizen-data-wallet-poc",
    }).map((item) => item.id)).toEqual(["wallet-dataset"]);
  });

  it("finds task artifacts by stable id", () => {
    const manifest = sampleManifest();

    expect(findTaskArtifactById(manifest, "wallet-dataset")?.uri).toBe(
      "fixtures/expected/presentation.json",
    );
    expect(findTaskArtifactById(manifest, "missing")).toBeUndefined();
  });

  it("rejects duplicate task artifact ids", () => {
    const manifest = sampleManifest();
    const result = validateTaskArtifactManifest({
      ...manifest,
      artifacts: [
        ...manifest.artifacts,
        {
          ...manifest.artifacts[1],
          uri: "fixtures/expected/duplicate.json",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      path: "$.artifacts.2.id",
      message: "Expected a unique artifact id.",
    });
  });

  it("rejects contradictory command display and process display", () => {
    const manifest = sampleManifest();
    const result = validateTaskArtifactManifest({
      ...manifest,
      artifacts: [
        {
          ...manifest.artifacts[0],
          provenance: {
            ...manifest.artifacts[0].provenance,
            command: "pnpm run wallet:poc",
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      path: "$.artifacts.0.provenance.command",
      message: "Expected command to match process display.",
    });
  });

  it("reports path-aware issues for malformed manifests", () => {
    const result = validateTaskArtifactManifest({
      schema: "wrong",
      taskId: "",
      effortId: "",
      createdAt: "",
      artifacts: [
        {
          id: "",
          uri: "audit-trail.md",
          mediaType: "text/markdown",
          role: "unknown",
          hash: { algorithm: "sha1", value: "abc" },
          reviewState: "maybe",
          provenance: {
            runId: "",
            producer: "wallet:poc",
            command: "",
            source: "",
            sourceVersion: "",
            process: {
              command: "",
              args: ["ok", ""],
              display: "",
              cwd: "",
              packageManager: "",
            },
            producedAt: "",
          },
          labels: ["ok", ""],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual([
      "$.schema",
      "$.taskId",
      "$.effortId",
      "$.createdAt",
      "$.artifacts.0.id",
      "$.artifacts.0.role",
      "$.artifacts.0.hash.algorithm",
      "$.artifacts.0.hash.value",
      "$.artifacts.0.reviewState",
      "$.artifacts.0.provenance.runId",
      "$.artifacts.0.provenance.producedAt",
      "$.artifacts.0.provenance.command",
      "$.artifacts.0.provenance.source",
      "$.artifacts.0.provenance.sourceVersion",
      "$.artifacts.0.provenance.process.command",
      "$.artifacts.0.provenance.process.args.1",
      "$.artifacts.0.provenance.process.display",
      "$.artifacts.0.provenance.process.cwd",
      "$.artifacts.0.provenance.process.packageManager",
      "$.artifacts.0.labels.1",
    ]);
  });
});
