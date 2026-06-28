import {
	TASK_ARTIFACT_MANIFEST_SCHEMA,
	validateTaskArtifactManifest,
	type TaskArtifactManifest,
} from "@refarm.dev/artifact-contract-v1";
import { describe, expect, it } from "vitest";

import {
	createLaunchProcessRunner,
	createLaunchProcessSpec,
	createLaunchProcessSpecFromRunner,
	launchDetachedProcess,
	splitLaunchCommand,
} from "./index.js";

describe("launch-process leaf package", () => {
	it("splits launcher command into command + args", () => {
		expect(splitLaunchCommand("runner -C apps/dev run dev")).toEqual({
			command: "runner",
			args: ["-C", "apps/dev", "run", "dev"],
		});
	});

	it("preserves quoted launcher arguments", () => {
		expect(splitLaunchCommand("runner --label 'Refarm Dev'")).toEqual({
			command: "runner",
			args: ["--label", "Refarm Dev"],
		});
	});

	it("builds full launch process spec from command display", () => {
		expect(createLaunchProcessSpec("runner -C apps/dev run dev")).toEqual({
			command: "runner",
			args: ["-C", "apps/dev", "run", "dev"],
			display: "runner -C apps/dev run dev",
		});
	});

	it("builds process specs from runner-style command arguments", () => {
		expect(
			createLaunchProcessSpecFromRunner(
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
		const runner = createLaunchProcessRunner(async () => ({ exitCode: 2 }));

		await expect(
			runner("node", ["scripts/etl.mjs"], {
				display: "node scripts/etl.mjs",
			}),
		).rejects.toThrow("'node scripts/etl.mjs' exited with code 2");
	});

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

	it("reports detached spawn errors without raising an uncaught exception", async () => {
		const missingCommand = `refarm-missing-launch-process-${process.pid}-${Date.now()}`;

		await expect(
			new Promise<NodeJS.ErrnoException>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("Timed out waiting for detached spawn error."));
				}, 1_000);

				launchDetachedProcess(
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
