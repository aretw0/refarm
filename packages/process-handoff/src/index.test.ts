import {
	TASK_ARTIFACT_MANIFEST_SCHEMA,
	validateTaskArtifactManifest,
	type TaskArtifactManifest,
} from "@refarm.dev/artifact-contract-v1";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	createProcessHandoffDisplay,
	createProcessHandoffRunner,
	createProcessHandoffSpec,
	createProcessHandoffSpecFromRunner,
	PROCESS_HANDOFF_OUTPUT_TRUNCATION_MARKER,
	runProcessHandoff,
	runProcessHandoffSync,
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
			createProcessHandoffSpecFromRunner("node", ["scripts/run task.mjs", "--json"], {
				cwd: "/workspaces/consumer vault",
				packageManager: "pnpm",
			}),
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

	it("captures stdout synchronously from a process spec", () => {
		const args = ["-e", "process.stdout.write('sync-out')"];
		const result = runProcessHandoffSync(
			{ command: process.execPath, args, display: createProcessHandoffDisplay("node", args) },
			{ capture: true },
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("sync-out");
	});

	it("honors a timeout, killing a child that outlives it", () => {
		const args = ["-e", "setTimeout(() => {}, 10000)"];
		const result = runProcessHandoffSync(
			{ command: process.execPath, args, display: createProcessHandoffDisplay("node", args) },
			{ capture: true, timeout: 100 },
		);
		// A killed child never exits 0 — status is null (SIGTERM), so exitCode falls through to 1.
		expect(result.exitCode).not.toBe(0);
	});
});

/**
 * The five guarantees P1 of the process-administration design
 * (`docs/superpowers/specs/2026-07-29-process-administration-layer-design.md`) asks this
 * package to grow, moved down from `apps/refarm/src/commands/connection.ts` where they were
 * already implemented and reviewed. Each is additive (opt-in via `options`), so the tests
 * above — which pass none of these options — are the regression guard that nothing here
 * changed a default; these are the guarantee-specific guard that each one actually works.
 */
