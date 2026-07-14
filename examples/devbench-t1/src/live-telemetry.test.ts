import { describe, expect, it } from "vitest";

import { parseAgentTimeline, type AgentEventLine } from "./live-telemetry.js";

/**
 * The reusable core of the observability block — parseAgentTimeline — is pure and runs offline
 * (no daemon), so it is fully covered in CI. The live verb (agent-telemetry) is proven separately
 * in a gated execution test. These lines mirror EXACTLY what the host writes to the audit trail
 * (format_audit_line merges each agent:* event's full payload at top level).
 */

function line(event: string, ts: number, payload: Record<string, unknown>): AgentEventLine {
	return { event, ts, prompt_ref: "urn:sovereign:prompt:demo", ...payload };
}

describe("parseAgentTimeline — project an agent run's timeline from its agent:* events", () => {
	it("projects route, iterations, tool calls, tokens, and the terminal outcome", () => {
		const events: AgentEventLine[] = [
			line("agent:prompt:start", 1, { session_id: "s1" }),
			line("agent:route:selected", 2, { provider: "ollama", model: "llama3", source: "profile:cheap", cost_tier: "low" }),
			line("agent:iteration", 3, { iteration: 0, max: 10 }),
			line("agent:tool:call", 4, { tool: "read_file", args_summary: "{path:...}", ok: true }),
			line("agent:iteration", 5, { iteration: 1, max: 10 }),
			line("agent:tool:call", 6, { tool: "read_file", ok: true }),
			line("agent:response:done", 7, { content_len: 42, tool_calls: 2, tokens_in: 210, tokens_out: 50, duration_ms: 1234 }),
		];
		const t = parseAgentTimeline(events);
		// The ADR-012 route audit — model + why.
		expect(t.route).toEqual({ provider: "ollama", model: "llama3", source: "profile:cheap", cost_tier: "low" });
		// Two iterations reached (0-based indices 0 and 1 → count 2), budget max 10.
		expect(t.iterations).toBe(2);
		expect(t.maxIterations).toBe(10);
		// Both tool calls, in order.
		expect(t.toolCalls.map((c) => c.tool)).toEqual(["read_file", "read_file"]);
		expect(t.toolCalls.every((c) => c.ok)).toBe(true);
		// Real tokens from response:done.
		expect(t.tokensIn).toBe(210);
		expect(t.tokensOut).toBe(50);
		expect(t.durationMs).toBe(1234);
		expect(t.outcome).toBe("done");
		expect(t.promptRef).toBe("urn:sovereign:prompt:demo");
	});

	it("marks a failed tool call and an error outcome", () => {
		const events: AgentEventLine[] = [
			line("agent:iteration", 1, { iteration: 0, max: 5 }),
			line("agent:tool:call", 2, { tool: "read_file", ok: false }),
			line("agent:error", 3, { error: "permission denied" }),
		];
		const t = parseAgentTimeline(events);
		expect(t.toolCalls[0]?.ok).toBe(false);
		expect(t.outcome).toBe("error");
		expect(t.error).toBe("permission denied");
	});

	it("reports a budget-blocked outcome", () => {
		const t = parseAgentTimeline([line("agent:budget:blocked", 1, { provider: "openai" })]);
		expect(t.outcome).toBe("budget_blocked");
	});

	it("filters to ONE run when a promptRef is given (events correlate by prompt_ref, not effortId)", () => {
		const events: AgentEventLine[] = [
			{ event: "agent:iteration", ts: 1, prompt_ref: "run-A", iteration: 0, max: 3 },
			{ event: "agent:iteration", ts: 2, prompt_ref: "run-B", iteration: 0, max: 3 },
			{ event: "agent:tool:call", ts: 3, prompt_ref: "run-A", tool: "grep", ok: true },
		];
		const a = parseAgentTimeline(events, "run-A");
		expect(a.toolCalls.map((c) => c.tool)).toEqual(["grep"]);
		expect(a.promptRef).toBe("run-A");
		// run-B's iteration is excluded from run-A's timeline.
		expect(a.sequence).toEqual(["agent:iteration", "agent:tool:call"]);
	});

	it("orders by ts and tolerates an empty trail", () => {
		expect(parseAgentTimeline([]).outcome).toBe("unknown");
		const out = parseAgentTimeline([
			line("agent:response:done", 9, { tokens_in: 1, tokens_out: 2 }),
			line("agent:iteration", 1, { iteration: 0, max: 2 }),
		]);
		// Sorted by ts → iteration is processed before response:done regardless of input order.
		expect(out.sequence).toEqual(["agent:iteration", "agent:response:done"]);
		expect(out.outcome).toBe("done");
	});
});
