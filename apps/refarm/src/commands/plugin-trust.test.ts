import { describe, expect, it } from "vitest";

import type { RefarmCliConfig } from "./config-shared.js";
import { pluginIdPair, readTrustedPlugins, runtimeTrustId, setTrustedPlugin } from "./plugin-trust.js";

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

// ISS-068. The two config keys speak two vocabularies — `trusted_plugins` takes the RUNTIME id,
// `approvedPermissions` the MANIFEST id — and `plugin status --json` reported both forms under one
// `id` field. Getting it wrong is a DENY-ALL, not a typo: an invalid `trusted_plugins` entry makes
// the daemon refuse every plugin, which happened on the operator's real node.
describe("pluginIdPair — two vocabularies, and a null where neither can be derived", () => {
	const alias = (id: string) => (id === "agent" ? "@refarm/agent" : id);

	it("a scoped id IS the manifest id, and its last segment is the runtime one", () => {
		expect(pluginIdPair("@refarm/agent", alias)).toEqual({
			runtimeId: "agent",
			manifestId: "@refarm/agent",
		});
	});

	it("a bare id with a declared alias resolves both", () => {
		expect(pluginIdPair("agent", alias)).toEqual({
			runtimeId: "agent",
			manifestId: "@refarm/agent",
		});
	});

	// THE ONE THAT MATTERS. `lsp-code-ops` is installed on the operator's node, its
	// `approvedPermissions` key is `@refarm/lsp-code-ops`, and NOTHING in this repo can derive
	// that from the bare id — there is no alias. A guess here would be a confidently wrong id,
	// which is exactly what put a deny-all on his node.
	it("a bare id with no alias reports null rather than inventing a scope", () => {
		expect(pluginIdPair("lsp-code-ops", alias)).toEqual({
			runtimeId: "lsp-code-ops",
			manifestId: null,
		});
	});

	it("the trust wildcard is neither, and says so", () => {
		expect(pluginIdPair("*", alias)).toEqual({ runtimeId: "*", manifestId: null });
	});

	it("without an alias table it still answers the half it can derive", () => {
		expect(pluginIdPair("  @scope/thing  ")).toEqual({
			runtimeId: "thing",
			manifestId: "@scope/thing",
		});
		expect(pluginIdPair("thing")).toEqual({ runtimeId: "thing", manifestId: null });
	});
});
