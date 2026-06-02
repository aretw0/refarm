import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createLaunchProcessSpec,
	launchDetachedProcess,
	runLaunchProcess,
	splitLaunchCommand,
} from "./launch-process.js";

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

describe("splitLaunchCommand", () => {
	it("splits launcher command into command + args", () => {
		expect(splitLaunchCommand("runner -C apps/dev run dev")).toEqual({
			command: "runner",
			args: ["-C", "apps/dev", "run", "dev"],
		});
	});

	it("normalizes repeated whitespace", () => {
		expect(splitLaunchCommand("cargo   run -p tractor -- watch")).toEqual({
			command: "cargo",
			args: ["run", "-p", "tractor", "--", "watch"],
		});
	});

	it("preserves quoted launcher arguments", () => {
		expect(splitLaunchCommand("runner --label 'Refarm Dev'")).toEqual({
			command: "runner",
			args: ["--label", "Refarm Dev"],
		});
	});

	it("rejects empty launcher command", () => {
		expect(() => splitLaunchCommand("   ")).toThrow(/Invalid launcher command/);
	});

	it("builds full launch process spec from command display", () => {
		expect(createLaunchProcessSpec("runner -C apps/dev run dev")).toEqual({
			command: "runner",
			args: ["-C", "apps/dev", "run", "dev"],
			display: "runner -C apps/dev run dev",
		});
	});

	it("can carry an explicit working directory", () => {
		expect(
			createLaunchProcessSpec("tractor watch", { cwd: "/workspaces/refarm" }),
		).toEqual({
			command: "tractor",
			args: ["watch"],
			cwd: "/workspaces/refarm",
			display: "tractor watch",
		});
	});

	it("can capture process output and exit code", async () => {
		await expect(
			runLaunchProcess(
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

	it("can launch a detached process and capture output to a log", async () => {
		const root = join(tmpdir(), `refarm-launch-process-${Date.now()}`);
		const logPath = join(root, "process.log");
		const script = join(root, "write-log.js");
		mkdirSync(root, { recursive: true });
		writeFileSync(script, "process.stdout.write('detached ok');");

		try {
			launchDetachedProcess(
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
