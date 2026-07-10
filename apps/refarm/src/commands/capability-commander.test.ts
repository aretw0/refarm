import type {
	CapabilityDescriptor,
	CapabilityGroup,
	CapabilityInput,
} from "@refarm.dev/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toCommanderCommand, toCommanderGroup } from "./capability-commander.js";

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
		const envelope = await runCommand(ECHO, ["./p", "--grant", "a", "--grant", "b", "--json"]);
		expect(envelope.ok).toBe(true);
		expect(envelope.command).toBe("echo");
		expect((envelope as { received: CapabilityInput }).received).toEqual({
			args: { path: "./p" },
			options: { grant: ["a", "b"], policy: "fail-fast" },
			json: true,
		});
	});

	it("resolves a hyphenated boolean flag commander camelCases (--include-secrets)", async () => {
		// commander stores `--include-secrets` under `includeSecrets`; the adapter
		// must map it back to the descriptor's raw `include-secrets` name so a
		// multi-word option actually reaches run().
		const withMultiWord: CapabilityDescriptor = {
			name: "echo",
			summary: "x",
			options: [{ name: "include-secrets", kind: "boolean", summary: "secrets" }],
			run: (input: CapabilityInput) =>
				buildJsonSuccessEnvelope({
					command: "echo",
					operation: "run",
					extra: { received: input },
				}),
		};
		const envelope = await runCommand(withMultiWord, ["--include-secrets", "--json"]);
		expect((envelope as { received: CapabilityInput }).received.options["include-secrets"]).toBe(
			true,
		);
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
			exitCode: (env: { readyToInstall?: boolean }) => (env.readyToInstall === false ? 1 : 0),
		});
		expect(process.exitCode).toBe(1);
	});
});

describe("toCommanderGroup", () => {
	const CHILD: CapabilityDescriptor = {
		name: "show",
		summary: "show capability",
		options: [{ name: "shell", kind: "boolean", summary: "shell form" }],
		run: (input: CapabilityInput) =>
			buildJsonSuccessEnvelope({
				command: "grp",
				operation: "show",
				extra: { marker: "SHOW", inputShell: Boolean(input.options.shell) },
			}),
	};
	const GROUP: CapabilityGroup = {
		name: "grp",
		summary: "a group",
		actions: { show: CHILD },
		defaultAction: "show",
	};

	async function runGroup(
		argv: string[],
		hooksFor: (sub: string) => Record<string, unknown> = () => ({}),
	): Promise<string[]> {
		captured.length = 0;
		logSpy = vi.spyOn(console, "log").mockImplementation((line = "") => {
			captured.push(String(line));
		});
		const command = toCommanderGroup(GROUP, hooksFor as never);
		await command.parseAsync(argv, { from: "user" });
		return captured;
	}

	// Regression: commander binds `--json` on a subcommand to the PARENT group's
	// option scope, so reading only the child's opts() missed it. The adapter now
	// reads optsWithGlobals(), so `--json` is honored after the sub-verb...
	it("detects --json after the sub-verb (parent-scope flag)", async () => {
		const out = JSON.parse((await runGroup(["show", "--json"])).join("\n"));
		expect(out.ok).toBe(true);
		expect(out.marker).toBe("SHOW");
	});

	// ...and before it, since the parent group also declares --json.
	it("detects --json before the sub-verb", async () => {
		const out = JSON.parse((await runGroup(["--json", "show"])).join("\n"));
		expect(out.marker).toBe("SHOW");
	});

	it("renders text by default when a renderText hook is present (no --json)", async () => {
		const lines = await runGroup(["show"], () => ({
			renderText: () => "PLAIN-TEXT",
		}));
		expect(lines.join("\n")).toBe("PLAIN-TEXT");
	});

	// renderText receives the resolved input so a hook can branch on a flag that
	// shapes presentation without changing the envelope (e.g. `env --shell`).
	it("passes the resolved input to renderText", async () => {
		const seen: Array<boolean | undefined> = [];
		await runGroup(["show", "--shell"], () => ({
			renderText: (_env: unknown, input?: CapabilityInput) => {
				seen.push(input?.options.shell as boolean | undefined);
				return "ok";
			},
		}));
		expect(seen).toEqual([true]);
	});

	// Regression: the BARE `<group>` form must accept the default action's OWN
	// options, not only the explicit `<group> <default> --flag` subcommand. Before
	// the group-default branch iterated child.options, commander rejected `--shell`
	// on the bare invocation ("unknown option") even though `show --shell` worked.
	it("accepts the default action's options on the bare group form", async () => {
		const out = JSON.parse((await runGroup(["--shell", "--json"])).join("\n"));
		expect(out.ok).toBe(true);
		expect(out.inputShell).toBe(true);
	});
});
