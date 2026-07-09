import { describe, expect, it } from "vitest";

import {
	createLocalRecordsAppDefaults,
	createLocalRecordsCapabilityDeps,
	createLocalRecordsCommandDeps,
	createLocalRecordsStatePathResolver,
	createSidecarSubmitEffort,
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

	it("builds a sidecar submit sink for daemon-backed examples", async () => {
		let requestedUrl = "";
		let requestedBody = "";
		const submit = createSidecarSubmitEffort({
			env: { REFARM_SIDECAR_URL: "http://127.0.0.1:52001/" },
			fetch: async (url, init) => {
				requestedUrl = String(url);
				requestedBody = String(init?.body);
				return new Response(JSON.stringify({ effortId: "effort-from-runtime" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		});

		await expect(submit({
			id: "effort-1",
			direction: "dispatch",
			source: "test",
			submittedAt: "2026-01-01T00:00:00Z",
			tasks: [{ id: "task-1", pluginId: "@example/plugin", fn: "search", args: {} }],
		})).resolves.toBe("effort-from-runtime");

		expect(requestedUrl).toBe("http://127.0.0.1:52001/efforts");
		expect(JSON.parse(requestedBody)).toMatchObject({
			id: "effort-1",
			tasks: [{ fn: "search" }],
		});
	});
});
