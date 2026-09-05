import { describe, expect, it, vi } from "vitest";

/**
 * `agent doctor` became `agent probe` (ISS-104, decided 2026-08-23), and this pins the part a
 * rename can silently get wrong: the old word must keep ANSWERING, and both words must reach the
 * same command.
 *
 * WHY THE RENAME. Both readings of the old name were defensible — a read, with the dispatch behind
 * a flag; or a dispatch, with the name at fault. Measuring the first killed it: a cheap
 * `agent doctor` would say nothing `refarm check`, `refarm doctor` and `refarm model doctor` do not
 * already say, so the dispatch is this command's only reason to exist. The dispatch stays; the word
 * moves, because every other `doctor` in this CLI is a read and one that spends teaches an operator
 * to distrust the family.
 *
 * `probeAgentLiveness` is mocked because the real one SUBMITS A RESPOND to the live runtime. A test
 * must never do that — and that is the whole reason this command needed a truthful name.
 */
vi.mock("../../src/commands/agent-liveness.js", () => ({ probeAgentLiveness: vi.fn() }));

import { probeAgentLiveness } from "../../src/commands/agent-liveness.js";
import { createAgentCommand } from "../../src/commands/agent.js";

async function run(argv: string[]): Promise<{ stdout: string; stderr: string }> {
	vi.mocked(probeAgentLiveness).mockResolvedValue({
		status: "responsive",
		message: "the agent completed a respond",
		nextAction: "nothing",
		elapsedMs: 1,
	} as Awaited<ReturnType<typeof probeAgentLiveness>>);
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	await createAgentCommand().parseAsync(argv, { from: "user" });
	const stdout = log.mock.calls.map((c) => String(c[0])).join("\n");
	const stderr = err.mock.calls.map((c) => String(c[0])).join("");
	log.mockRestore();
	err.mockRestore();
	return { stdout, stderr };
}

describe("agent probe, and the word it replaced", () => {
	it("probe --json answers under its own operation name", async () => {
		const { stdout } = await run(["probe", "--json"]);
		expect(JSON.parse(stdout).operation).toBe("probe");
	});

	it("still says it spends BEFORE it spends, which no rename may drop", async () => {
		const { stderr } = await run(["probe"]);
		expect(stderr).toContain("dispatches a real prompt");
	});

	it("doctor still answers, reaching the same command", async () => {
		// Nothing in this repository invokes `agent doctor` — measured — but an operator's finger
		// and a machine outside this tree are not searchable. A rename that silently stops
		// answering is a worse trade than a word that lingers with a notice.
		const { stdout } = await run(["doctor", "--json"]);
		expect(JSON.parse(stdout).operation).toBe("probe");
	});

	it("doctor says the word moved, and why", async () => {
		const { stderr } = await run(["doctor", "--json"]);
		expect(stderr).toContain("now `agent probe`");
	});

	it("carries --timeout through the old name, so a scripted invocation keeps its argument", async () => {
		// The delegation passes the deprecated command's argv on. An option consumed by the alias
		// and not forwarded would change behaviour silently, which is the one thing a compatibility
		// shim must not do.
		await run(["doctor", "--timeout", "1234", "--json"]);
		expect(vi.mocked(probeAgentLiveness)).toHaveBeenCalledWith({ timeoutMs: 1234 });
	});
});
