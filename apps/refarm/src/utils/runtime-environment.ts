// Was the running node started with the environment it needs, or bare?
//
// Written after breaking this operator's node on 2026-08-05. The daemon was restarted by hand
// with a plain command line — no `.refarm/.env`, no `MODEL_PROVIDER`, and none of the credentials
// `refarm model env --shell --include-secrets` materialises out of the sovereign vault. The node
// came up, answered `/efforts/in-flight`, reported healthy, and `refarm doctor` said nothing.
//
// It failed at FIRST USE, several minutes later, with
// `[blocked: model-bridge provider mismatch: requested 'openai-codex', expected 'ollama']` — a
// message that describes the symptom and not the cause. The node had silently fallen to the
// keyless local floor because that is what a daemon with no model environment resolves to.
//
// `scripts/tractor-start.sh` does all of this correctly. The gap is not that the right way is
// missing; it is that the wrong way is INDISTINGUISHABLE from the right way until work fails. A
// scheduled restart — which this repository is actively designing — would reproduce it at three in
// the morning, and the failure would land in a log rather than in front of a person.
//
// The technique is the one `runtime-freshness.ts` already uses: the pid the node publishes about
// itself in `node.json`, plus `/proc`. No daemon change, no new endpoint, no protocol.
//
// THREE STATES. `configured` when the running process carries a model provider; `bare` when it
// demonstrably does not while the operator's config declares one; `unknown` when the descriptor is
// refused, the process is gone, `/proc` cannot be read, or the platform does not expose it.
// Reporting `configured` for what is really `unknown` would rebuild the exact defect this file
// exists to catch.

import fs from "node:fs";

export type EnvironmentState = "configured" | "bare" | "unknown";

export interface RuntimeEnvironment {
	state: EnvironmentState;
	/** Why, in one sentence an operator can act on. */
	reason: string;
	/** The `MODEL_*` keys the running process carries, when they could be read. Names only —
	 *  never values, several of which are credentials materialised out of the vault. */
	modelKeys?: string[];
}

interface EnvironmentDeps {
	readEnviron?: (pid: number) => string | null;
}

function defaultReadEnviron(pid: number): string | null {
	try {
		return fs.readFileSync(`/proc/${pid}/environ`, "utf8");
	} catch {
		return null;
	}
}

/** The key whose absence made the node fall to the keyless floor. */
const PROVIDER_KEY = "MODEL_PROVIDER";

/**
 * Compare what the running node carries against what the operator declared.
 *
 * `descriptor` is the parsed `node.json`; pass `null` when the reader refused it. `declaredProvider`
 * is what the sovereign config asks for — `undefined` when the operator declared none, in which
 * case a bare process is not a finding at all, because falling to the local floor is then exactly
 * what was asked for.
 */
export function resolveRuntimeEnvironment(
	descriptor: { pid: number } | null,
	declaredProvider: string | undefined,
	deps?: EnvironmentDeps,
): RuntimeEnvironment {
	if (!descriptor) {
		return {
			state: "unknown",
			reason: "the node does not say which process it is, so its environment cannot be read",
		};
	}
	if (process.platform !== "linux") {
		return {
			state: "unknown",
			reason: "reading a running process's environment is not implemented on this platform",
		};
	}

	const raw = (deps?.readEnviron ?? defaultReadEnviron)(descriptor.pid);
	if (raw === null) {
		return {
			state: "unknown",
			reason: `the running process's environment could not be read from /proc/${descriptor.pid}`,
		};
	}

	// Names only. Several of these hold credentials the start script materialises out of the
	// sovereign vault, and a diagnostic that prints them would be a worse defect than the one it
	// reports.
	const modelKeys = raw
		.split("\0")
		.map((entry) => entry.split("=", 1)[0] ?? "")
		.filter((key) => key.startsWith("MODEL_"))
		.sort();

	if (modelKeys.includes(PROVIDER_KEY)) {
		return {
			state: "configured",
			reason: "the running node carries a model provider in its environment",
			modelKeys,
		};
	}

	if (!declaredProvider) {
		return {
			state: "configured",
			reason:
				"the running node carries no model provider and the config declares none either, " +
				"so the keyless local floor is what was asked for",
			modelKeys,
		};
	}

	return {
		state: "bare",
		reason:
			`the running node carries no ${PROVIDER_KEY} while the config declares ` +
			`"${declaredProvider}", so it has fallen to the keyless local floor and will refuse ` +
			"that provider at first use",
		modelKeys,
	};
}
