import {
	TASK_ARTIFACT_MANIFEST_SCHEMA,
	validateTaskArtifactManifest,
	type TaskArtifactManifest,
} from "@refarm.dev/artifact-contract-v1";
import { describe, expect, it } from "vitest";

import {
	createProcessHandoffRunner,
	createProcessHandoffSpec,
	createProcessHandoffSpecFromRunner,
	splitProcessHandoffCommand,
	startDetachedProcessHandoff,
} from "./index.js";

describe("process-handoff leaf package", () => {
	it("splits a process handoff command into command + args", () => {
		expect(splitProcessHandoffCommand("runner -C apps/dev run dev")).toEqual({
			command: "runner",
			args: ["-C", "apps/dev", "run", "dev"],
		});
	});

	it("preserves quoted process handoff arguments", () => {
		expect(splitProcessHandoffCommand("runner --label 'Refarm Dev'")).toEqual({
			command: "runner",
			args: ["--label", "Refarm Dev"],
		});
	});

	it("builds full process handoff spec from command display", () => {
		expect(createProcessHandoffSpec("runner -C apps/dev run dev")).toEqual({
			command: "runner",
			args: ["-C", "apps/dev", "run", "dev"],
			display: "runner -C apps/dev run dev",
		});
	});

	it("builds process specs from runner-style command arguments", () => {
		expect(
			createProcessHandoffSpecFromRunner(
				"node",
				["scripts/run task.mjs", "--json"],
				{
					cwd: "/workspaces/consumer vault",
					packageManager: "pnpm",
				},
			),
		).toEqual({
			command: "node",
			args: ["scripts/run task.mjs", "--json"],
			cwd: "/workspaces/consumer vault",
			packageManager: "pnpm",
			display: "node 'scripts/run task.mjs' '--json'",
		});
	});

	it("creates a runner adapter that rejects failed process execution", async () => {
		const runner = createProcessHandoffRunner(async () => ({ exitCode: 2 }));

		await expect(
			runner("node", ["scripts/etl.mjs"], {
				display: "node scripts/etl.mjs",
			}),
		).rejects.toThrow("'node scripts/etl.mjs' exited with code 2");
	});

	it("maps runner process specs into artifact provenance without shell-splitting", () => {
		const process = createProcessHandoffSpecFromRunner(
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

	it("reports detached spawn errors without raising an uncaught exception", async () => {
		const missingCommand = `refarm-missing-process-handoff-${process.pid}-${Date.now()}`;

		await expect(
			new Promise<NodeJS.ErrnoException>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("Timed out waiting for detached spawn error."));
				}, 1_000);

				startDetachedProcessHandoff(
					{
						command: missingCommand,
						args: [],
						display: missingCommand,
					},
					{
						onError: (error) => {
							clearTimeout(timeout);
							resolve(error);
						},
					},
				);
			}),
		).resolves.toMatchObject({ code: "ENOENT" });
	});
});
