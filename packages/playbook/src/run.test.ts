import { describe, expect, it, vi } from "vitest";

import {
	parsePlaybook,
	resolvePath,
	runPlaybook,
	type DispatchStep,
	type Playbook,
} from "./index.js";

/** A fake dispatch: routes `<pluginId>:<verb>` to a canned result, recording every request so
 * we can assert what the interpreter emitted (the shape buildDispatchEffort takes). */
function fakeDispatch(routes: Record<string, (args: Record<string, unknown>) => unknown>): {
	dispatch: DispatchStep;
	calls: Array<{ pluginId: string; verb: string; args: Record<string, unknown> }>;
} {
	const calls: Array<{ pluginId: string; verb: string; args: Record<string, unknown> }> = [];
	const dispatch: DispatchStep = async (request) => {
		calls.push(request);
		const key = `${request.pluginId}:${request.verb}`;
		const route = routes[key];
		if (!route) throw new Error(`no route for ${key}`);
		return route(request.args);
	};
	return { dispatch, calls };
}

describe("resolvePath", () => {
	it("resolves dotted paths incl. array indices, undefined on a miss", () => {
		const scope = { a: { b: [{ c: 42 }] } };
		expect(resolvePath(scope, "a.b.0.c")).toBe(42);
		expect(resolvePath(scope, "a.b.1.c")).toBeUndefined();
		expect(resolvePath(scope, "a.x")).toBeUndefined();
	});
});

describe("runPlaybook — the threading core", () => {
	const scrapePlaybook: Playbook = {
		name: "scrape",
		steps: [
			{ verb: "source:pull", with: { ref: "{{ input.ref }}" }, saveAs: "pulled" },
			// thread the pulled records (an ARRAY — type preserved) into the next step
			{ verb: "records:store", with: { records: "{{ pulled.records }}" }, saveAs: "stored" },
		],
	};

	it("threads a step's output (raw type preserved) into the next step's args", async () => {
		const records = [{ id: "r1" }, { id: "r2" }];
		const { dispatch, calls } = fakeDispatch({
			"source:pull": (args) => {
				expect(args.ref).toBe("web:efd"); // interpolated from input
				return { records };
			},
			"records:store": (args) => {
				// the ARRAY was threaded through, not stringified
				expect(args.records).toEqual(records);
				return { count: (args.records as unknown[]).length };
			},
		});

		const result = await runPlaybook(scrapePlaybook, { dispatch, input: { ref: "web:efd" } });

		expect(result.ok).toBe(true);
		expect(result.steps.map((s) => s.ok)).toEqual([true, true]);
		expect(result.bindings.pulled).toEqual({ records });
		expect(result.bindings.stored).toEqual({ count: 2 });
		// The interpreter emitted the canonical dispatch shape per step.
		expect(calls[0]).toEqual({ pluginId: "source", verb: "pull", args: { ref: "web:efd" } });
		expect(calls[1]).toEqual({ pluginId: "records", verb: "store", args: { records } });
	});

	it("interpolates embedded refs as strings, exact refs as raw values", async () => {
		const pb: Playbook = {
			name: "mix",
			steps: [
				{ verb: "a:one", saveAs: "one" },
				{
					verb: "b:two",
					with: { raw: "{{ one.n }}", text: "n is {{ one.n }} of {{ one.label }}" },
				},
			],
		};
		const { dispatch, calls } = fakeDispatch({
			"a:one": () => ({ n: 7, label: "seven" }),
			"b:two": () => "ok",
		});
		await runPlaybook(pb, { dispatch });
		expect(calls[1]?.args.raw).toBe(7); // raw number, not "7"
		expect(calls[1]?.args.text).toBe("n is 7 of seven"); // string substitution
	});

	it("aborts on a failed step, marking the rest skipped (abort-on-fail)", async () => {
		const pb: Playbook = {
			name: "boom",
			steps: [{ verb: "a:ok" }, { verb: "a:boom" }, { verb: "a:never" }],
		};
		const boom: DispatchStep = async (req) => {
			if (req.verb === "boom") throw new Error("kaboom");
			return "ok";
		};
		const never = vi.fn(boom);
		const result = await runPlaybook(pb, { dispatch: never });

		expect(result.ok).toBe(false);
		expect(result.steps.map((s) => s.ok)).toEqual([true, false, false]);
		expect(result.steps[1]?.error).toContain("kaboom");
		expect(result.steps[2]?.error).toContain("skipped");
		// a:never was never dispatched (3rd call didn't happen)
		expect(never).toHaveBeenCalledTimes(2);
	});

	it("continueOnError runs later steps despite a failure", async () => {
		const pb: Playbook = {
			name: "resilient",
			steps: [{ verb: "a:boom" }, { verb: "a:ok" }],
		};
		const dispatch: DispatchStep = async (req) => {
			if (req.verb === "boom") throw new Error("x");
			return "done";
		};
		const result = await runPlaybook(pb, { dispatch, continueOnError: true });
		expect(result.steps.map((s) => s.ok)).toEqual([false, true]);
		expect(result.ok).toBe(false); // overall still failed
	});
});

describe("parsePlaybook — hand-rolled validation", () => {
	it("accepts a valid playbook and defaults schemaVersion", () => {
		const res = parsePlaybook({
			name: "p",
			steps: [{ verb: "source:pull", with: { ref: "x" }, saveAs: "r" }],
		});
		expect(res.ok).toBe(true);
		expect(res.playbook?.schemaVersion).toBe(1);
		expect(res.playbook?.steps[0]?.verb).toBe("source:pull");
	});

	it("collects every structured issue", () => {
		const res = parsePlaybook({ steps: [{ verb: "nocolon" }, { with: { a: 1 } }] });
		expect(res.ok).toBe(false);
		const codes = res.issues.map((i) => `${i.path}:${i.code}`);
		expect(codes).toContain("name:required");
		expect(codes).toContain("steps[0].verb:verb");
		expect(codes).toContain("steps[1].verb:verb"); // missing verb
	});

	it("rejects a non-object, empty steps, and a bad verb shape", () => {
		expect(parsePlaybook(null).ok).toBe(false);
		expect(parsePlaybook({ name: "x", steps: [] }).ok).toBe(false);
		expect(parsePlaybook({ name: "x", steps: [{ verb: "a:b:c" }] }).ok).toBe(false);
	});
});
