/**
 * TWO AGENT BUILDS, AND NOTHING COMPARING THEM.
 *
 * MEASURED 2026-08-19, after this node moved onto an installed CLI: WHICH agent runs depends on
 * how the node happened to be started.
 *
 *   scripts/tractor-start.sh  prefers the REPO build (.cache/…/wasm32-wasip1/release/agent.wasm)
 *   the installed CLI         uses  ~/.refarm/plugins/refarm_agent/plugin.wasm
 *
 * Both are legitimate. Running a freshly built agent is how development works; running the
 * installed one is how an operator's node works. The defect is that nothing SAYS which of the two
 * is in the process — the same shape as the node executing the working tree, one level down.
 *
 * `resolveRuntimeFreshness` does not cover it. It compares the LOADED file's mtime against the
 * node's start time, so it catches "you rebuilt after starting" and cannot see a second candidate
 * it never looks at. This is the 2026-08-05 defect's sibling: there a watcher pointed at one path
 * while the daemon ran another; here both paths are real and nothing compares them.
 *
 * IT TAKES NO SIDE. Which build an operator wants is their decision; the node's job is to make the
 * fork visible instead of leaving it to be discovered by behaviour nobody can explain.
 */

export interface AgentDivergence {
	readonly state: "agree" | "diverged" | "single" | "unknown";
	/** The artifact the running node actually loaded, when it says. */
	readonly loaded: string | null;
	/** Candidates that exist and differ from the loaded one. */
	readonly others: readonly string[];
}

/**
 * PURE. Compare every agent artifact this machine holds against the one the node loaded.
 *
 * `digestOf` returns `null` for an artifact that is absent OR unreadable, and the conflation is
 * deliberate: absent is the common case — an installed node with no repository beside it — and a
 * build that cannot be read is also one nothing can start from, so the two lead to the same
 * place. Distinguishing them would cost every caller a richer return for a case neither can act on.
 */
export function agentDivergence(
	loaded: string | null,
	candidates: readonly string[],
	digestOf: (file: string) => string | null,
): AgentDivergence {
	if (!loaded) {
		return {
			state: "unknown",
			loaded: null,
			others: [],
		};
	}
	const present = candidates.filter((candidate) => digestOf(candidate) !== null);
	// A node with no repository beside it has nothing to diverge from. A finding there would fire
	// on every installed node forever, which is how findings stop being read.
	if (present.length <= 1) return { state: "single", loaded, others: [] };
	if (present.length !== candidates.length) return { state: "unknown", loaded, others: [] };

	const loadedDigest = digestOf(loaded);
	if (loadedDigest === null) return { state: "unknown", loaded, others: [] };
	const others = candidates.filter(
		(candidate) => candidate !== loaded && digestOf(candidate) !== loadedDigest,
	);
	return others.length === 0
		? { state: "agree", loaded, others: [] }
		: { state: "diverged", loaded, others };
}

/** PURE. The fact, for a fork worth seeing. Takes no side and names no CLI verb. */
export function describeAgentDivergence(divergence: AgentDivergence): string | null {
	if (divergence.state !== "diverged") return null;
	return (
		`this node is running the agent at ${divergence.loaded}, and a different build exists at ` +
		`${divergence.others.join(", ")}. Which one runs depends on how the node was started — the ` +
		"repository's start script prefers its own build, an installed node uses the installed one."
	);
}

/**
 * The doctor's view: which agent artifacts this machine holds, and which the node loaded.
 *
 * NEVER THROWS. A divergence report that breaks `doctor` costs the operator every other finding
 * in the run to say something about one plugin.
 */
export function readAgentDivergence(deps: {
	readonly pid: number | null;
	readonly repoRoot: string | null;
	readonly installedAgent: string;
	readonly loadedPluginOf: (pid: number) => { path?: string } | null;
	readonly digestOf: (file: string) => string | null;
}): AgentDivergence {
	try {
		const loaded = deps.pid === null ? null : (deps.loadedPluginOf(deps.pid)?.path ?? null);
		const candidates = [deps.installedAgent];
		if (deps.repoRoot) {
			candidates.push(
				`${deps.repoRoot}/.cache/cargo-target/wasm32-wasip1/release/agent.wasm`,
			);
		}
		// The loaded artifact is a candidate by definition, even when it is neither of the two
		// this function knows how to name — a node started by hand with `--plugin` elsewhere is
		// still running something, and pretending otherwise would report `single` about a fork.
		if (loaded && !candidates.includes(loaded)) candidates.push(loaded);
		return agentDivergence(loaded, candidates, deps.digestOf);
	} catch {
		return { state: "unknown", loaded: null, others: [] };
	}
}
