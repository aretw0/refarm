import { describe, expect, it } from "vitest";

import { createLocalRecordsStatePathResolver } from "./node.js";

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
});
