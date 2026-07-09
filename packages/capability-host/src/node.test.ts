import { describe, expect, it } from "vitest";

import {
	createLocalRecordsAppDefaults,
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
});
