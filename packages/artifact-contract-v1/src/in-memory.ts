import {
	findTaskArtifactById,
	selectTaskArtifacts,
	TASK_ARTIFACT_MANIFEST_SCHEMA,
	type TaskArtifactManifest,
	type TaskArtifactReference,
	type TaskArtifactSelection,
} from "./types.js";
import type { ArtifactManifestProducer } from "./conformance.js";

/**
 * The reference PRODUCER + registry for artifact:v1 — the minimal worked example that proves the
 * contract is satisfiable. `runArtifactV1Conformance` takes a producer (a notebook exporter, an
 * effort's artifact emitter, lab-contract's buildLabManifest) and asserts its manifest is trusted
 * by every consumer. This file is the canonical valid manifest a real producer can read to see the
 * intended shape, and the in-memory registry is the consumer side — a store keyed by id that leans
 * ONLY on the contract's `findTaskArtifactById` / `selectTaskArtifacts` helpers, no bespoke lookup.
 *
 * It is not a swappable adapter behind a grand interface: a durable producer (a WASM effort, a site
 * gallery) emits the same manifest, just from real inputs instead of these literals.
 */

/** Overrides for the canonical reference manifest — everything defaults to a valid, non-empty value. */
export interface InMemoryArtifactManifestOverrides {
	createdAt?: string;
	taskId?: string;
	effortId?: string;
	artifacts?: readonly TaskArtifactReference[];
}

const REFERENCE_ARTIFACTS: readonly TaskArtifactReference[] = [
	{
		id: "dataset-grafo",
		uri: "lab/datasets/grafo.json",
		mediaType: "application/json",
		role: "dataset",
		hash: {
			algorithm: "sha256",
			value: "4189be7e8d50bb32ca8d490f98d9dcbe9d440cb68a50a483ee33d7d782ef20c0",
		},
		reviewState: "accepted",
		labels: ["lab", "input"],
		provenance: {
			runId: "run-reference-1",
			producer: "artifact-contract-v1/in-memory",
			producedAt: "2026-07-13T00:00:00Z",
			source: "lab",
		},
	},
	{
		id: "report-analise",
		uri: "lab/analise.html",
		mediaType: "text/html",
		role: "report",
		reviewState: "unreviewed",
		labels: ["lab", "output"],
		provenance: {
			runId: "run-reference-1",
			producer: "artifact-contract-v1/in-memory",
			producedAt: "2026-07-13T00:00:05Z",
			source: "lab",
		},
	},
];

/**
 * A canonical, valid artifact:v1 manifest. Passing this (or the producer that returns it) through
 * `runArtifactV1Conformance` yields a green report — it is the concrete answer to "what does a
 * trustworthy manifest look like?".
 */
export function referenceArtifactManifest(
	overrides: InMemoryArtifactManifestOverrides = {},
): TaskArtifactManifest {
	return {
		schema: TASK_ARTIFACT_MANIFEST_SCHEMA,
		createdAt: overrides.createdAt ?? "2026-07-13T00:00:00Z",
		...(overrides.taskId !== undefined ? { taskId: overrides.taskId } : {}),
		...(overrides.effortId !== undefined ? { effortId: overrides.effortId } : {}),
		artifacts: overrides.artifacts ?? REFERENCE_ARTIFACTS,
	};
}

/**
 * The reference `ArtifactManifestProducer`. `createInMemoryArtifactManifestProducer()()` returns the
 * canonical manifest above; the conformance suite runs it directly.
 */
export function createInMemoryArtifactManifestProducer(
	overrides: InMemoryArtifactManifestOverrides = {},
): ArtifactManifestProducer {
	return () => referenceArtifactManifest(overrides);
}

/** The consumer side: a read model over a produced manifest, keyed by artifact id. */
export interface InMemoryArtifactRegistry {
	/** The underlying manifest this registry reads. */
	manifest(): TaskArtifactManifest;
	/** Look up one artifact by id, or `undefined` when absent. */
	get(id: string): TaskArtifactReference | undefined;
	/** Select artifacts by role/review-state/label/etc. (empty selection returns all). */
	select(selection?: TaskArtifactSelection): readonly TaskArtifactReference[];
	/** The ids currently held, in manifest order. */
	ids(): string[];
}

/**
 * Build an in-memory registry over a manifest. It delegates every lookup to the contract's own
 * `findTaskArtifactById` / `selectTaskArtifacts`, so a consumer reading this file sees exactly which
 * helpers to reuse rather than re-implementing selection.
 */
export function createInMemoryArtifactRegistry(
	manifest: TaskArtifactManifest = referenceArtifactManifest(),
): InMemoryArtifactRegistry {
	return {
		manifest() {
			return manifest;
		},
		get(id) {
			return findTaskArtifactById(manifest, id);
		},
		select(selection = {}) {
			return selectTaskArtifacts(manifest, selection);
		},
		ids() {
			return manifest.artifacts.map((artifact) => artifact.id);
		},
	};
}
