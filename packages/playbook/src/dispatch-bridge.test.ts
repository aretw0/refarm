import { describe, expect, it, vi } from "vitest";

import {
	createDispatchStep,
	runPlaybook,
	toDispatchEffort,
	type DispatchEffort,
	type DispatchResultNode,
	type Playbook,
} from "./index.js";

let idCounter = 0;
const newId = () => `id-${++idCounter}`;
const nowIso = () => "2026-07-12T00:00:00.000Z";
const noSleep = async () => {};

describe("toDispatchEffort", () => {
	it("builds the canonical dispatch effort with replyRef = effort id", () => {
		idCounter = 0;
		const effort = toDispatchEffort(
			{ pluginId: "source", verb: "pull", args: { ref: "web:efd" } },
			newId,
			nowIso,
		);
		expect(effort.direction).toBe("dispatch");
		expect(effort.source).toBe("playbook");
		expect(effort.tasks).toHaveLength(1);
		expect(effort.tasks[0]).toMatchObject({ pluginId: "source", fn: "pull" });
		// the task args carry the original args + a replyRef equal to the effort id
		expect(effort.tasks[0]?.args).toEqual({ ref: "web:efd", replyRef: effort.id });
	});
});

describe("createDispatchStep — submit + poll the graph for the result", () => {
	it("submits, then returns the dispatch-result node's result once it appears", async () => {
		idCounter = 0;
		const submitted: DispatchEffort[] = [];
		let poll = 0;
		// The result node appears on the 3rd poll — proving the loop waits + correlates.
		const nodes: DispatchResultNode[] = [];
		const step = createDispatchStep({
			submit: async (e) => {
				submitted.push(e);
				return e.id;
			},
			queryNodes: async () => {
				poll += 1;
				if (poll === 3) {
					const replyRef = submitted[0]!.id;
					nodes.push({ replyRef, result: { records: [{ id: "r1" }] } });
				}
				return nodes;
			},
			newId,
			nowIso,
			sleep: noSleep,
		});

		const result = await step({ pluginId: "source", verb: "pull", args: { ref: "web:efd" } });
		expect(result).toEqual({ records: [{ id: "r1" }] });
		expect(submitted).toHaveLength(1);
		expect(poll).toBe(3);
	});

	it("correlates the RIGHT node by replyRef (ignores other efforts' results)", async () => {
		idCounter = 0;
		let submittedId = "";
		const step = createDispatchStep({
			submit: async (e) => {
				submittedId = e.id;
				return e.id;
			},
			queryNodes: async () => [
				{ replyRef: "someone-else", result: "wrong" },
				{ replyRef: submittedId, result: "right" },
			],
			newId,
			nowIso,
			sleep: noSleep,
		});
		expect(await step({ pluginId: "a", verb: "b", args: {} })).toBe("right");
	});

	it("throws when the result node reports an error", async () => {
		idCounter = 0;
		let submittedId = "";
		const step = createDispatchStep({
			submit: async (e) => ((submittedId = e.id), e.id),
			queryNodes: async () => [{ replyRef: submittedId, error: "plugin blew up" }],
			newId,
			nowIso,
			sleep: noSleep,
		});
		await expect(step({ pluginId: "a", verb: "b", args: {} })).rejects.toThrow(/plugin blew up/);
	});

	it("times out when no matching result ever appears", async () => {
		idCounter = 0;
		let clock = 0;
		const step = createDispatchStep({
			submit: async (e) => e.id,
			queryNodes: async () => [], // never resolves
			newId,
			nowIso,
			sleep: noSleep,
			now: () => (clock += 100), // advance the clock each check
			timeoutMs: 300,
		});
		await expect(step({ pluginId: "a", verb: "b", args: {} })).rejects.toThrow(/DISPATCH_TIMEOUT/);
	});

	it("runs a whole playbook on the bridge (submit+poll per step, threaded)", async () => {
		idCounter = 0;
		// A tiny in-memory "runtime": submit records the effort; a resolver produces the result
		// node for each replyRef so the poll finds it immediately.
		const resultsByRef = new Map<string, unknown>();
		const submit = vi.fn(async (e: DispatchEffort) => {
			const task = e.tasks[0]!;
			// canned per-verb behavior
			if (task.fn === "pull") resultsByRef.set(e.id, { records: [{ id: "x" }] });
			if (task.fn === "store")
				resultsByRef.set(e.id, { count: (task.args.records as unknown[]).length });
			return e.id;
		});
		const queryNodes = async () =>
			[...resultsByRef.entries()].map(([replyRef, result]) => ({ replyRef, result }));

		const step = createDispatchStep({ submit, queryNodes, newId, nowIso, sleep: noSleep });
		const pb: Playbook = {
			name: "scrape",
			steps: [
				{ verb: "source:pull", with: { ref: "web:efd" }, saveAs: "pulled" },
				{ verb: "records:store", with: { records: "{{ pulled.records }}" }, saveAs: "stored" },
			],
		};
		const run = await runPlaybook(pb, { dispatch: step });
		expect(run.ok).toBe(true);
		expect(run.bindings.stored).toEqual({ count: 1 });
		expect(submit).toHaveBeenCalledTimes(2); // one dispatch per step
	});
});
