import { describe, expect, it } from "vitest";
import { createRuntimeAgentRespondEffort } from "./runtime-agent-effort.js";

const BASE = {
	prompt: "p",
	system: "s",
	sessionId: "urn:sovereign:session:v1:abc",
	source: "refarm-ask" as const,
	historyTurns: 10,
	now: () => new Date("2026-08-05T00:00:00.000Z"),
	randomUUID: () => "fixed-uuid",
};

describe("createRuntimeAgentRespondEffort workspace attribution", () => {
	it("omits every workspace key when none is declared", () => {
		const effort = createRuntimeAgentRespondEffort(BASE);
		expect("workspaceId" in effort).toBe(false);
		const args = effort.tasks[0]!.args as unknown as Record<string, unknown> | null | undefined;
		expect(args != null ? "workspace_id" in args : false).toBe(false);
		expect(args != null ? "workspace_source" in args : false).toBe(false);
	});

	it("carries the id at the root for the observation and in args for the session", () => {
		const effort = createRuntimeAgentRespondEffort({
			...BASE,
			workspaceId: "rcdc5",
			workspaceSource: "declared",
		});
		expect((effort as unknown as Record<string, unknown>).workspaceId).toBe("rcdc5");
		const args = effort.tasks[0]!.args as unknown as Record<string, unknown> | null | undefined;
		expect(args != null ? args.workspace_id : undefined).toBe("rcdc5");
		expect(args != null ? args.workspace_source : undefined).toBe("declared");
	});

	it("records a seed as a seed", () => {
		const effort = createRuntimeAgentRespondEffort({
			...BASE,
			workspaceId: "refarm",
			workspaceSource: "seeded-from-cwd",
		});
		const args = effort.tasks[0]!.args as unknown as Record<string, unknown> | null | undefined;
		expect(args != null ? args.workspace_source : undefined).toBe("seeded-from-cwd");
	});

	it("a whitespace-only id is no declaration at all", () => {
		const effort = createRuntimeAgentRespondEffort({ ...BASE, workspaceId: "   " });
		expect("workspaceId" in effort).toBe(false);
		const args = effort.tasks[0]!.args as unknown as Record<string, unknown> | null | undefined;
		expect(args != null ? "workspace_id" in args : false).toBe(false);
	});
});
