import { createWebSourceProvider } from "@refarm.dev/source-web";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRequirementsCapabilityGroup } from "./requirements-capability.js";
import { isCapabilityGroup } from "@refarm.dev/cli/capabilities";

let cacheRoot = "";

function group() {
	return createRequirementsCapabilityGroup({
		sourceProvider: createWebSourceProvider({ cacheRoot }),
	});
}

async function runAction(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
	const g = group();
	if (!isCapabilityGroup(g)) throw new Error("expected a group");
	const action = g.actions[name];
	if (!action) throw new Error(`no action ${name}`);
	return action.run({ args: args as never, options: {}, json: true });
}

const EMPTY_INPUT = { args: {}, options: {}, json: true } as const;

beforeEach(() => {
	cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-req-cache-"));
});

afterEach(() => {
	fs.rmSync(cacheRoot, { recursive: true, force: true });
});

describe("requirements operator verbs (T3)", () => {
	it("declares an agent-tool + http surface (declare-once projection)", () => {
		const g = group();
		if (!isCapabilityGroup(g)) throw new Error("expected a group");
		expect(g.transports?.agent).toEqual({ tool: true, toolName: "requirements_pull" });
		expect(g.transports?.http).toEqual({ method: "POST", path: "/requirements" });
		expect(Object.keys(g.actions)).toEqual(["pull", "status"]);
	});

	it("status reports not-materialized before a pull", async () => {
		const envelope = (await runAction("status")) as {
			ok: boolean;
			status: { materialized: boolean };
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.status.materialized).toBe(false);
	});

	it("pull materializes the fixture snapshot offline (deterministic), then status sees it", async () => {
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

		// status now reflects the materialized snapshot.
		const status = (await runAction("status")) as {
			status: { materialized: boolean };
		};
		expect(status.status.materialized).toBe(true);
	});

	it("a second pull reuses the snapshot (idempotent, deterministic)", async () => {
		await runAction("pull");
		const again = (await runAction("pull")) as { action: string };
		// offline + existing snapshot → noop (no re-materialize).
		expect(again.action).toBe("noop");
	});

	it("the default (no ref) verb is status (read-only) — a bare group never mutates", () => {
		const g = group();
		if (!isCapabilityGroup(g)) throw new Error("expected a group");
		expect(g.defaultAction).toBe("status");
	});

	// The input shape the surface hands run() — args/options/json — is honored.
	it("accepts an explicit ref argument", async () => {
		const g = group();
		if (!isCapabilityGroup(g)) throw new Error("expected a group");
		const status = g.actions.status;
		if (!status) throw new Error("no status action");
		const envelope = (await status.run({
			...EMPTY_INPUT,
			args: { ref: "web:requirements-fixture" },
		})) as unknown as { ref: string };
		expect(envelope.ref).toBe("web:requirements-fixture");
	});
});
