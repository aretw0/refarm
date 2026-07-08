import { createWebSourceProvider } from "@refarm.dev/source-web";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isCapabilityGroup } from "@refarm.dev/cli/capabilities";
import { createSourceCapabilityGroup } from "./source-capability.js";

let cacheRoot = "";

// A source ref the web provider replays offline from its built-in fixture — the
// verb is neutral, the ref is just an argument the caller supplies.
const REF = "web:requirements-fixture";

function group() {
	return createSourceCapabilityGroup({
		sourceProvider: createWebSourceProvider({ cacheRoot }),
	});
}

async function runAction(
	name: string,
	args: Record<string, unknown> = { ref: REF },
): Promise<unknown> {
	const g = group();
	if (!isCapabilityGroup(g)) throw new Error("expected a group");
	const action = g.actions[name];
	if (!action) throw new Error(`no action ${name}`);
	return action.run({ args: args as never, options: {}, json: true });
}

beforeEach(() => {
	cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capability-source-cache-"));
});

afterEach(() => {
	fs.rmSync(cacheRoot, { recursive: true, force: true });
});

describe("source operator verbs (generic source:v1)", () => {
	it("declares an agent-tool + http surface (declare-once projection)", () => {
		const g = group();
		if (!isCapabilityGroup(g)) throw new Error("expected a group");
		expect(g.transports?.agent).toEqual({ tool: true, toolName: "source_pull" });
		expect(g.transports?.http).toEqual({ method: "POST", path: "/source" });
		expect(Object.keys(g.actions)).toEqual(["discover", "pull", "status"]);
	});

	it("discover lists the sources the provider offers (the step before pull)", async () => {
		const envelope = (await runAction("discover")) as {
			ok: boolean;
			count: number;
			sources: Array<{ ref: string; label: string }>;
		};
		expect(envelope.ok).toBe(true);
		// The web provider advertises its fixture(s) as `web:<identity>` refs.
		expect(envelope.count).toBeGreaterThan(0);
		expect(envelope.sources[0]?.ref.startsWith("web:")).toBe(true);
		expect(envelope.sources[0]?.label).toBeTruthy();
	});

	it("status reports not-materialized before a pull", async () => {
		const envelope = (await runAction("status")) as {
			ok: boolean;
			status: { materialized: boolean };
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.status.materialized).toBe(false);
	});

	it("pull materializes the snapshot offline (deterministic), then status sees it", async () => {
		const pulled = (await runAction("pull")) as {
			ok: boolean;
			action: string;
			offline: boolean;
			provenance: { offlineReplay: boolean; hash: string } | null;
			location: { path: string };
		};
		expect(pulled.ok).toBe(true);
		expect(pulled.offline).toBe(true); // default is offline replay — no egress
		expect(pulled.action).toBe("cloned"); // first materialize
		expect(pulled.provenance?.offlineReplay).toBe(true);
		expect(pulled.provenance?.hash).toBeTruthy();

		// The snapshot actually landed under the cache root.
		expect(fs.existsSync(path.join(pulled.location.path, "snapshot.json"))).toBe(true);

		const status = (await runAction("status")) as {
			status: { materialized: boolean };
		};
		expect(status.status.materialized).toBe(true);
	});

	it("a second pull reuses the snapshot (idempotent, deterministic)", async () => {
		await runAction("pull");
		const again = (await runAction("pull")) as { action: string };
		expect(again.action).toBe("noop"); // offline + existing snapshot → noop
	});

	it("the default (bare) verb is discover (read-only) — never mutates", () => {
		const g = group();
		if (!isCapabilityGroup(g)) throw new Error("expected a group");
		expect(g.defaultAction).toBe("discover");
	});

	it("the ref is a required argument (the caller supplies it; there is no default)", () => {
		const g = group();
		if (!isCapabilityGroup(g)) throw new Error("expected a group");
		const pull = g.actions.pull;
		expect(pull?.args?.[0]).toEqual({ name: "ref", required: true });
	});
});
