import { describe, expect, it, vi } from "vitest";

import { createPlaybookRunCapability } from "./capability.js";
import type { DispatchStep } from "./types.js";

const PLAYBOOK = {
	name: "scrape",
	steps: [
		{ verb: "source:pull", with: { ref: "{{ input.ref }}" }, saveAs: "pulled" },
		{ verb: "records:store", with: { records: "{{ pulled.records }}" }, saveAs: "stored" },
	],
};

/** A dispatch that routes by "<pluginId>:<verb>" to a canned result. */
function routeDispatch(
	routes: Record<string, (args: Record<string, unknown>) => unknown>,
): DispatchStep {
	return async ({ pluginId, verb, args }) => {
		const route = routes[`${pluginId}:${verb}`];
		if (!route) throw new Error(`no route for ${pluginId}:${verb}`);
		return route(args);
	};
}

function runInput(playbook: string, options: Record<string, unknown> = {}) {
	return { args: { playbook }, options, json: true } as never;
}

describe("createPlaybookRunCapability — playbook:run", () => {
	it("is surfaced as an agent tool (transports.agent.tool)", () => {
		const cap = createPlaybookRunCapability({
			dispatch: async () => null,
			loadPlaybook: () => null,
		});
		expect(cap.transports?.agent).toMatchObject({ tool: true, toolName: "playbook_run" });
		expect(cap.name).toBe("playbook-run");
	});

	it("loads, runs, and reports steps + bindings on success", async () => {
		const records = [{ id: "r1" }];
		const dispatch = routeDispatch({
			"source:pull": (args) => {
				expect(args.ref).toBe("web:efd");
				return { records };
			},
			"records:store": (args) => ({ count: (args.records as unknown[]).length }),
		});
		const loadPlaybook = vi.fn(() => PLAYBOOK);
		const cap = createPlaybookRunCapability({ dispatch, loadPlaybook });

		const env = (await cap.run(runInput("scrape", { input: '{"ref":"web:efd"}' }))) as unknown as {
			ok: boolean;
			playbook: string;
			steps: Array<{ ok: boolean }>;
			bindings: Record<string, unknown>;
		};

		expect(loadPlaybook).toHaveBeenCalledWith("scrape");
		expect(env.ok).toBe(true);
		expect(env.playbook).toBe("scrape");
		expect(env.steps.map((s) => s.ok)).toEqual([true, true]);
		expect(env.bindings.stored).toEqual({ count: 1 });
	});

	it("accepts input as an already-parsed object too", async () => {
		const dispatch = routeDispatch({
			"source:pull": (args) => ({ got: args.ref }),
			"records:store": () => ({}),
		});
		const cap = createPlaybookRunCapability({ dispatch, loadPlaybook: () => PLAYBOOK });
		const env = (await cap.run(runInput("scrape", { input: { ref: "web:xyz" } }))) as unknown as {
			bindings: { pulled: { got: string } };
		};
		expect(env.bindings.pulled.got).toBe("web:xyz");
	});

	it("errors helpfully with no playbook ref", async () => {
		const cap = createPlaybookRunCapability({
			dispatch: async () => null,
			loadPlaybook: () => PLAYBOOK,
		});
		const env = (await cap.run(runInput(""))) as unknown as { ok: boolean; error: string };
		expect(env.ok).toBe(false);
		expect(env.error).toBe("no_playbook");
	});

	it("errors when the playbook is not found", async () => {
		const cap = createPlaybookRunCapability({
			dispatch: async () => null,
			loadPlaybook: () => null,
		});
		const env = (await cap.run(runInput("missing"))) as unknown as { ok: boolean; error: string };
		expect(env.ok).toBe(false);
		expect(env.error).toBe("not_found");
	});

	it("errors with structured issues when the playbook is invalid", async () => {
		const cap = createPlaybookRunCapability({
			dispatch: async () => null,
			loadPlaybook: () => ({ steps: [{ verb: "nocolon" }] }), // missing name + bad verb
		});
		const env = (await cap.run(runInput("bad"))) as unknown as {
			ok: boolean;
			error: string;
			message: string;
		};
		expect(env.ok).toBe(false);
		expect(env.error).toBe("invalid_playbook");
		expect(env.message).toMatch(/name|verb/);
	});

	it("reports a failed run (a step threw) with error + which step", async () => {
		const dispatch = routeDispatch({
			"source:pull": () => {
				throw new Error("session expired");
			},
		});
		const cap = createPlaybookRunCapability({ dispatch, loadPlaybook: () => PLAYBOOK });
		const env = (await cap.run(runInput("scrape"))) as unknown as {
			ok: boolean;
			error: string;
			message: string;
			steps: Array<{ ok: boolean }>;
		};
		expect(env.ok).toBe(false);
		expect(env.error).toBe("playbook_failed");
		expect(env.message).toMatch(/source:pull.*session expired/);
		expect(env.steps.map((s) => s.ok)).toEqual([false, false]); // 2nd skipped
	});

	it("continue-on-error runs later steps despite a failure", async () => {
		let storeCalled = false;
		const dispatch = routeDispatch({
			"source:pull": () => {
				throw new Error("x");
			},
			"records:store": () => {
				storeCalled = true;
				return {};
			},
		});
		const cap = createPlaybookRunCapability({ dispatch, loadPlaybook: () => PLAYBOOK });
		await cap.run(runInput("scrape", { "continue-on-error": true }));
		expect(storeCalled).toBe(true);
	});
});