describe("runProcessHandoff — the five async boundary guarantees (P1)", () => {
	it("bounds the run with a timeout, killing the child and reporting timedOut + exitCode -1", async () => {
		const args = ["-e", "setTimeout(() => {}, 10000)"];
		const start = Date.now();
		const result = await runProcessHandoff(
			{ command: process.execPath, args, display: createProcessHandoffDisplay("node", args) },
			{ capture: true, timeout: 150 },
		);
		expect(Date.now() - start).toBeLessThan(5_000);
		expect(result.timedOut).toBe(true);
		expect(result.exitCode).toBe(-1);
	});

	it("does not populate timedOut when no timeout is configured — additive, not a changed default", async () => {
		const result = await runProcessHandoff({
			command: process.execPath,
			args: ["-e", "process.exit(0)"],
			display: "node -e process.exit(0)",
		});
		expect(result.timedOut).toBeUndefined();
		expect(result).toEqual({ exitCode: 0 });
	});

	it("caps captured output at outputCap bytes per stream, appending the host's truncation marker", async () => {
		const args = ["-e", "process.stdout.write('A'.repeat(50)); process.stderr.write('B'.repeat(50));"];
		const result = await runProcessHandoff(
			{ command: process.execPath, args, display: createProcessHandoffDisplay("node", args) },
			{ capture: true, outputCap: 10 },
		);
		expect(result.stdout).toBe("A".repeat(10) + PROCESS_HANDOFF_OUTPUT_TRUNCATION_MARKER);
		expect(result.stderr).toBe("B".repeat(10) + PROCESS_HANDOFF_OUTPUT_TRUNCATION_MARKER);
	});

	it("leaves captured output unbounded when outputCap is omitted — additive, not a changed default", async () => {
		const big = "C".repeat(5_000);
		const args = [`-e`, `process.stdout.write(${JSON.stringify(big)})`];
		const result = await runProcessHandoff(
			{ command: process.execPath, args, display: createProcessHandoffDisplay("node", args) },
			{ capture: true },
		);
		expect(result.stdout).toBe(big);
		expect(result.stdout).not.toContain("truncated");
	});

	it("isolates the child's environment even when `env` itself is omitted — {} not process.env", async () => {
		// Passing an explicit `env: {}` already isolates on its own (Node's spawn never
		// merges a given `env` with process.env) — that path proves nothing about
		// `isolatedEnv` specifically. The guarantee this option adds is what happens when
		// `env` is left out entirely: `isolatedEnv` must still clear it rather than falling
		// through to the `options.env ?? process.env` default every other caller keeps.
		const marker = "REFARM_PROCESS_HANDOFF_ISOLATION_TEST_MARKER";
		const previous = process.env[marker];
		process.env[marker] = "leaked-from-parent";
		try {
			const args = ["-e", `process.stdout.write(process.env.${marker} || "absent")`];
			const result = await runProcessHandoff(
				{ command: process.execPath, args, display: createProcessHandoffDisplay("node", args) },
				{ capture: true, isolatedEnv: true },
			);
			expect(result.stdout).toBe("absent");
		} finally {
			if (previous === undefined) delete process.env[marker];
			else process.env[marker] = previous;
		}
	});

	it("still inherits process.env when isolatedEnv is omitted — additive, not a changed default", async () => {
		const marker = "REFARM_PROCESS_HANDOFF_ISOLATION_CONTROL_MARKER";
		const previous = process.env[marker];
		process.env[marker] = "inherited-on-purpose";
		try {
			const args = ["-e", `process.stdout.write(process.env.${marker} || "absent")`];
			const result = await runProcessHandoff(
				{ command: process.execPath, args, display: createProcessHandoffDisplay("node", args) },
				{ capture: true },
			);
			expect(result.stdout).toBe("inherited-on-purpose");
		} finally {
			if (previous === undefined) delete process.env[marker];
			else process.env[marker] = previous;
		}
	});

	it("kills the whole process group on timeout, not just the direct child (mirrors kill_process_group)", async () => {
		// A grandchild backgrounded by a non-interactive `bash -c` shares the shell's process
		// group (job control is off without a tty), so it joins whatever group we put the
		// shell in — exactly the case `process_group(0)` + `kill(-pgid, ...)` exists for on
		// the host: without a group-kill, this grandchild would survive the parent's death,
		// reparented to init.
		const pidFile = join(tmpdir(), `process-handoff-grandchild-pid-${Date.now()}-${process.pid}`);
		const script = `sleep 5 & echo $! > ${JSON.stringify(pidFile)}; wait`;
		const result = await runProcessHandoff(
			{ command: "/bin/bash", args: ["-c", script], display: "bash -c <script>" },
			{ timeout: 300 },
		);
		expect(result.timedOut).toBe(true);
		// Give the OS a beat to finish reaping after the signal.
		await new Promise((resolve) => setTimeout(resolve, 300));
		const grandchildPid = Number(readFileSync(pidFile, "utf-8").trim());
		let alive = true;
		try {
			process.kill(grandchildPid, 0);
		} catch {
			alive = false;
		}
		unlinkSync(pidFile);
		expect(alive).toBe(false);
	});

	it("resolves spawn failure as a result when spawnErrorAsResult is set, instead of throwing", async () => {
		const missingCommand = `refarm-missing-process-handoff-boundary-${process.pid}-${Date.now()}`;
		const result = await runProcessHandoff(
			{ command: missingCommand, args: [], display: missingCommand },
			{ spawnErrorAsResult: true },
		);
		expect(result.spawnError).toMatchObject({ code: "ENOENT" });
		expect(result.exitCode).toBe(-1);
	});

	it("still rejects on spawn failure when spawnErrorAsResult is omitted — additive, not a changed default", async () => {
		const missingCommand = `refarm-missing-process-handoff-boundary-${process.pid}-${Date.now()}-2`;
		await expect(
			runProcessHandoff({ command: missingCommand, args: [], display: missingCommand }),
		).rejects.toMatchObject({ code: "ENOENT" });
	});
});
