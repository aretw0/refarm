import { describe, expect, it } from "vitest";

import { runArtifactV1Conformance } from "./conformance.js";
import type { TaskArtifactManifest } from "./types.js";

function goodManifest(): TaskArtifactManifest {
	return {
		schema: "sovereign.task-artifacts.v1",
		createdAt: "2026-07-13T00:00:00Z",
		artifacts: [
			{
				id: "grafo",
				uri: "lab/datasets/grafo.json",
				mediaType: "application/json",
				role: "dataset",
				hash: { algorithm: "sha256", value: "4189be7e8d50bb32ca8d490f98d9dcbe9d440cb68a50a483ee33d7d782ef20c0" },
				provenance: { runId: "r1", producer: "test", producedAt: "2026-07-13T00:00:00Z" },
			},
			{
				id: "analise",
				uri: "lab/analise.html",
				mediaType: "text/html",
				role: "report",
				provenance: { runId: "r2", producer: "test", producedAt: "2026-07-13T00:00:00Z" },
			},
		],
	};
}

describe("runArtifactV1Conformance", () => {
	it("passes a well-formed produced manifest", () => {
		const result = runArtifactV1Conformance(goodManifest);
		expect(result.pass).toBe(true);
		expect(result.failures).toEqual([]);
	});

	it("passes an empty manifest (no artifacts is valid)", () => {
		const result = runArtifactV1Conformance(() => ({
			schema: "sovereign.task-artifacts.v1",
			createdAt: "2026-07-13T00:00:00Z",
			artifacts: [],
		}));
		expect(result.pass).toBe(true);
	});

	it("catches a wrong schema (the drift a producer could introduce)", () => {
		const result = runArtifactV1Conformance(() => ({ ...goodManifest(), schema: "wrong.schema" as never }));
		expect(result.pass).toBe(false);
		expect(result.failures.some((f) => f.includes("schema"))).toBe(true);
	});

	it("catches a duplicate id", () => {
		const result = runArtifactV1Conformance(() => {
			const m = goodManifest();
			m.artifacts = [m.artifacts[0]!, { ...m.artifacts[1]!, id: "grafo" }];
			return m;
		});
		expect(result.pass).toBe(false);
		expect(result.failures.some((f) => f.includes("duplicate"))).toBe(true);
	});

	it("catches missing provenance producedAt", () => {
		const result = runArtifactV1Conformance(() => {
			const m = goodManifest();
			m.artifacts = [{ ...m.artifacts[0]!, provenance: { runId: "r", producer: "p" } as never }];
			return m;
		});
		expect(result.pass).toBe(false);
		expect(result.failures.some((f) => f.includes("producedAt"))).toBe(true);
	});

	it("does not throw when the producer throws — reports it as a failure", () => {
		const result = runArtifactV1Conformance(() => {
			throw new Error("boom");
		});
		expect(result.pass).toBe(false);
		expect(result.failures[0]).toContain("producer threw");
	});
});
