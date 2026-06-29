import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProcessHandoffRunner,
	createProcessHandoffSpec,
	createProcessHandoffSpecFromRunner,
	runProcessHandoff,
	splitProcessHandoffCommand,
	startDetachedProcessHandoff,
} from "./process-handoff.js";

async function waitForLogContent(
	logPath: string,
	expected: string,
	timeoutMs = 2_000,
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let content = "";
	while (Date.now() < deadline) {
		content = readFileSync(logPath, "utf-8");
		if (content.includes(expected)) return content;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return content;
}

describe("splitProcessHandoffCommand", () => {
	it("splits a process handoff command into command + args", () => {
		expect(splitProcessHandoffCommand("runner -C apps/dev run dev")).toEqual({
			command: "runner",
			args: ["-C", "apps/dev", "run", "dev"],
		});
	});

	it("normalizes repeated whitespace", () => {
		expect(splitProcessHandoffCommand("cargo   run -p tractor -- watch")).toEqual({
			command: "cargo",
			args: ["run", "-p", "tractor", "--", "watch"],
		});
	});

	it("preserves quoted process handoff arguments", () => {
		expect(splitProcessHandoffCommand("runner --label 'Refarm Dev'")).toEqual({
			command: "runner",
			args: ["--label", "Refarm Dev"],
		});
	});

	it("rejects empty process handoff command", () => {
		expect(() => splitProcessHandoffCommand("   ")).toThrow(
			/Invalid process handoff command/,
		);
	});

	it("builds full process handoff spec from command display", () => {
		expect(createProcessHandoffSpec("runner -C apps/dev run dev")).toEqual({
			command: "runner",
			args: ["-C", "apps/dev", "run", "dev"],
			display: "runner -C apps/dev run dev",
		});
	});

	it("can carry an explicit working directory", () => {
		expect(
			createProcessHandoffSpec("tractor watch", { cwd: "/workspaces/refarm" }),
		).toEqual({
			command: "tractor",
			args: ["watch"],
			cwd: "/workspaces/refarm",
			display: "tractor watch",
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

	it("lets consumers override runner process display strings", () => {
		expect(
			createProcessHandoffSpecFromRunner("refarm", ["check", "--json"], {
				display: "refarm check --json",
			}),
		).toEqual({
			command: "refarm",
			args: ["check", "--json"],
			display: "refarm check --json",
		});
	});

	it("can capture process output and exit code", async () => {
		await expect(
			runProcessHandoff(
				{
					command: process.execPath,
					args: [
						"-e",
						"process.stdout.write('ok'); process.stderr.write('warn'); process.exit(2);",
					],
					display: "node -e <script>",
				},
				{ capture: true },
			),
		).resolves.toEqual({
			exitCode: 2,
			stdout: "ok",
			stderr: "warn",
		});
	});

	it("creates a runner adapter that resolves on successful process execution", async () => {
		const calls: unknown[] = [];
		const runner = createProcessHandoffRunner(async (spec, options) => {
			calls.push({ spec, options });
			return { exitCode: 0 };
		});

		await expect(
			runner("node", ["scripts/etl.mjs"], {
				cwd: "/workspaces/vault",
				capture: true,
				env: { NODE_ENV: "test" },
			}),
		).resolves.toBeUndefined();
		expect(calls).toEqual([
			{
				spec: {
					command: "node",
					args: ["scripts/etl.mjs"],
					cwd: "/workspaces/vault",
					display: "node 'scripts/etl.mjs'",
				},
				options: {
					cwd: "/workspaces/vault",
					capture: true,
					env: { NODE_ENV: "test" },
				},
			},
		]);
	});

	it("creates a runner adapter that rejects failed process execution", async () => {
		const runner = createProcessHandoffRunner(async () => ({ exitCode: 2 }));

		await expect(
			runner("node", ["scripts/etl.mjs"], {
				display: "node scripts/etl.mjs",
			}),
		).rejects.toThrow("'node scripts/etl.mjs' exited with code 2");
	});

	it("can launch a detached process and capture output to a log", async () => {
		const root = join(tmpdir(), `refarm-process-handoff-${Date.now()}`);
		const logPath = join(root, "process.log");
		const script = join(root, "write-log.js");
		mkdirSync(root, { recursive: true });
		writeFileSync(script, "process.stdout.write('detached ok');");

		try {
			startDetachedProcessHandoff(
				{
					command: process.execPath,
					args: [script],
					display: "node write-log.js",
				},
				{ logPath },
			);
			await expect(waitForLogContent(logPath, "detached ok")).resolves.toContain(
				"detached ok",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
