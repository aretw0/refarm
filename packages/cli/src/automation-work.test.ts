import { describe, expect, it } from "vitest";

import {
	automationBodyFromWork,
	automationWorkTasks,
	bodyWorkClasses,
	parseDispatchTarget,
} from "./automation-work.js";

describe("parseDispatchTarget", () => {
	it("splits plugin and verb", () => {
		expect(parseDispatchTarget("lsp-code-ops:ingest")).toEqual({
			pluginId: "lsp-code-ops",
			fn: "ingest",
		});
	});

	it("refuses a target with no verb rather than guessing one", () => {
		expect(() => parseDispatchTarget("lsp-code-ops")).toThrow(/<pluginId>:<verb>/);
		expect(() => parseDispatchTarget("lsp-code-ops:")).toThrow(/<pluginId>:<verb>/);
	});
});

describe("automationWorkTasks", () => {
	it("makes an ask a respond task that spends a model", () => {
		const tasks = automationWorkTasks({
			ask: "resuma o que mudou no repo hoje",
			direction: "resumo diario",
			automationId: "daily-summary",
		});
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.fn).toBe("respond");
		expect(tasks[0]?.pluginId).toBe("agent");
		expect(tasks[0]?.workClass).toBe("agent");
		// `prompt` BY NAME: the sidecar's extract_task_args requires it, and a task spelling it
		// otherwise would be accepted here and fail at fire time, unattended.
		expect(tasks[0]?.args).toEqual({ prompt: "resuma o que mudou no repo hoje" });
	});

	it("makes a dispatch ordinary computation and keeps its args", () => {
		const tasks = automationWorkTasks({
			dispatch: ["lsp-code-ops:ingest"],
			args: [{ path: "/tmp/x" }],
			direction: "reindex",
			automationId: "reindex",
		});
		expect(tasks[0]?.workClass).toBe("dispatch");
		expect(tasks[0]?.args).toEqual({ path: "/tmp/x" });
	});

	it("honours the node's default responder over the built-in fallback", () => {
		const tasks = automationWorkTasks({
			ask: "oi",
			responder: "my-agent",
			direction: "d",
			automationId: "a",
		});
		expect(tasks[0]?.pluginId).toBe("my-agent");
	});

	it("declares nothing when nothing was asked for", () => {
		expect(automationWorkTasks({ direction: "d", automationId: "a" })).toEqual([]);
	});
});

describe("automationBodyFromWork", () => {
	it("builds a static body carrying the tasks, without the work class", () => {
		const body = automationBodyFromWork({
			ask: "faca X",
			direction: "faz X",
			automationId: "x",
		});
		expect(body?.type).toBe("static");
		const effort = (body as { effort: { tasks: unknown[]; tags: string[] } }).effort;
		expect(effort.tasks).toHaveLength(1);
		// workClass is DERIVED for the reader; persisting it would be a fifth frozen copy of a
		// rule the host owns.
		expect(effort.tasks[0]).not.toHaveProperty("workClass");
		expect(effort.tags).toContain("project-automation");
	});

	it("returns undefined when no work was declared, keeping today's behaviour expressible", () => {
		expect(automationBodyFromWork({ direction: "d", automationId: "a" })).toBeUndefined();
	});
});

describe("bodyWorkClasses", () => {
	it("reads what an already-written body will spend", () => {
		const body = automationBodyFromWork({
			ask: "a",
			dispatch: ["p:ingest"],
			direction: "d",
			automationId: "id",
		});
		expect(bodyWorkClasses(body)).toEqual(["agent", "dispatch"]);
	});

	it("reads a malformed or absent body as spending nothing", () => {
		expect(bodyWorkClasses(undefined)).toEqual([]);
		expect(bodyWorkClasses({ type: "plugin" })).toEqual([]);
		expect(bodyWorkClasses({ type: "static", effort: { tasks: "not-a-list" } })).toEqual([]);
	});
});
