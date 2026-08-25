import { describe, expect, it } from "vitest";

import {
	approvalKey,
	ineffectiveApprovalKeys,
	readApprovedPermissions,
	setApprovedPermissions,
} from "../../src/commands/plugin-approval.js";
import type { RefarmCliConfig } from "../../src/commands/config-shared.js";

/**
 * The approval persistence primitive — surface-neutral read/modify/write of the
 * approvedPermissions map on .refarm/config.json. Injectable read/write so these
 * tests never touch the filesystem.
 *
 * EVERY FIXTURE HERE KEYED BY THE MANIFEST ID UNTIL 2026-08-25, AND THE HOST NEVER READ THAT.
 * Measured against the host rather than the ticket: the load path computes
 * `manifest_runtime_plugin_id(manifest.id)` and looks the approval up under THAT
 * (`env_and_runtime.rs`), while `parse_approved_permissions` inserts config keys raw. So
 * `approvedPermissions["@x/p"]` was never consulted for a plugin whose manifest id is `@x/p` —
 * the host asks for `p`.
 *
 * AND A MISS IS PERMISSIVE. `scope_to_approved` returns the DECLARED set when the key is absent,
 * so a wrong key does not fail to grant, it fails to RESTRICT — silently, while the config reads
 * as a restriction the operator made. On his real node `approvedPermissions` held
 * `{"@refarm/lsp-code-ops": ["fs:read","fs:write"]}` against a plugin that also declares
 * `shell:spawn`, and the host was granting all three.
 *
 * This suite was not failing to catch that; it was ASSERTING it — the third fixture found
 * pinning a defect as correct in one day (AGENTS.md §9, third bullet).
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
			readApprovedPermissions({ approvedPermissions: { p: ["fs:read"] } }, "@other/q"),
		).toEqual([]);
	});

	it("reads under the RUNTIME id, which is the key the host looks up", () => {
		// The whole finding, as one assertion. A manifest-keyed entry is invisible to the host,
		// so it must be invisible here too — reporting it would say a restriction is in place
		// that is not.
		expect(readApprovedPermissions({ approvedPermissions: { p: ["fs:read"] } }, "@x/p")).toEqual([
			"fs:read",
		]);
		expect(
			readApprovedPermissions({ approvedPermissions: { "@x/p": ["fs:read"] } }, "@x/p"),
		).toEqual([]);
	});

	it("collides across scopes, exactly as the host does", () => {
		// DOCUMENTED, NOT INTRODUCED. The runtime id is the last path segment, so `@x/p` and
		// `@other/p` are one key — for `approvedPermissions` and for `trusted_plugins` alike,
		// because the host reduces both the same way. Stating it here so the next reader meets it
		// as a property rather than as a surprise; changing it is the host's decision, not this
		// primitive's.
		expect(approvalKey("@x/p")).toBe(approvalKey("@other/p"));
	});

	it("REPORTS a key the host will never look up, and leaves it alone", () => {
		// The operator's rule, taken 2026-08-25: report, never migrate. Such a key is not a
		// collision to merge — it is an approval that never applied, and because a miss is
		// permissive it has been granting everything the plugin declared.
		const io = makeIo({ approvedPermissions: { "@x/p": ["fs:read"] } });
		const result = setApprovedPermissions("/cfg", "@x/p", ["fs:read"], io);

		expect(result.ineffectiveKeys).toEqual(["@x/p"]);
		expect(io.store.approvedPermissions?.["@x/p"]).toEqual(["fs:read"]);
		expect(io.store.approvedPermissions?.p).toEqual(["fs:read"]);
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
		expect(result.pluginId).toBe("p");
		expect(io.store.approvedPermissions?.p).toEqual(["fs:read", "network:outbound"]);
	});

	it("preserves sibling config and other plugins' approvals", () => {
		const io = makeIo({
			autostart: "always",
			trusted_plugins: ["@x/p"],
			approvedPermissions: { q: ["shell:spawn"] },
		} as RefarmCliConfig);
		setApprovedPermissions("/cfg", "@x/p", ["fs:read"], io);
		// scalar sibling untouched
		expect(io.store.autostart).toBe("always");
		expect((io.store as { trusted_plugins?: string[] }).trusted_plugins).toEqual([
			"@x/p",
		]);
		// other plugin's approval untouched
		expect(io.store.approvedPermissions?.q).toEqual(["shell:spawn"]);
		expect(io.store.approvedPermissions?.p).toEqual(["fs:read"]);
	});

	it("an empty set (deny) revokes: removes the plugin key entirely", () => {
		const io = makeIo({
			approvedPermissions: { p: ["fs:read"], q: ["fs:write"] },
		});
		const result = setApprovedPermissions("/cfg", "@x/p", [], io);
		expect(result.approved).toEqual([]);
		expect(io.store.approvedPermissions?.p).toBeUndefined();
		// sibling plugin still there
		expect(io.store.approvedPermissions?.q).toEqual(["fs:write"]);
	});

	it("is a no-op (changed:false) when the set is identical", () => {
		const io = makeIo({ approvedPermissions: { p: ["fs:read"] } });
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
