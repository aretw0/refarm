import { describe, expect, it } from "vitest";
import {
	createLaunchProcessSpec,
	runLaunchProcess,
	splitLaunchCommand,
} from "./launch-process.js";

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
});
