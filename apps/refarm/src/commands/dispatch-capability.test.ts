import { parseCapabilityArgv } from "@refarm.dev/capabilities";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import { describe, expect, it } from "vitest";

import {
	createDispatchCapability,
	parseBudgetOptions,
	parseDispatchArgs,
	type BudgetDeclaration,
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

describe("parseBudgetOptions", () => {
	it("parses all three flags into the wire's camelCase shape", () => {
		const r = parseBudgetOptions({
			"budget-deadline-ms": "120000",
			"budget-max-tokens": "50000",
			"budget-max-usd": "2.5",
		});
		expect("budget" in r && r.budget).toEqual({
			deadlineMs: 120000,
			maxTokens: 50000,
			maxUsd: 2.5,
		} satisfies BudgetDeclaration);
	});

	it("omitting a flag omits that field entirely — not 0, not null", () => {
		const r = parseBudgetOptions({ "budget-deadline-ms": "120000" });
		expect("budget" in r && r.budget).toEqual({ deadlineMs: 120000 });
		expect("budget" in r && r.budget && "maxTokens" in r.budget).toBe(false);
		expect("budget" in r && r.budget && "maxUsd" in r.budget).toBe(false);
	});

	it("omitting all three sends no budget object at all", () => {
		const r = parseBudgetOptions({});
		expect(r).toEqual({});
		expect("budget" in r).toBe(false);
	});

	it("also treats an option absent from a larger options bag as absent", () => {
		const r = parseBudgetOptions({ json: true, limit: "5" });
		expect(r).toEqual({});
	});

	it("accepts an explicit zero as a real declared ceiling", () => {
		const r = parseBudgetOptions({ "budget-max-tokens": "0" });
		expect("budget" in r && r.budget).toEqual({ maxTokens: 0 });
	});

	it("rejects a negative value, naming the flag", () => {
		const r = parseBudgetOptions({ "budget-deadline-ms": "-1" });
		expect(r).toEqual({ error: '--budget-deadline-ms must not be negative, got "-1"' });
	});

	it("rejects a non-numeric value, naming the flag", () => {
		const r = parseBudgetOptions({ "budget-max-usd": "soon" });
		expect(r).toEqual({ error: '--budget-max-usd must be a number, got "soon"' });
	});

	it("rejects an empty-string value rather than reading it as zero", () => {
		const r = parseBudgetOptions({ "budget-max-tokens": "  " });
		expect(r).toEqual({ error: '--budget-max-tokens must be a number, got "  "' });
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

	it("declares the three budget flags as options", () => {
		const cap = createDispatchCapability(makeDeps());
		expect(cap.options?.map((o) => o.name)).toEqual([
			"budget-deadline-ms",
			"budget-max-tokens",
			"budget-max-usd",
		]);
	});

	it("--budget-deadline-ms rides the effort as Effort.budget.deadlineMs, from real argv", async () => {
		const d = makeDeps();
		const cap = createDispatchCapability(d);
		const input = parseCapabilityArgv(cap, [
			"quality",
			"check",
			"--budget-deadline-ms",
			"120000",
		]);
		const env = await cap.run!(input);
		expect(env.ok).toBe(true);
		expect(d.submitted).toHaveLength(1);
		expect((d.submitted[0] as Effort & { budget?: BudgetDeclaration }).budget).toEqual({
			deadlineMs: 120000,
		});
	});

	it("all three budget flags together ride as one Effort.budget object", async () => {
		const d = makeDeps();
		const cap = createDispatchCapability(d);
		const input = parseCapabilityArgv(cap, [
			"quality",
			"check",
			"--budget-deadline-ms",
			"120000",
			"--budget-max-tokens",
			"50000",
			"--budget-max-usd",
			"2.5",
		]);
		await cap.run!(input);
		expect((d.submitted[0] as Effort & { budget?: BudgetDeclaration }).budget).toEqual({
			deadlineMs: 120000,
			maxTokens: 50000,
			maxUsd: 2.5,
		});
	});

	it("no --budget-* flag ⇒ the submitted effort carries no budget key at all (byte-identical to today)", async () => {
		const d = makeDeps();
		const cap = createDispatchCapability(d);
		const input = parseCapabilityArgv(cap, ["quality", "check"]);
		await cap.run!(input);
		const submitted = d.submitted[0] as Effort & { budget?: BudgetDeclaration };
		expect("budget" in submitted).toBe(false);
		expect(JSON.stringify(submitted).includes("budget")).toBe(false);
	});

	it("rejects an invalid --budget-max-usd before dispatching anything", async () => {
		const d = makeDeps();
		const cap = createDispatchCapability(d);
		const input = parseCapabilityArgv(cap, ["quality", "check", "--budget-max-usd", "not-a-number"]);
		const env = await cap.run!(input);
		expect(env.ok).toBe(false);
		expect((env as { error?: string }).error).toBe("invalid-args");
		expect((env as { message?: string }).message).toBe(
			'--budget-max-usd must be a number, got "not-a-number"',
		);
		expect(d.submitted).toHaveLength(0);
	});

	it("rejects a negative --budget-deadline-ms before dispatching anything", async () => {
		const d = makeDeps();
		const cap = createDispatchCapability(d);
		const input = parseCapabilityArgv(cap, ["quality", "check", "--budget-deadline-ms", "-5"]);
		const env = await cap.run!(input);
		expect(env.ok).toBe(false);
		expect((env as { error?: string }).error).toBe("invalid-args");
		expect(d.submitted).toHaveLength(0);
	});
});
