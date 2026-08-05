import { describe, expect, it } from "vitest";
import { defaultAgentPluginPath, resolveRuntimeFreshness } from "./runtime-freshness.js";

const STARTED = "2026-08-04T14:20:36Z";
const startedMs = Date.parse(STARTED);
const descriptor = { pid: 768958, startedAt: STARTED, sovereignDir: "/home/op/.refarm" };

/** Both artifacts resolvable, with mtimes the test chooses. */
function deps(binaryMs: number | null, pluginMs: number | null) {
	return {
		readlink: (target: string) => (target.startsWith("/proc/") ? "/opt/refarm/tractor" : null),
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
		expect(result.artifacts[0]?.reason).toMatch(/does not say/);
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

describe("a running image that no longer exists", () => {
	it("is stale with certainty, not unknown — the case that actually happened", () => {
		// Verified on the operator's machine 2026-08-04: cargo replaced the daemon's binary,
		// so /proc/<pid>/exe read "<path> (deleted)". An earlier draft called that "could not
		// check", which is backwards: a process executing an image nobody can inspect is the
		// strongest evidence of staleness available, and no timestamp is needed to say so.
		const result = resolveRuntimeFreshness(descriptor, PLUGIN, {
			readlink: () => "/home/op/refarm/.cache/cargo-target/release/tractor (deleted)",
			statMtimeMs: () => startedMs - 1000,
		});
		expect(result.state).toBe("stale");
		const binary = result.artifacts[0];
		expect(binary?.state).toBe("stale");
		expect(binary?.artifact).toBe("/home/op/refarm/.cache/cargo-target/release/tractor");
		expect(binary?.artifact).not.toMatch(/deleted/);
		expect(binary?.reason).toMatch(/no longer exists on disk/);
	});

	it("falls back to what the process itself says when the link is unreadable", () => {
		// argv[0] is a fact the process published, not a guess about it.
		const result = resolveRuntimeFreshness(descriptor, PLUGIN, {
			readlink: () => null,
			readArgv0: () => "/opt/refarm/tractor",
			statMtimeMs: (t: string) => (t === "/opt/refarm/tractor" ? startedMs + 1000 : startedMs - 1000),
		});
		expect(result.state).toBe("stale");
		expect(result.artifacts[0]?.artifact).toBe("/opt/refarm/tractor");
	});

	it("stays unknown when neither the link nor argv[0] can be read", () => {
		const result = resolveRuntimeFreshness(descriptor, PLUGIN, {
			readlink: () => null,
			readArgv0: () => null,
			statMtimeMs: () => startedMs - 1000,
		});
		expect(result.state).toBe("unknown");
		expect(result.artifacts[0]?.state).toBe("unknown");
	});
});

describe("the rate catalog the host reads at boot", () => {
	it("is reported when it was written after the node started — the 2026-08-04 minute", () => {
		// The daemon started 01:49Z and the materialiser wrote the catalog at 01:50Z, so the
		// node priced from no catalog while a correct one sat beside it. Watching only the
		// binary and the plugin missed it entirely.
		const result = resolveRuntimeFreshness(
			descriptor,
			PLUGIN,
			{
				readlink: () => "/opt/refarm/tractor",
				statMtimeMs: (t: string) => (t === "/cat/model-rates.v1.json" ? startedMs + 60_000 : startedMs - 1000),
			},
			"/cat/model-rates.v1.json",
		);
		expect(result.state).toBe("stale");
		expect(result.artifacts.find((a) => a.artifact === "/cat/model-rates.v1.json")?.state).toBe("stale");
	});

	it("is silent when absent, because a node with no catalog is a supported state", () => {
		// The guest falls back to its built-in table. Reporting that as a finding would cry
		// wolf on every zero-config install.
		const result = resolveRuntimeFreshness(
			descriptor,
			PLUGIN,
			{ readlink: () => "/opt/refarm/tractor", statMtimeMs: (t: string) => (t.includes("model-rates") ? null : startedMs - 1000) },
			"/cat/model-rates.v1.json",
		);
		expect(result.state).toBe("fresh");
		expect(result.artifacts.some((a) => a.artifact.includes("model-rates"))).toBe(false);
	});

	it("is silent when older than the node, because the node loaded it", () => {
		const result = resolveRuntimeFreshness(
			descriptor,
			PLUGIN,
			{ readlink: () => "/opt/refarm/tractor", statMtimeMs: () => startedMs - 1000 },
			"/cat/model-rates.v1.json",
		);
		expect(result.state).toBe("fresh");
	});
});
