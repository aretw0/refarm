import type { OperatorChannel, OperatorPrompt } from "@refarm.dev/prompt-contract-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	autoStartRuntime,
	type AutostartVocabulary,
	type AutostartWaitOutcome,
	type AutoStartRuntimeDeps,
} from "./autostart.js";
import type { LaunchRuntimeEngine } from "./launcher.js";

/** A vocabulary whose command strings are recognisable in the captured output. */
const VOCAB: AutostartVocabulary = {
	ensureCommand: "refarm check",
	startCommand: "refarm runtime start",
	doctorNextActionCommand: "refarm doctor --next-action",
	doctorCommand: "refarm doctor",
	engineLabel: (engine: LaunchRuntimeEngine) => (engine === "rust" ? "Rust Tractor" : "TS Farmhand"),
};

/** An operator that always confirms — so the machine proceeds to spawn + wait. */
const yesOperator: OperatorChannel = {
	ask: (async (_prompt: OperatorPrompt) => true) as OperatorChannel["ask"],
};

function baseDeps(outcome: AutostartWaitOutcome): AutoStartRuntimeDeps {
	return {
		operator: yesOperator,
		mode: "always", // skip the confirm branch; go straight to spawn + wait
		spawnRuntime: vi.fn(),
		probeRuntimeUntilReady: async () => outcome.ready,
		probeRuntimeUntilOutcome: async () => outcome,
		resolveRuntime: () => ({ activeEngine: "rust", reason: "auto-rust-available" }),
	};
}

describe("autoStartRuntime honest narration", () => {
	let out = "";
	let err = "";

	beforeEach(() => {
		out = "";
		err = "";
		vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
			out += String(chunk);
			return true;
		});
		vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
			err += String(chunk);
			return true;
		});
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			err += args.join(" ") + "\n";
		});
	});
	afterEach(() => vi.restoreAllMocks());

	it("reports ✓ Ready and returns true when the daemon becomes ready", async () => {
		const ok = await autoStartRuntime("/repo", VOCAB, baseDeps({ ready: true, status: "ready" }));
		expect(ok).toBe(true);
		expect(out).toContain("✓ Ready");
	});

	it("reports 'Still starting' (not a failure) when the wait times out but the daemon is alive", async () => {
		const ok = await autoStartRuntime(
			"/repo",
			VOCAB,
			baseDeps({ ready: false, status: "timed-out-alive" }),
		);
		expect(ok).toBe(false);
		expect(out).toContain("Still starting");
		// The scary "Failed to start" must NOT appear for a live-but-slow boot.
		expect(out).not.toContain("Failed to start");
	});

	it("reports '✗ Failed to start' when the daemon never came up (dead)", async () => {
		const ok = await autoStartRuntime(
			"/repo",
			VOCAB,
			baseDeps({ ready: false, status: "timed-out-dead" }),
		);
		expect(ok).toBe(false);
		expect(out).toContain("Failed to start");
		expect(err).toContain("refarm doctor");
	});

	it("falls back to the boolean probe when no outcome probe is injected", async () => {
		const deps = baseDeps({ ready: false, status: "timed-out-dead" });
		deps.probeRuntimeUntilOutcome = undefined; // only the boolean form available
		deps.probeRuntimeUntilReady = async () => false;
		const ok = await autoStartRuntime("/repo", VOCAB, deps);
		expect(ok).toBe(false);
		// Without liveness info, a non-ready boolean is treated as still-starting (alive),
		// the safer default — never a false "failed".
		expect(out).toContain("Still starting");
	});
});
