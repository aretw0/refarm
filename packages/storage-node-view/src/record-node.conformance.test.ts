import type { NormalisedNode } from "@refarm.dev/node-contract-v1";
import type { StorageRecord } from "@refarm.dev/storage-contract-v1";

import { describe, expect, it } from "vitest";

import { nodeToRecord, recordToNode } from "./record-node.js";

/**
 * The maintainer's insight, proven mechanically: a ledger record and a graph
 * node are the same data. record → node → record and node → record → node must
 * both be identity (up to the defaults the projection fills in). This mirrors
 * node-contract-v1's normalised.conformance.test.ts so the same drift-guard
 * discipline applies to the record⇄node half.
 */
const NOW = "2026-07-03T12:00:00.000Z";

describe("record⇄node round-trip", () => {
	it("node → record → node preserves the full node (id/type/context/domain/provenance)", () => {
		const node: NormalisedNode = {
			"@context": "https://schema.org/",
			"@type": "Task",
			"@id": "urn:refarm:agent:task-1",
			"refarm:sourcePlugin": "agent",
			"refarm:context": "ctx-1",
			"refarm:createdAt": "2026-07-01T00:00:00.000Z",
			"refarm:updatedAt": "2026-07-02T00:00:00.000Z",
			title: "Do the thing",
			priority: 1,
		};

		const record = nodeToRecord(node, NOW);
		expect(record.id).toBe(node["@id"]);
		expect(record.type).toBe(node["@type"]);
		expect(record.createdAt).toBe(node["refarm:createdAt"]);

		const back = recordToNode(record);
		// Every field survives the flat record via payload.
		expect(back["@type"]).toBe("Task");
		expect(back["@id"]).toBe(node["@id"]);
		expect(back["@context"]).toBe("https://schema.org/");
		expect(back["refarm:sourcePlugin"]).toBe("agent");
		expect(back["refarm:context"]).toBe("ctx-1");
		expect(back.title).toBe("Do the thing");
		expect(back.priority).toBe(1);
		expect(back["refarm:createdAt"]).toBe("2026-07-01T00:00:00.000Z");
	});

	it("record → node → record is identity for a node-shaped payload", () => {
		const record: StorageRecord = {
			id: "urn:x:1",
			type: "ConfigOverride",
			payload: JSON.stringify({
				"@context": "https://schema.org/",
				"@type": "ConfigOverride",
				"@id": "urn:x:1",
				"refarm:capabilities": ["network:fetch"],
			}),
			createdAt: "2026-07-01T00:00:00.000Z",
			updatedAt: "2026-07-01T00:00:00.000Z",
		};

		const node = recordToNode(record);
		const back = nodeToRecord(node, NOW);
		expect(back.id).toBe(record.id);
		expect(back.type).toBe(record.type);
		expect(back.createdAt).toBe(record.createdAt);
		// The node body survives verbatim.
		expect(JSON.parse(back.payload)["refarm:capabilities"]).toEqual([
			"network:fetch",
		]);
	});

	it("fills a default node id/type/context when the node omits them via the record columns", () => {
		const node: NormalisedNode = {
			"@context": "https://schema.org/",
			"@type": "PluginCatalogEntry",
			"@id": "urn:refarm:plugin:matrix",
		};
		const record = nodeToRecord(node, NOW);
		// No refarm:createdAt on the node → record uses the injected clock.
		expect(record.createdAt).toBe(NOW);
		expect(record.updatedAt).toBe(NOW);
		const back = recordToNode(record);
		expect(back["@id"]).toBe("urn:refarm:plugin:matrix");
	});

	it("stays total for an opaque (non-node) ledger payload", () => {
		const record: StorageRecord = {
			id: "flag-1",
			type: "feature-flag",
			payload: "enabled",
			createdAt: NOW,
			updatedAt: NOW,
		};
		const node = recordToNode(record);
		expect(node["@id"]).toBe("flag-1");
		expect(node["@type"]).toBe("feature-flag");
		expect(node["refarm:payload"]).toBe("enabled");
	});
});
