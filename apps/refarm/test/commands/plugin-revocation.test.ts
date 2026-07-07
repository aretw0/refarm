import { describe, expect, it } from "vitest";

import {
	readRevokedPermissions,
	readRevokedPlugins,
	revoke,
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
			model: "gpt-4",
		});
		revoke("/cfg", "@x/p", null, io);
		expect(io.store.approvedPermissions).toEqual({ "@x/p": ["fs:read"] });
		expect(io.store.model).toBe("gpt-4");
		expect(io.store.revokedPlugins).toEqual(["@x/p"]);
	});
});
