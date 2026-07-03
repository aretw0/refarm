import type {
	CapabilityDescriptor,
	CapabilityInput,
} from "@refarm.dev/cli/capabilities";
import { buildJsonErrorEnvelope, buildJsonSuccessEnvelope } from "@refarm.dev/cli/json-output";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toCommanderCommand } from "./capability-commander.js";

const ECHO: CapabilityDescriptor = {
	name: "echo",
	summary: "echo capability",
	args: [{ name: "path", required: true }],
	options: [
		{ name: "grant", kind: "string[]", summary: "grant" },
		{ name: "policy", kind: "string", summary: "policy", defaultValue: "fail-fast" },
	],
	run: (input: CapabilityInput) =>
		buildJsonSuccessEnvelope({
			command: "echo",
			operation: "run",
			extra: { received: input },
		}),
};

let logSpy: ReturnType<typeof vi.spyOn>;
const captured: string[] = [];

afterEach(() => {
	logSpy?.mockRestore();
	captured.length = 0;
	process.exitCode = undefined;
});

async function runCommand(
	descriptor: CapabilityDescriptor,
	argv: string[],
	hooks = {},
): Promise<Record<string, unknown>> {
	captured.length = 0;
	logSpy = vi.spyOn(console, "log").mockImplementation((line = "") => {
		captured.push(String(line));
	});
	const command = toCommanderCommand(descriptor, hooks);
	await command.parseAsync(argv, { from: "user" });
	return JSON.parse(captured.join("\n")) as Record<string, unknown>;
}

describe("toCommanderCommand", () => {
	it("builds a command that packs argv into CapabilityInput and prints the envelope", async () => {
		const envelope = await runCommand(ECHO, [
			"./p",
			"--grant",
			"a",
			"--grant",
			"b",
			"--json",
		]);
		expect(envelope.ok).toBe(true);
		expect(envelope.command).toBe("echo");
		expect((envelope as { received: CapabilityInput }).received).toEqual({
			args: { path: "./p" },
			options: { grant: ["a", "b"], policy: "fail-fast" },
			json: true,
		});
	});

	it("maps ok:false to process.exitCode=1 by default", async () => {
		const failing: CapabilityDescriptor = {
			name: "fail",
			summary: "x",
			run: () =>
				buildJsonErrorEnvelope({
					command: "fail",
					operation: "run",
					error: "boom",
					message: "boom",
					nextAction: "retry",
				}),
		};
		await runCommand(failing, ["--json"]);
		expect(process.exitCode).toBe(1);
	});

	it("uses a descriptor exitCode hook to derive exit from a success envelope field", async () => {
		const review: CapabilityDescriptor = {
			name: "review",
			summary: "x",
			run: () =>
				buildJsonSuccessEnvelope({
					command: "review",
					operation: "run",
					extra: { readyToInstall: false },
				}),
		};
		await runCommand(review, ["--json"], {
			exitCode: (env: { readyToInstall?: boolean }) =>
				env.readyToInstall === false ? 1 : 0,
		});
		expect(process.exitCode).toBe(1);
	});
});
