import { describe, expect, it, vi } from "vitest";

/**
 * `refarm agent doctor --json` — pinning the `ok` RULING, not just the shape.
 *
 * The refusal-conformance harness caught this command printing `ok:false` with exit 0: an
 * envelope and an exit code that contradicted each other. There were two honest ways to
 * make them agree, and which one is right is a judgement about what the command IS.
 *
 * `agent doctor` is a probe. Its outcome vocabulary (`AgentLivenessStatus`) names
 * `unresponsive`, `no-agent` and `runtime-unreachable` as verdicts it REACHES — not as
 * failures to reach one. It always completes and always classifies, so it always did its
 * job: `ok: true`, exit 0, and the verdict in `status`. The narrow "is the agent alive"
 * gate a script wants is `status === "responsive"` (mirrored as `responsive`), one field
 * that means one thing.
 *
 * `probeAgentLiveness` is mocked because the real one SUBMITS A RESPOND to the live
 * runtime. A test must never do that.
 */
vi.mock("../../src/commands/agent-liveness.js", () => ({
	probeAgentLiveness: vi.fn(),
}));

import { createAgentCommand } from "../../src/commands/agent.js";
import { probeAgentLiveness } from "../../src/commands/agent-liveness.js";

interface DoctorEnvelope {
	ok: boolean;
	command: string;
	operation: string;
	status: string;
	responsive: boolean;
	message: string;
	nextAction: string | null;
}

async function runDoctor(result: {
	status: string;
	message: string;
	nextAction: string;
	elapsedMs?: number;
}): Promise<{ envelope: DoctorEnvelope; exitCode: number | string | undefined }> {
	vi.mocked(probeAgentLiveness).mockResolvedValue(
		result as Awaited<ReturnType<typeof probeAgentLiveness>>,
	);
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	process.exitCode = undefined;
	await createAgentCommand().parseAsync(["doctor", "--json"], { from: "user" });
	const envelope = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as DoctorEnvelope;
	const exitCode = process.exitCode;
	process.exitCode = undefined;
	logSpy.mockRestore();
	return { envelope, exitCode };
}

describe("refarm agent doctor — `ok` reports the probe, `status` reports the agent", () => {
	it("a responsive agent: ok true, exit 0", async () => {
		const { envelope, exitCode } = await runDoctor({
			status: "responsive",
			message: "responsive (12ms)",
			nextAction: 'The agent is ready — run `refarm ask "…"`.',
			elapsedMs: 12,
		});

		expect(envelope.ok).toBe(true);
		expect(envelope.status).toBe("responsive");
		expect(envelope.responsive).toBe(true);
		expect(exitCode).toBeUndefined();
	});

	it("a ZOMBIE agent: the probe still did its job — ok true, exit 0, verdict in status", async () => {
		const { envelope, exitCode } = await runDoctor({
			status: "unresponsive",
			message: "UNRESPONSIVE — the agent received the request but produced no response",
			nextAction: "Restart the runtime cleanly.",
		});

		expect(envelope.ok).toBe(true);
		expect(envelope.status).toBe("unresponsive");
		// The field a gate should read, so `ok` never has to carry two meanings.
		expect(envelope.responsive).toBe(false);
		expect(envelope.nextAction).toContain("Restart the runtime");
		expect(exitCode).toBeUndefined();
	});

	it("an unreachable runtime is also a verdict, not a crash — ok true, exit 0", async () => {
		const { envelope, exitCode } = await runDoctor({
			status: "runtime-unreachable",
			message: "could not submit the probe to the runtime",
			nextAction: "Is the runtime up? Run `refarm runtime status`.",
		});

		expect(envelope.ok).toBe(true);
		expect(envelope.status).toBe("runtime-unreachable");
		expect(envelope.responsive).toBe(false);
		expect(exitCode).toBeUndefined();
	});
});
