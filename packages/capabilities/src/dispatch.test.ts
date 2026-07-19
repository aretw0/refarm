import { describe, expect, it } from "vitest";

import { dispatchCapability, resolveCapabilityInvocation } from "./dispatch.js";
import { buildJsonSuccessEnvelope } from "./envelope.js";
import type { CapabilityDescriptor, CapabilityGroup } from "./types.js";

/** A contract-conforming success envelope (nextAction/nextCommands filled) for a test verb. */
const okEnvelope = () => buildJsonSuccessEnvelope({ command: "test", operation: "run" });

const echo: CapabilityDescriptor = {
	name: "echo",
	summary: "echo a message",
	args: [{ name: "msg", required: true, type: "string" }],
	run: (input) => buildJsonSuccessEnvelope({ command: "echo", operation: "run", extra: { echo: input.args } }),
};

function group(actions: Record<string, CapabilityDescriptor>, defaultAction?: string): CapabilityGroup {
	return { name: "model", summary: "model group", actions, ...(defaultAction ? { defaultAction } : {}) };
}

describe("resolveCapabilityInvocation — one resolution for every surface", () => {
	it("parses a FLAT verb's argv into its args (not an empty input — the bug some surfaces had)", () => {
		const invocation = resolveCapabilityInvocation(echo, ["hi"]);
		expect(invocation?.descriptor.name).toBe("echo");
		expect(invocation?.input.args).toMatchObject({ msg: "hi" });
	});

	it("resolves a group's default sub-action from tokens", () => {
		const g = group({ current: { name: "current", summary: "current", run: okEnvelope } }, "current");
		const invocation = resolveCapabilityInvocation(g, []);
		expect(invocation?.descriptor.name).toBe("current");
		expect(invocation?.key).toBe("current");
	});

	it("returns null when a group has no matching action and no default (caller shows help)", () => {
		expect(resolveCapabilityInvocation(group({}), ["nope"])).toBeNull();
	});
});

describe("dispatchCapability — resolve → validate → run, one outcome shape", () => {
	it("runs a valid invocation and returns the envelope", async () => {
		const outcome = await dispatchCapability(echo, ["hi"]);
		expect(outcome.status).toBe("ran");
		expect(outcome.envelope).toMatchObject({ ok: true, echo: { msg: "hi" } });
	});

	it("returns invalid (nothing runs) when a required arg is missing — parse rejects it", async () => {
		let ran = false;
		const guarded: CapabilityDescriptor = {
			...echo,
			run: () => {
				ran = true;
				return okEnvelope();
			},
		};
		const outcome = await dispatchCapability(guarded, []); // missing the required `msg`
		expect(outcome.status).toBe("invalid");
		expect(outcome.validation?.errors[0]?.message).toContain("msg");
		expect(ran).toBe(false);
	});

	it("returns invalid on a type mismatch the schema catches beyond parse (Ajv)", async () => {
		const counter: CapabilityDescriptor = {
			name: "count",
			summary: "count up",
			args: [{ name: "n", required: true, type: "integer" }],
			run: okEnvelope,
		};
		// `n` is present (parse is happy) but not an integer — Ajv rejects it, field-scoped.
		const outcome = await dispatchCapability(counter, ["not-a-number"]);
		expect(outcome.status).toBe("invalid");
		expect(outcome.validation?.errors.some((e) => e.field === "n" && /integer/.test(e.message))).toBe(true);
	});

	it("returns unresolved for an unmatched group action", async () => {
		expect((await dispatchCapability(group({}), ["nope"])).status).toBe("unresolved");
	});
});
