import { isUnderDevelopment, readPluginDevelopment } from "@refarm.dev/config";
import { describe, expect, it } from "vitest";

import type { RefarmCliConfig } from "../../src/commands/config-shared.js";
import {
	readPluginDevelopmentIds,
	setPluginDevelopment,
} from "../../src/commands/plugin-development.js";

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

describe("setPluginDevelopment — the development-declaration RMW", () => {
	it("declares a plugin under development, keyed by the runtime id", () => {
		const c = cell();
		const r = setPluginDevelopment("cfg.json", "@refarm/lsp-code-ops", true, {
			...c.io,
			now: () => "2026-08-26",
		});
		expect(r.changed).toBe(true);
		expect(r.underDevelopment).toBe(true);
		expect(r.pluginId).toBe("lsp-code-ops");
		expect(r.declaredAt).toBe("2026-08-26");
		expect(c.get().pluginDevelopment).toEqual({
			"lsp-code-ops": { declaredAt: "2026-08-26" },
		});
	});

	it("is idempotent — declaring an already-declared plugin changes nothing and keeps the original date", () => {
		const c = cell({
			pluginDevelopment: { "lsp-code-ops": { declaredAt: "2026-08-01" } },
		});
		const r = setPluginDevelopment("cfg.json", "lsp-code-ops", true, {
			...c.io,
			now: () => "2026-08-26",
		});
		expect(r.changed).toBe(false);
		expect(r.declaredAt).toBe("2026-08-01");
		expect(c.get().pluginDevelopment).toEqual({
			"lsp-code-ops": { declaredAt: "2026-08-01" },
		});
	});

	it("preserves siblings, including the orthogonal identity/effect axes", () => {
		const c = cell({
			trusted_plugins: ["agent"],
			approvedPermissions: { agent: ["fs:read"] },
		});
		const r = setPluginDevelopment("cfg.json", "agent", true, {
			...c.io,
			now: () => "2026-08-26",
		});
		expect(r.changed).toBe(true);
		expect(c.get().trusted_plugins).toEqual(["agent"]);
		expect(c.get().approvedPermissions).toEqual({ agent: ["fs:read"] });
	});

	it("--undevelop withdraws the declaration", () => {
		const c = cell({
			pluginDevelopment: {
				"lsp-code-ops": { declaredAt: "2026-08-01" },
				agent: { declaredAt: "2026-08-02" },
			},
		});
		const r = setPluginDevelopment("cfg.json", "@refarm/lsp-code-ops", false, c.io);
		expect(r.changed).toBe(true);
		expect(r.underDevelopment).toBe(false);
		expect(r.declaredAt).toBeNull();
		expect(c.get().pluginDevelopment).toEqual({ agent: { declaredAt: "2026-08-02" } });
	});

	it("drops the key entirely when the last declaration is withdrawn (permissive-compat, not an empty object)", () => {
		const c = cell({
			pluginDevelopment: { agent: { declaredAt: "2026-08-01" } },
			autostart: "agent",
		});
		const r = setPluginDevelopment("cfg.json", "agent", false, c.io);
		expect(r.changed).toBe(true);
		expect(c.get().pluginDevelopment).toBeUndefined();
		expect(c.get().autostart).toBe("agent");
	});

	it("withdrawing an undeclared id is a no-op", () => {
		const c = cell({ pluginDevelopment: { agent: { declaredAt: "2026-08-01" } } });
		const r = setPluginDevelopment("cfg.json", "ghost", false, c.io);
		expect(r.changed).toBe(false);
		expect(c.get().pluginDevelopment).toEqual({ agent: { declaredAt: "2026-08-01" } });
	});

	it("canonicalises a manifest-shaped id to the runtime id the reader looks up", () => {
		const c = cell();
		const r = setPluginDevelopment("cfg.json", "@scope/nested/name", true, {
			...c.io,
			now: () => "2026-08-26",
		});
		expect(r.pluginId).toBe("name");
		expect(c.get().pluginDevelopment).toEqual({ name: { declaredAt: "2026-08-26" } });
	});

	it("readPluginDevelopmentIds sorts the declared runtime ids", () => {
		expect(readPluginDevelopmentIds({})).toEqual([]);
		expect(
			readPluginDevelopmentIds({
				pluginDevelopment: { b: { declaredAt: "x" }, a: { declaredAt: "y" } },
			}),
		).toEqual(["a", "b"]);
	});
});

/**
 * The cross-package seam: `setPluginDevelopment` (this package, TS) writes the same
 * `.refarm/config.json` `packages/config/src/plugin-development.js`'s `isUnderDevelopment` /
 * `readPluginDevelopment` reads at load — the ACTUAL reader the Rust host mirrors
 * (`plugin_development_declares`) and the JS load path consults, not the writer's own
 * `readPluginDevelopmentIds` re-check above. Until now nothing asserted the writer's output is
 * what that reader accepts; both sides were unit-tested only against their OWN expectation of
 * the shape. This is the cross-package seam on the path that decides whether unsigned code
 * runs — the exact asymmetry that caused a real defect on this node (57ff5cc1, for the
 * sibling `approvedPermissions` axis).
 */
describe("round-trip: what setPluginDevelopment writes is what packages/config's reader accepts", () => {
	it("a declaration written for a manifest-shaped id is read back true, in either id vocabulary", () => {
		const c = cell();
		setPluginDevelopment("cfg.json", "@refarm/lsp-code-ops", true, {
			...c.io,
			now: () => "2026-08-26",
		});

		const written: RefarmCliConfig = c.get();
		expect(isUnderDevelopment(written, "@refarm/lsp-code-ops")).toBe(true);
		expect(isUnderDevelopment(written, "lsp-code-ops")).toBe(true);
		expect(readPluginDevelopment(written).get("lsp-code-ops")?.declaredAt).toBe("2026-08-26");
	});

	it("withdrawing a declaration is read back false, and the dropped key reads as absent, not malformed", () => {
		const c = cell();
		setPluginDevelopment("cfg.json", "agent", true, { ...c.io, now: () => "2026-08-01" });
		expect(isUnderDevelopment(c.get(), "agent")).toBe(true);

		setPluginDevelopment("cfg.json", "agent", false, c.io);
		const written: RefarmCliConfig = c.get();
		expect(isUnderDevelopment(written, "agent")).toBe(false);
		expect(readPluginDevelopment(written).size).toBe(0);
	});

	it("a plugin never declared reads back false", () => {
		const c = cell();
		setPluginDevelopment("cfg.json", "agent", true, { ...c.io, now: () => "2026-08-26" });
		expect(isUnderDevelopment(c.get(), "@refarm/lsp-code-ops")).toBe(false);
	});
});
