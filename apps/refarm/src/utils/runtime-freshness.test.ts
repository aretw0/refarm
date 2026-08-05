import { describe, expect, it } from "vitest";
import { defaultAgentPluginPath, resolveRuntimeFreshness } from "./runtime-freshness.js";

const STARTED = "2026-08-04T14:20:36Z";
const startedMs = Date.parse(STARTED);
const descriptor = { pid: 768958, startedAt: STARTED, sovereignDir: "/home/op/.refarm" };

/** Both artifacts resolvable, with mtimes the test chooses. */
function deps(binaryMs: number | null, pluginMs: number | null) {
	return {
		realpath: (target: string) => (target.startsWith("/proc/") ? "/opt/refarm/tractor" : target),
		statMtimeMs: (target: string) => (target === "/opt/refarm/tractor" ? binaryMs : pluginMs),
	};
}

const PLUGIN = "/home/op/.refarm/plugins/@refarm/agent/plugin.wasm";

describe("runtime freshness", () => {
	it("reports the real 2026-08-04 case: a daemon nine hours behind its own binary", () => {
		// The measurement that forced this file. The daemon started at 11:20 local and the
		// binary beside it was rebuilt at 20:34, while `refarm check` answered all-clear.
		const result = resolveRuntimeFreshness(
			descriptor,
			PLUGIN,
			deps(Date.parse("2026-08-04T23:34:15Z"), Date.parse("2026-08-04T13:53:46Z")),
		);
		expect(result.state).toBe("stale");
		const binary = result.artifacts.find((a) => a.artifact === "/opt/refarm/tractor");
		expect(binary?.state).toBe("stale");
		expect(binary?.reason).toMatch(/changed after the running node started/);
		// The plugin genuinely was older than the start that day, and must not be dragged
		// into the finding — a report that blames everything is one nobody reads.
		expect(result.artifacts.find((a) => a.artifact === PLUGIN)?.state).toBe("fresh");
	});

	it("is fresh only when every artifact was checked and every one is older", () => {
		const result = resolveRuntimeFreshness(descriptor, PLUGIN, deps(startedMs - 1000, startedMs - 1000));
		expect(result.state).toBe("fresh");
		expect(result.artifacts.every((a) => a.state === "fresh")).toBe(true);
	});

	it("says unknown when the node does not say, instead of passing", () => {
		// A refused descriptor — absent, malformed, unknown wire, or a dead pid — means the
		// node does not say. Answering `fresh` there would be the defect this file removes.
		const result = resolveRuntimeFreshness(null, PLUGIN);
		expect(result.state).toBe("unknown");
		expect(result.artifacts[0].reason).toMatch(/does not say/);
	});

	it("says unknown when startedAt cannot be parsed", () => {
		const result = resolveRuntimeFreshness({ pid: 1, startedAt: "not-a-date" }, PLUGIN);
		expect(result.state).toBe("unknown");
	});

	it("does not let one unreadable artifact be averaged into an all-clear", () => {
		// The whole point of worst-state-wins: a fresh sibling must not vouch for an
		// artifact nobody could read.
		const result = resolveRuntimeFreshness(descriptor, PLUGIN, deps(startedMs - 1000, null));
		expect(result.state).toBe("unknown");
		expect(result.artifacts.filter((a) => a.state === "fresh")).toHaveLength(1);
		expect(result.artifacts.filter((a) => a.state === "unknown")).toHaveLength(1);
	});

	it("says unknown for the binary rather than guessing when the plugin path is missing", () => {
		const result = resolveRuntimeFreshness(descriptor, null, deps(startedMs - 1000, null));
		const plugin = result.artifacts.find((a) => a.artifact === "agent plugin");
		expect(plugin?.state).toBe("unknown");
		expect(plugin?.reason).toMatch(/could not be located/);
	});

	it("derives the agent plugin path from the sovereign dir, and refuses without one", () => {
		expect(defaultAgentPluginPath("/home/op/.refarm")).toBe(PLUGIN);
		expect(defaultAgentPluginPath(undefined)).toBeNull();
	});
});
