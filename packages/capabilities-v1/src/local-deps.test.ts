import { describe, expect, it } from "vitest";

import { createLocalCapabilityDeps } from "./index.js";

describe("createLocalCapabilityDeps", () => {
	it("builds local neutral deps for app and example hosts", () => {
		const deps = createLocalCapabilityDeps();

		expect(deps.source.sourceProvider.pluginId).toEqual(expect.any(String));
		expect(deps.vault.discover()).toEqual({ providers: [], rejected: [] });
		expect(deps.records?.loadManifest()).toEqual({
			manifestVersion: 1,
			records: [],
		});
	});

	it("lets hosts override only the deps they need to own", () => {
		const local = createLocalCapabilityDeps();
		const deps = createLocalCapabilityDeps({
			source: local.source,
			vault: local.vault,
			records: local.records,
		});

		expect(deps.source).toBe(local.source);
		expect(deps.vault).toBe(local.vault);
		expect(deps.records).toBe(local.records);
	});
});
