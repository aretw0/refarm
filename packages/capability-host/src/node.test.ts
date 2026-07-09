import { describe, expect, it } from "vitest";

import {
	createLocalRecordsAppDefaults,
	createLocalRecordsCapabilityDeps,
	createLocalRecordsCommandDeps,
	createLocalRecordsStatePathResolver,
} from "./node.js";

describe("@refarm.dev/capability-host/node", () => {
	it("exposes host app default helpers without importing capabilities-v1/node", () => {
		const statePath = createLocalRecordsStatePathResolver({
			appId: "dgk",
			envKey: "DGK_WALLET_STATE_PATH",
			fileName: "wallet.manifest.json",
		});

		expect(statePath({
			cwd: "/repo",
			env: {},
		})).toBe("/repo/.dgk/wallet.manifest.json");
	});

	it("exposes local records deps for thin host examples", () => {
		const deps = createLocalRecordsCommandDeps({
			seed: () => ({ manifestVersion: 1, records: [] }),
		});

		expect(deps.loadManifest()).toEqual({ manifestVersion: 1, records: [] });
	});

	it("builds local records app defaults for thin host apps", () => {
		const defaults = createLocalRecordsAppDefaults({
			appId: "dgk",
			envKey: "DGK_WALLET_STATE_PATH",
			fileName: "wallet.manifest.json",
		});

		expect(defaults.statePath({ cwd: "/repo", env: {} })).toBe(
			"/repo/.dgk/wallet.manifest.json",
		);
		expect(defaults.defaultOptions({ cwd: "/repo", env: {} })).toEqual({
			statePath: "/repo/.dgk/wallet.manifest.json",
		});
	});

	it("builds a shared local records capability bundle for host apps", () => {
		const seed = () => ({
			manifestVersion: 1 as const,
			records: [
				{
					id: "record:one",
					schemaVersion: 1,
					fields: { title: "One" },
					review: { state: "draft" },
					contentHash: "hash:one",
				},
			],
		});

		const bundle = createLocalRecordsCapabilityDeps({ seed });

		expect(bundle.records.loadManifest().records).toHaveLength(1);
		expect(bundle.deps.records).toBe(bundle.records);
		expect(bundle.deps.vault.seed?.()).toEqual(seed());
	});
});
