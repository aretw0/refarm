import { describe, expect, it, vi } from "vitest";

import { createLocalDispatchStep, type LocalVerb } from "./capability.js";
import { runPlaybook, type Playbook } from "./index.js";

/** A tiny verb registry: name → a run() returning an envelope. */
function registry(verbs: Record<string, (input: unknown) => Record<string, unknown>>) {
	return (pluginId: string, verb: string): LocalVerb | undefined => {
		const key = `${pluginId}:${verb}`;
		const run = verbs[key];
		if (!run) return undefined;
		return { run: (input) => run(input) as never };
	};
}

describe("createLocalDispatchStep — run a playbook against in-process verbs", () => {
	it("resolves a verb, runs it, and returns the (success) envelope as the result", async () => {
		const resolve = registry({
			"source:pull": (input) => {
				const args = (input as { args: Record<string, unknown> }).args;
				return { ok: true, command: "source", operation: "pull", ref: args.ref, count: 3 };
			},
		});
		const step = createLocalDispatchStep({ resolve });
		const result = (await step({ pluginId: "source", verb: "pull", args: { ref: "web:efd" } })) as {
			ref: string;
			count: number;
		};
		expect(result.ref).toBe("web:efd");
		expect(result.count).toBe(3);
	});

	it("throws on an unknown verb (the step fails)", async () => {
		const step = createLocalDispatchStep({ resolve: registry({}) });
		await expect(step({ pluginId: "x", verb: "y", args: {} })).rejects.toThrow(/UNKNOWN_VERB/);
	});

	it("throws on an error envelope (ok:false → abort-on-fail)", async () => {
		const resolve = registry({
			"a:b": () => ({ ok: false, error: "boom", message: "it broke" }),
		});
		const step = createLocalDispatchStep({ resolve });
		await expect(step({ pluginId: "a", verb: "b", args: {} })).rejects.toThrow(/it broke/);
	});

	it("runs a whole threaded playbook against in-process verbs", async () => {
		const resolve = registry({
			"source:pull": (input) => {
				const args = (input as { args: Record<string, unknown> }).args;
				expect(args.ref).toBe("web:efd");
				return { ok: true, records: [{ id: "r1" }, { id: "r2" }] };
			},
			"records:store": (input) => {
				const args = (input as { args: Record<string, unknown> }).args;
				return { ok: true, stored: (args.records as unknown[]).length };
			},
		});
		const step = createLocalDispatchStep({ resolve });
		const pb: Playbook = {
			name: "scrape",
			steps: [
				{ verb: "source:pull", with: { ref: "{{ input.ref }}" }, saveAs: "pulled" },
				{ verb: "records:store", with: { records: "{{ pulled.records }}" }, saveAs: "stored" },
			],
		};
		const run = await runPlaybook(pb, { dispatch: step, input: { ref: "web:efd" } });
		expect(run.ok).toBe(true);
		expect((run.bindings.stored as { stored: number }).stored).toBe(2);
	});

	it("uses a custom toInput mapping when provided", async () => {
		const seen: unknown[] = [];
		const resolve = registry({
			"a:b": (input) => {
				seen.push(input);
				return { ok: true };
			},
		});
		const step = createLocalDispatchStep({
			resolve,
			toInput: (d) => ({ args: { only: d.args.keep }, options: {}, json: true }) as never,
		});
		await step({ pluginId: "a", verb: "b", args: { keep: 1, drop: 2 } });
		expect(seen[0]).toEqual({ args: { only: 1 }, options: {}, json: true });
	});
});
