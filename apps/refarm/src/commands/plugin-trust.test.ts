import { describe, expect, it } from "vitest";

import type { RefarmCliConfig } from "./config-shared.js";
import { readTrustedPlugins, runtimeTrustId, setTrustedPlugin } from "./plugin-trust.js";

/** An in-memory config cell for the injectable read/write, so no disk is touched. */
function cell(initial: RefarmCliConfig = {}) {
	let store: RefarmCliConfig = initial;
	return {
		io: {
			read: () => store,
			write: (_p: string, c: RefarmCliConfig) => {
				store = c;
			},
		},
		get: () => store,
	};
}

describe("runtimeTrustId — normalize to the host's runtime id", () => {
	it("strips the manifest scope to the last segment", () => {
		expect(runtimeTrustId("@refarm/delegate")).toBe("delegate");
		expect(runtimeTrustId("@scope/nested/name")).toBe("name");
	});
	it("passes a bare id through", () => {
		expect(runtimeTrustId("agent")).toBe("agent");
	});
	it("passes the wildcard through", () => {
		expect(runtimeTrustId("*")).toBe("*");
	});
	it("trims surrounding whitespace", () => {
		expect(runtimeTrustId("  delegate  ")).toBe("delegate");
	});
});

describe("setTrustedPlugin — the identity allowlist RMW", () => {
	it("adds a normalized id to an empty config", () => {
		const c = cell();
		const r = setTrustedPlugin("cfg.json", "@refarm/delegate", true, c.io);
		expect(r.changed).toBe(true);
		expect(r.trusted).toBe(true);
		expect(r.pluginId).toBe("delegate");
		expect(c.get().trusted_plugins).toEqual(["delegate"]);
	});

	it("is idempotent — trusting an already-trusted id changes nothing", () => {
		const c = cell({ trusted_plugins: ["agent", "delegate"] });
		const r = setTrustedPlugin("cfg.json", "delegate", true, c.io);
		expect(r.changed).toBe(false);
		expect(r.trusted).toBe(true);
		expect(c.get().trusted_plugins).toEqual(["agent", "delegate"]);
	});

	it("preserves siblings and keeps the list sorted + de-duplicated", () => {
		const c = cell({ trusted_plugins: ["quality"], approvedPermissions: { agent: ["fs:read"] } });
		const r = setTrustedPlugin("cfg.json", "agent", true, c.io);
		expect(r.changed).toBe(true);
		expect(c.get().trusted_plugins).toEqual(["agent", "quality"]);
		// the orthogonal capability axis is untouched
		expect(c.get().approvedPermissions).toEqual({ agent: ["fs:read"] });
	});

	it("removes an id when untrusting (trusted: false)", () => {
		const c = cell({ trusted_plugins: ["agent", "delegate"] });
		const r = setTrustedPlugin("cfg.json", "@refarm/delegate", false, c.io);
		expect(r.changed).toBe(true);
		expect(r.trusted).toBe(false);
		expect(c.get().trusted_plugins).toEqual(["agent"]);
	});

	it("drops the key entirely when the last id is removed (permissive-compat, not deny-all [])", () => {
		const c = cell({ trusted_plugins: ["delegate"], autostart: "agent" });
		const r = setTrustedPlugin("cfg.json", "delegate", false, c.io);
		expect(r.changed).toBe(true);
		expect(c.get().trusted_plugins).toBeUndefined();
		// a sibling scalar survives the drop
		expect(c.get().autostart).toBe("agent");
	});

	it("untrusting an absent id is a no-op", () => {
		const c = cell({ trusted_plugins: ["agent"] });
		const r = setTrustedPlugin("cfg.json", "ghost", false, c.io);
		expect(r.changed).toBe(false);
		expect(c.get().trusted_plugins).toEqual(["agent"]);
	});

	it("supports the * wildcard as a trusted entry", () => {
		const c = cell();
		const r = setTrustedPlugin("cfg.json", "*", true, c.io);
		expect(r.changed).toBe(true);
		expect(c.get().trusted_plugins).toEqual(["*"]);
	});

	it("readTrustedPlugins returns [] when the key is absent", () => {
		expect(readTrustedPlugins({})).toEqual([]);
		expect(readTrustedPlugins({ trusted_plugins: ["agent"] })).toEqual(["agent"]);
	});
});
