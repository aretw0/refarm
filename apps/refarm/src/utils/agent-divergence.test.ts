import { describe, expect, it } from "vitest";

import { agentDivergence, describeAgentDivergence } from "./agent-divergence.js";

/**
 * MEASURED 2026-08-19, after this node moved onto an installed CLI: WHICH agent runs depends on
 * how the node happened to be started.
 *
 *   scripts/tractor-start.sh  prefers the REPO build (.cache/…/agent.wasm)
 *   the installed CLI         uses  ~/.refarm/plugins/refarm_agent/plugin.wasm
 *
 * Today the two are byte-identical, so nothing diverges. The moment someone rebuilds the agent in
 * the repository without `plugin install`, they stop being — and the node reports "fresh", because
 * `resolveRuntimeFreshness` compares the LOADED file's mtime against the node's start time. It
 * catches "you rebuilt after starting". It cannot see a second candidate it never looks at.
 *
 * This is the 2026-08-05 defect's sibling: there, a watcher pointed at one path while the daemon
 * ran another. Here, both paths are real and nothing compares them.
 */
const digestOf = (map: Record<string, string>) => (file: string) => map[file] ?? null;

const REPO = "/repo/.cache/cargo-target/wasm32-wasip1/release/agent.wasm";
const INSTALLED = "/home/op/.refarm/plugins/refarm_agent/plugin.wasm";

describe("agentDivergence", () => {
	it("says AGREE when both candidates are the same build", () => {
		// Measured on the operator's node the day this was written: identical digests, so the
		// question is real and the answer is currently benign.
		const verdict = agentDivergence(INSTALLED, [REPO, INSTALLED], digestOf({ [REPO]: "aa", [INSTALLED]: "aa" }));
		expect(verdict).toMatchObject({ state: "agree" });
	});

	it("says DIVERGED, and names which one is loaded", () => {
		// The operator has to know which of the two is running, not merely that they differ.
		const verdict = agentDivergence(INSTALLED, [REPO, INSTALLED], digestOf({ [REPO]: "bb", [INSTALLED]: "aa" }));
		expect(verdict).toMatchObject({ state: "diverged", loaded: INSTALLED });
		expect("others" in verdict && verdict.others).toEqual([REPO]);
	});

	it("says nothing when only one candidate exists", () => {
		// A node with no repository beside it has nothing to diverge from, and a finding there
		// would fire on every installed node forever.
		expect(agentDivergence(INSTALLED, [INSTALLED], digestOf({ [INSTALLED]: "aa" })).state).toBe("single");
	});

	it("treats a candidate it cannot read as one that is not there", () => {
		// `digestOf` returns null for both "absent" and "unreadable", and this asserts the
		// conflation deliberately rather than pretending it is not there. Absent is the common
		// case by far — an installed node with no repository beside it — and a build that cannot
		// be read is also one nothing can start from, so the two lead to the same place. Making
		// the distinction would cost every caller a richer return for a case neither can act on.
		expect(agentDivergence(INSTALLED, [REPO, INSTALLED], digestOf({ [INSTALLED]: "aa" })).state).toBe("single");
	});

	it("says UNKNOWN when the node does not say which one it loaded", () => {
		expect(agentDivergence(null, [REPO, INSTALLED], digestOf({ [REPO]: "aa", [INSTALLED]: "bb" })).state).toBe(
			"unknown",
		);
	});
});

describe("describeAgentDivergence", () => {
	it("says nothing when they agree or there is only one", () => {
		expect(describeAgentDivergence({ state: "agree", loaded: INSTALLED, others: [] })).toBeNull();
		expect(describeAgentDivergence({ state: "single", loaded: INSTALLED, others: [] })).toBeNull();
	});

	it("names both paths, because the repair depends on which one is wanted", () => {
		const text = describeAgentDivergence({ state: "diverged", loaded: INSTALLED, others: [REPO] });
		expect(text).toContain(INSTALLED);
		expect(text).toContain(REPO);
	});

	it("does not tell the operator which build is CORRECT", () => {
		// Running a freshly built agent is a legitimate development choice, and running the
		// installed one is a legitimate operational choice. The node reports the fork; it does not
		// take a side.
		const text = describeAgentDivergence({ state: "diverged", loaded: INSTALLED, others: [REPO] });
		expect(text).not.toMatch(/should|must|wrong|stale/iu);
	});
});
