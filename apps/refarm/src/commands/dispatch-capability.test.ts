import { parseCapabilityArgv } from "@refarm.dev/cli/capabilities";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import { describe, expect, it } from "vitest";

import {
	createDispatchCapability,
	parseDispatchArgs,
	type DispatchCommandDeps,
} from "./dispatch-capability.js";

function makeDeps(): DispatchCommandDeps & { submitted: Effort[] } {
	const submitted: Effort[] = [];
	let n = 0;
	return {
		submitted,
		submitEffort: async (effort) => {
			submitted.push(effort);
			return effort.id;
		},
		newId: () => `id-${++n}`,
		nowIso: () => "2026-01-01T00:00:00Z",
	};
}

describe("parseDispatchArgs", () => {
	it("parses key=value, JSON values structured, bare values as strings", () => {
		const r = parseDispatchArgs(['note={"path":"n.md"}', "limit=5", "verb=extract"]);
		expect("args" in r && r.args).toEqual({
			note: { path: "n.md" },
			limit: 5,
			verb: "extract",
		});
	});

	it("errors on a malformed pair", () => {
		expect(parseDispatchArgs(["nokey"])).toEqual({ error: 'arg "nokey" must be key=value' });
	});
});

describe("dispatch capability", () => {
	it("declares plugin + verb + variadic args and projects to surfaces", () => {
		const cap = createDispatchCapability(makeDeps());
		expect(cap.name).toBe("dispatch");
		expect(cap.args?.map((a) => a.name)).toEqual(["plugin", "verb", "args"]);
		expect(cap.args?.find((a) => a.name === "args")?.variadic).toBe(true);
		expect(cap.transports?.http).toEqual({ method: "POST", path: "/dispatch" });
	});

	it("submits an effort {pluginId, fn: verb, args + replyRef} for ANY plugin", async () => {
		const d = makeDeps();
		const cap = createDispatchCapability(d);
		const input = parseCapabilityArgv(cap, ["quality", "check", 'subject="hi"']);
		const env = (await cap.run!(input)) as unknown as {
			ok: boolean;
			pluginId: string;
			verb: string;
			replyRef: string;
			effortId: string;
		};
		expect(env.ok).toBe(true);
		expect(env.pluginId).toBe("quality");
		expect(env.verb).toBe("check");
		expect(d.submitted).toHaveLength(1);
		const task = d.submitted[0]!.tasks[0]!;
		expect(task.pluginId).toBe("quality");
		expect(task.fn).toBe("check");
		expect((task.args as { subject: string }).subject).toBe("hi");
		expect((task.args as { replyRef: string }).replyRef).toBe(env.effortId);
	});

	it("returns an error envelope on a malformed arg", async () => {
		const cap = createDispatchCapability(makeDeps());
		const input = parseCapabilityArgv(cap, ["vault", "extract", "bad-arg"]);
		const env = await cap.run!(input);
		expect(env.ok).toBe(false);
		expect((env as { error?: string }).error).toBe("invalid-args");
	});

	it("returns an error envelope when the submit fails", async () => {
		const d = makeDeps();
		d.submitEffort = async () => {
			throw new Error("runtime HTTP 502");
		};
		const cap = createDispatchCapability(d);
		const input = parseCapabilityArgv(cap, ["vault", "extract"]);
		const env = await cap.run!(input);
		expect(env.ok).toBe(false);
		expect((env as { error?: string }).error).toBe("dispatch-failed");
	});
});
