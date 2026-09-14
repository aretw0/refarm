import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSovereignConfig } from "./sovereign-config.js";

describe("resolveSovereignConfig", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), "sovereign-config-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	// XDG_DATA_HOME alone does NOT isolate this seam, and every test here assumed it
	// did until 2026-08-04. `openTractorGraph` prefers the RUNTIME sidecar over the
	// local db, so on a machine with the daemon up these tests read the real
	// replicated RefarmConfig node over HTTP and an empty XDG dir proves nothing.
	// They passed in CI only because CI has no daemon — the moment this node was
	// named, they failed here and had never once exercised the path their own
	// comments describe. REFARM_TRACTOR_GRAPH_DIRECT_SQLITE forces the direct-SQLite
	// reader, which is the path these assertions are actually about.
	const isolatedEnv = (dir: string): NodeJS.ProcessEnv => ({
		XDG_DATA_HOME: dir,
		REFARM_TRACTOR_GRAPH_DIRECT_SQLITE: "1",
	});

	it("returns null when neither a local file nor a tractor db exists", async () => {
		// A fresh dir has no .refarm/config.json; XDG points at an empty dir and the
		// direct reader is forced, so openTractorGraph finds no db → null.
		const cfg = await resolveSovereignConfig(isolatedEnv(dir), dir);
		expect(cfg).toBeNull();
	});

	it("returns the local .refarm/config.json when present (operator authoritative)", async () => {
		const fs = await import("node:fs");
		fs.mkdirSync(path.join(dir, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(dir, ".refarm", "config.json"),
			JSON.stringify({ runtime: { sidecarUrl: "http://local:1234" } }),
		);
		// The db is absent, but the local file wins first — the node is never
		// consulted for a device that has its own file.
		const cfg = await resolveSovereignConfig(isolatedEnv(dir), dir);
		expect(cfg).toEqual({ runtime: { sidecarUrl: "http://local:1234" } });
	});

	it("returns null (not a throw) when the local file is invalid JSON", async () => {
		const fs = await import("node:fs");
		fs.mkdirSync(path.join(dir, ".refarm"), { recursive: true });
		fs.writeFileSync(path.join(dir, ".refarm", "config.json"), "{ not json");
		// loadRawSovereignConfig returns null on invalid JSON; with no db, the whole
		// resolve degrades to null rather than throwing.
		const cfg = await resolveSovereignConfig(isolatedEnv(dir), dir);
		expect(cfg).toBeNull();
	});
});
