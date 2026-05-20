import { describe, expect, it } from "vitest";
import {
	createLaunchProcessSpec,
	splitLaunchCommand,
} from "../../src/commands/launch-process.js";

describe("splitLaunchCommand", () => {
	it("splits launcher command into command + args", () => {
		expect(splitLaunchCommand("pnpm -C apps/dev run dev")).toEqual({
			command: "pnpm",
			args: ["-C", "apps/dev", "run", "dev"],
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
		expect(createLaunchProcessSpec("pnpm -C apps/dev run dev")).toEqual({
			command: "pnpm",
			args: ["-C", "apps/dev", "run", "dev"],
			display: "pnpm -C apps/dev run dev",
		});
	});
});
