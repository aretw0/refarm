import {
	TASK_ARTIFACT_MANIFEST_SCHEMA,
	validateTaskArtifactManifest,
	type TaskArtifactManifest,
} from "@refarm.dev/artifact-contract-v1";
import { describe, expect, it } from "vitest";

import { createLaunchProcessSpecFromRunner } from "./launch-process.js";

describe("launch-process artifact provenance bridge", () => {
	it("maps runner process specs into artifact provenance without shell-splitting", () => {
		const process = createLaunchProcessSpecFromRunner(
			"node",
			["scripts/prepare_lab_datasets.mjs", "--json"],
			{
				cwd: "/workspaces/vault-seed",
				display: "node scripts/prepare_lab_datasets.mjs --json",
			},
		);
		const manifest: TaskArtifactManifest = {
			schema: TASK_ARTIFACT_MANIFEST_SCHEMA,
			taskId: "dgk-lab-datasets",
			createdAt: "2026-06-26T21:00:00.000Z",
			artifacts: [
				{
					id: "lab-dataset-manifest",
					uri: ".dgk/lab/datasets.json",
					mediaType: "application/json",
					role: "manifest",
					reviewState: "accepted",
					provenance: {
						runId: "dgk-lab-datasets-2026-06-26",
						producer: "dgk-runner",
						command: process.display,
						process,
						source: "vault-seed",
						producedAt: "2026-06-26T21:00:01.000Z",
					},
				},
			],
		};

		expect(validateTaskArtifactManifest(manifest)).toEqual({
			ok: true,
			issues: [],
		});
		expect(manifest.artifacts[0]?.provenance.process?.args).toEqual([
			"scripts/prepare_lab_datasets.mjs",
			"--json",
		]);
	});
});
