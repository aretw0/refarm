import { describe, expect, it } from "vitest";
import {
	createLaunchProcessSpec,
	splitLaunchCommand,
} from "../../src/commands/launch-process.js";

describe("splitLaunchCommand", () => {
	it("splits launcher command into command + args", () => {
		expect(splitLaunchCommand("npm --prefix apps/dev run dev")).toEqual({
			command: "npm",
			args: ["--prefix", "apps/dev", "run", "dev"],
		});
	});

	it("normalizes repeated whitespace", () => {
		expect(splitLaunchCommand("cargo   run -p tractor -- watch")).toEqual({
			command: "cargo",
			args: ["run", "-p", "tractor", "--", "watch"],
		});
	});

	it("rejects empty launcher command", () => {
		expect(() => splitLaunchCommand("   ")).toThrow(/Invalid launcher command/);
	});

	it("builds full launch process spec from command display", () => {
		expect(createLaunchProcessSpec("npm --prefix apps/dev run dev")).toEqual({
			command: "npm",
			args: ["--prefix", "apps/dev", "run", "dev"],
			display: "npm --prefix apps/dev run dev",
		});
	});
});
