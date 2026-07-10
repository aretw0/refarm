import { describe, expect, it } from "vitest";

import { buildJsonSuccessEnvelope } from "./envelope.js";
import { buildCapabilityOpenApiDocument } from "./openapi-projector.js";
import type { CapabilityDescriptor, CapabilityGroup } from "./types.js";

function descriptor(
	name: string,
	overrides: Partial<CapabilityDescriptor> = {},
): CapabilityDescriptor {
	return {
		name,
		summary: `${name} summary`,
		run: () => buildJsonSuccessEnvelope({ command: name }),
		...overrides,
	};
}

describe("buildCapabilityOpenApiDocument", () => {
	it("projects HTTP capability metadata into an OpenAPI document", () => {
		const doc = buildCapabilityOpenApiDocument(
			[
				descriptor("wallet-open", {
					args: [{ name: "path" }],
					options: [
						{ name: "dryRun", kind: "boolean", summary: "Preview only." },
					],
					transports: { http: { method: "POST", path: "/wallet/open" } },
				}),
				descriptor("cli-only"),
			],
			{ title: "DGK API", version: "0.2.0", prefix: "/capabilities" },
		);

		expect(doc.openapi).toBe("3.1.0");
		expect(doc.info).toEqual({ title: "DGK API", version: "0.2.0" });
		expect(Object.keys(doc.paths)).toEqual(["/capabilities/wallet/open"]);
		expect(doc.paths["/capabilities/wallet/open"]?.post).toMatchObject({
			operationId: "wallet_open",
			summary: "wallet-open summary",
			"x-capability-name": "wallet-open",
			requestBody: {
				required: false,
				content: {
					"application/json": {
						schema: {
							type: "object",
							properties: {
								args: {
									type: "object",
									properties: { path: { type: "string" } },
									additionalProperties: true,
								},
								options: {
									type: "object",
									properties: { dryRun: { type: "boolean", description: "Preview only." } },
									additionalProperties: true,
								},
							},
							additionalProperties: false,
						},
					},
				},
			},
		});
	});

	it("projects a group HTTP route through its default action", () => {
		const group: CapabilityGroup = {
			name: "skill",
			summary: "skill group",
			actions: { list: descriptor("list", { summary: "List skills" }) },
			defaultAction: "list",
			transports: { http: { method: "GET", path: "/skills" } },
		};

		const doc = buildCapabilityOpenApiDocument([group]);

		expect(doc.paths["/skills"]?.get).toMatchObject({
			operationId: "skill",
			summary: "List skills",
			"x-capability-name": "skill",
		});
		expect(doc.paths["/skills"]?.get).not.toHaveProperty("requestBody");
	});
});
