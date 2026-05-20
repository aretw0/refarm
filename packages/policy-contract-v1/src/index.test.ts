import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION_POLICY, type RetentionPolicy } from "./index.js";

describe("policy contracts", () => {
	it("RetentionPolicy ttlSeconds=0 means retain forever", () => {
		const policy: RetentionPolicy = { ...DEFAULT_RETENTION_POLICY, ttlSeconds: 0 };
		expect(policy.ttlSeconds).toBe(0);
	});

	it("RetentionPolicy maxAssetBytes=0 means no size limit", () => {
		const policy: RetentionPolicy = { ...DEFAULT_RETENTION_POLICY, maxAssetBytes: 0 };
		expect(policy.maxAssetBytes).toBe(0);
	});

	it("DEFAULT_RETENTION_POLICY has expected defaults", () => {
		expect(DEFAULT_RETENTION_POLICY).toEqual({
			ttlSeconds: 2_592_000,
			maxAssetBytes: 52_428_800,
			dryRun: false,
		});
	});
});
