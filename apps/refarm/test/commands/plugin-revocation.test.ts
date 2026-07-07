import { describe, expect, it } from "vitest";

import {
	readRevokedPermissions,
	readRevokedPlugins,
	revoke,
	unrevoke,
} from "../../src/commands/plugin-revocation.js";
import type { RefarmCliConfig } from "../../src/commands/config-shared.js";

/**
 * The revocation persistence primitive — surface-neutral, ADD-ONLY read/modify/write
 * of the revokedPlugins / revokedPermissions lists on .refarm/config.json. The host
 * materializes each entry into a monotonic graph tombstone at load. Injectable
 * read/write so these tests never touch the filesystem.
 */
describe("plugin revocation persistence (add-only, monotonic)", () => {
	function makeIo(initial: RefarmCliConfig = {}) {
		const store: RefarmCliConfig = structuredClone(initial);
		return {
			store,
			read: () => structuredClone(store),
			write: (_path: string, config: RefarmCliConfig) => {
				// Replace wholesale so a removed key is actually removed in the store.
				for (const k of Object.keys(store)) delete (store as Record<string, unknown>)[k];
				Object.assign(store, config);
			},
		};
	}

	it("reads empty when nothing is revoked", () => {
		expect(readRevokedPlugins({})).toEqual([]);
		expect(readRevokedPermissions({}, "@x/p")).toEqual([]);
	});

	it("revokes a whole plugin (appends to revokedPlugins)", () => {
		const io = makeIo();
		const result = revoke("/cfg", "@x/p", null, io);
		expect(result.changed).toBe(true);
		expect(result.capability).toBeNull();
		expect(io.store.revokedPlugins).toEqual(["@x/p"]);
	});

	it("revokes a single capability (appends to revokedPermissions)", () => {
		const io = makeIo();
		const result = revoke("/cfg", "@x/p", "network:outbound", io);
		expect(result.changed).toBe(true);
		expect(result.capability).toBe("network:outbound");
		expect(io.store.revokedPermissions).toEqual({ "@x/p": ["network:outbound"] });
	});

	it("is ADD-ONLY: revoking is idempotent, never removes a sibling", () => {
		const io = makeIo({ revokedPlugins: ["@a/p"] });
		// Re-revoking an already-revoked plugin is a no-op (monotonic).
		const again = revoke("/cfg", "@a/p", null, io);
		expect(again.changed).toBe(false);
		expect(io.store.revokedPlugins).toEqual(["@a/p"]);
		// A new revocation appends without touching the existing one.
		revoke("/cfg", "@b/p", null, io);
		expect(io.store.revokedPlugins).toEqual(["@a/p", "@b/p"]);
	});

	it("accumulates multiple revoked capabilities per plugin, de-duplicated + sorted", () => {
		const io = makeIo();
		revoke("/cfg", "@x/p", "shell:spawn", io);
		revoke("/cfg", "@x/p", "fs:read", io);
		revoke("/cfg", "@x/p", "shell:spawn", io); // duplicate → no-op
		expect(io.store.revokedPermissions).toEqual({ "@x/p": ["fs:read", "shell:spawn"] });
	});

	it("preserves approvedPermissions and other config siblings untouched", () => {
		const io = makeIo({
			approvedPermissions: { "@x/p": ["fs:read"] },
			autostart: "always",
		});
		revoke("/cfg", "@x/p", null, io);
		expect(io.store.approvedPermissions).toEqual({ "@x/p": ["fs:read"] });
		expect(io.store.autostart).toBe("always");
		expect(io.store.revokedPlugins).toEqual(["@x/p"]);
	});

	// ── un-revoke: reversible, monotonic (annulment seq out-ranks the revoke) ──

	it("un-revokes a plugin by bumping the annul seq above the revoke seq", () => {
		const io = makeIo();
		revoke("/cfg", "@x/p", null, io);
		const revokeSeq = io.store.revokedPluginsSeq?.["@x/p"] ?? 1;

		const result = unrevoke("/cfg", "@x/p", null, io);
		expect(result.changed).toBe(true);
		const annulSeq = io.store.revokedPluginsAnnul?.["@x/p"] ?? 0;
		expect(annulSeq).toBeGreaterThan(revokeSeq);
		// The revoked list is NOT shrunk (add-only); the annul out-ranks it.
		expect(io.store.revokedPlugins).toEqual(["@x/p"]);
	});

	it("re-revoke after un-revoke bumps the revoke seq back above the annul", () => {
		const io = makeIo();
		revoke("/cfg", "@x/p", null, io);
		unrevoke("/cfg", "@x/p", null, io);
		const annulSeq = io.store.revokedPluginsAnnul?.["@x/p"] ?? 0;

		const result = revoke("/cfg", "@x/p", null, io); // re-revoke
		expect(result.changed).toBe(true);
		const revokeSeq = io.store.revokedPluginsSeq?.["@x/p"] ?? 1;
		expect(revokeSeq).toBeGreaterThan(annulSeq);
	});

	it("un-revoke is idempotent once already un-revoked", () => {
		const io = makeIo();
		revoke("/cfg", "@x/p", null, io);
		unrevoke("/cfg", "@x/p", null, io);
		const first = io.store.revokedPluginsAnnul?.["@x/p"];
		const again = unrevoke("/cfg", "@x/p", null, io);
		expect(again.changed).toBe(false);
		expect(io.store.revokedPluginsAnnul?.["@x/p"]).toBe(first);
	});

	it("un-revoke of a never-revoked plugin is a no-op", () => {
		const io = makeIo();
		const result = unrevoke("/cfg", "@x/p", null, io);
		expect(result.changed).toBe(false);
		expect(io.store.revokedPluginsAnnul).toBeUndefined();
	});

	it("un-revokes a single capability independently", () => {
		const io = makeIo();
		revoke("/cfg", "@x/p", "network:outbound", io);
		revoke("/cfg", "@x/p", "fs:read", io);
		unrevoke("/cfg", "@x/p", "network:outbound", io);
		// network:outbound annulled; fs:read still revoked (no annul entry).
		expect(io.store.revokedPermissionsAnnul?.["@x/p:network:outbound"]).toBeGreaterThan(0);
		expect(io.store.revokedPermissionsAnnul?.["@x/p:fs:read"]).toBeUndefined();
	});
});
