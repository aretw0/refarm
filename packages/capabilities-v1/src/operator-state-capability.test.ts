import {
	buildBaseSurfaceModel,
	buildReviewQueueSurfaceUnit,
	type BaseSurfaceModel,
} from "@refarm.dev/operator-state";
import { describe, expect, it } from "vitest";

import { createBaseStatusCapability } from "./operator-state-capability.js";

describe("operator-state capability", () => {
	it("projects a base status model as a normal capability verb", async () => {
		const capability = createBaseStatusCapability({
			summary: "Show wallet operator status",
			httpPath: "/wallet/status",
			model: () =>
				buildBaseSurfaceModel(
					{
						units: [
							buildReviewQueueSurfaceUnit({
								id: "wallet",
								label: "Wallet",
								owner: "examples/wallet-t2",
								total: 3,
								pending: 1,
								totalLabel: "held items",
								pendingLabel: "needs review",
							}),
						],
					},
					{ command: "wallet", operation: "base" },
				),
		});

		expect(capability).toMatchObject({
			name: "status",
			summary: "Show wallet operator status",
			options: [
				{
					name: "base",
					kind: "boolean",
				},
			],
			transports: {
				cli: {},
				repl: {},
				http: { method: "GET", path: "/wallet/status" },
				agent: { tool: true, toolName: "status" },
			},
		});

		const envelope = await capability.run({
			args: {},
			options: { base: true },
			json: true,
		}) as BaseSurfaceModel;
		expect(envelope).toMatchObject({
			schemaVersion: 1,
			command: "wallet",
			operation: "base",
			ok: true,
		});
		expect(envelope.units[0]).toMatchObject({
			id: "wallet",
			state: "degraded",
			severity: "warning",
		});
	});
});
