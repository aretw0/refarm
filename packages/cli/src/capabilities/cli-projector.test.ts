import { describe, expect, it } from "vitest";

import { buildJsonSuccessEnvelope } from "../json-output.js";
import {
	capabilityCliCommands,
	capabilityCliCommandsForGroup,
	toCommanderCommand,
	type CapabilityHooksResolver,
} from "./cli-projector.js";
import type { CapabilityDescriptor, CapabilityGroup } from "./types.js";

const noHooks: CapabilityHooksResolver = () => ({});

/** A flat top-level verb. */
const ping: CapabilityDescriptor = {
	name: "ping",
	summary: "Return pong",
	run: () => buildJsonSuccessEnvelope({ command: "ping", operation: "check" }),
	transports: { cli: {} },
};

/** A verb grouped under `extension` (mounts under the parent, not top-level). */
const review: CapabilityDescriptor = {
	name: "review",
	summary: "Review a thing",
	run: () => buildJsonSuccessEnvelope({ command: "extension", operation: "review" }),
	transports: { cli: { group: "extension" } },
};

/** A verb-group. */
const model: CapabilityGroup = {
	name: "model",
	summary: "Model settings",
	defaultAction: "current",
	actions: {
		current: {
			name: "current",
			summary: "Show current model",
			run: () => buildJsonSuccessEnvelope({ command: "model", operation: "current" }),
		},
	},
};

describe("cli-projector — parameterized over any registry (two-layer seam)", () => {
	it("projects only TOP-LEVEL entries (grouped verbs are excluded unless directAlias)", () => {
		const commands = capabilityCliCommands([ping, review, model], noHooks);
		// ping (flat) + model (group) are top-level; review (grouped) is NOT.
		expect(commands.map((c) => c.name()).sort()).toEqual(["model", "ping"]);
	});

	it("projects a directAlias grouped verb as a top-level forwarder too", () => {
		const aliased: CapabilityDescriptor = {
			...review,
			name: "aliased",
			transports: { cli: { group: "extension", directAlias: true } },
		};
		const commands = capabilityCliCommands([aliased], noHooks);
		expect(commands.map((c) => c.name())).toEqual(["aliased"]);
	});

	it("mounts a group's sub-actions as subcommands", () => {
		const [modelCmd] = capabilityCliCommands([model], noHooks);
		expect(modelCmd?.commands.map((c) => c.name())).toContain("current");
	});

	it("capabilityCliCommandsForGroup returns only the verbs of that group", () => {
		const underExtension = capabilityCliCommandsForGroup(
			[ping, review, model],
			"extension",
			noHooks,
		);
		expect(underExtension.map((c) => c.name())).toEqual(["review"]);
	});

	it("runs a verb's run() and prints its envelope (a real command, not a stub)", async () => {
		const logs: string[] = [];
		const spy = (msg?: unknown) => logs.push(String(msg));
		const original = console.log;
		console.log = spy as typeof console.log;
		try {
			const cmd = toCommanderCommand(ping, {
				renderText: () => "pong",
			});
			await cmd.parseAsync(["node", "ping"]);
		} finally {
			console.log = original;
		}
		expect(logs.join("\n")).toContain("pong");
	});

	it("the hooks resolver is honored per entry (the app supplies its own)", async () => {
		const seen: string[] = [];
		const hooks: CapabilityHooksResolver = (name) => {
			seen.push(name);
			return {};
		};
		// A registry mixing a flat verb + a group — the resolver is called with the
		// flat name and the "<group> <sub>" composite, so any app can back it.
		capabilityCliCommands([ping, model], hooks);
		expect(seen).toContain("ping");
		expect(seen).toContain("model current");
	});
});
