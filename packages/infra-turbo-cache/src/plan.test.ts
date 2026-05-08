import { describe, expect, it } from "vitest";
import { createTurboCacheServicePlan } from "./plan.js";

describe("createTurboCacheServicePlan", () => {
	it("declares provider-neutral remote cache requirements", () => {
		expect(createTurboCacheServicePlan({ team: "garden" })).toEqual({
			serviceId: "turbo-cache",
			displayName: "Turborepo Remote Cache",
			team: "garden",
			requirements: [
				{
					kind: "artifact-storage",
					name: "artifact-store",
					description: 'Durable artifact storage scoped for team "garden"',
				},
				{
					kind: "http-endpoint",
					name: "cache-api",
					description:
						"HTTP endpoint implementing Turborepo Remote Cache API v8",
				},
				{
					kind: "bearer-auth",
					name: "cache-auth-token",
					description:
						"Bearer token required by CI clients that read/write cache artifacts",
					secret: true,
				},
			],
			ciSecrets: ["TURBO_CACHE_API_URL", "TURBO_CACHE_TOKEN"],
		});
	});
});
