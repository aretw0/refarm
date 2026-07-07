import { describe, expect, it } from "vitest";

import {
	readApprovedPermissions,
	setApprovedPermissions,
} from "../../src/commands/plugin-approval.js";
import type { RefarmCliConfig } from "../../src/commands/config-shared.js";

/**
 * The approval persistence primitive — surface-neutral read/modify/write of the
 * approvedPermissions map on .refarm/config.json. Injectable read/write so these
 * tests never touch the filesystem.
 */
describe("plugin approval persistence", () => {
	function makeIo(initial: RefarmCliConfig = {}) {
		const store: RefarmCliConfig = structuredClone(initial);
		return {
			store,
			read: () => structuredClone(store),
			write: (_path: string, config: RefarmCliConfig) => {
				Object.assign(store, config);
			},
		};
	}

	it("reads an empty set when nothing is approved", () => {
		expect(readApprovedPermissions({}, "@x/p")).toEqual([]);
		expect(
			readApprovedPermissions(
				{ approvedPermissions: { "@x/p": ["fs:read"] } },
				"@other/p",
			),
		).toEqual([]);
	});

	it("persists a de-duplicated, sorted approved set", () => {
		const io = makeIo();
		const result = setApprovedPermissions(
			"/cfg",
			"@x/p",
			["network:outbound", "fs:read", "fs:read"],
			io,
		);
		expect(result.changed).toBe(true);
		expect(result.approved).toEqual(["fs:read", "network:outbound"]);
		expect(io.store.approvedPermissions?.["@x/p"]).toEqual([
			"fs:read",
			"network:outbound",
		]);
	});

	it("preserves sibling config and other plugins' approvals", () => {
		const io = makeIo({
			autostart: "always",
			trusted_plugins: ["@x/p"],
			approvedPermissions: { "@other/p": ["shell:spawn"] },
		} as RefarmCliConfig);
		setApprovedPermissions("/cfg", "@x/p", ["fs:read"], io);
		// scalar sibling untouched
		expect(io.store.autostart).toBe("always");
		expect((io.store as { trusted_plugins?: string[] }).trusted_plugins).toEqual([
			"@x/p",
		]);
		// other plugin's approval untouched
		expect(io.store.approvedPermissions?.["@other/p"]).toEqual(["shell:spawn"]);
		expect(io.store.approvedPermissions?.["@x/p"]).toEqual(["fs:read"]);
	});

	it("an empty set (deny) revokes: removes the plugin key entirely", () => {
		const io = makeIo({
			approvedPermissions: { "@x/p": ["fs:read"], "@y/q": ["fs:write"] },
		});
		const result = setApprovedPermissions("/cfg", "@x/p", [], io);
		expect(result.approved).toEqual([]);
		expect(io.store.approvedPermissions?.["@x/p"]).toBeUndefined();
		// sibling plugin still there
		expect(io.store.approvedPermissions?.["@y/q"]).toEqual(["fs:write"]);
	});

	it("is a no-op (changed:false) when the set is identical", () => {
		const io = makeIo({ approvedPermissions: { "@x/p": ["fs:read"] } });
		let wrote = false;
		const result = setApprovedPermissions("/cfg", "@x/p", ["fs:read"], {
			read: io.read,
			write: () => {
				wrote = true;
			},
		});
		expect(result.changed).toBe(false);
		expect(wrote).toBe(false);
	});
});
