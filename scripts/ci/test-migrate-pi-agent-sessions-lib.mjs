import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	migratePiAgentSessionNode,
	migratePiAgentSessionNodes,
} from "./migrate-pi-agent-sessions-lib.mjs";

describe("migrate-pi-agent-sessions-lib", () => {
	it("rewrites legacy @id and session references", () => {
		const input = {
			"@type": "SessionEntry",
			"@id": "urn:pi-agent:entry-123",
			session_id: "urn:pi-agent:session-abc",
			parent_entry_id: "urn:pi-agent:entry-100",
			kind: "user",
			content: "hello",
			timestamp_ns: 1,
		};

		const result = migratePiAgentSessionNode(input);
		assert.equal(result.changed, true);
		assert.equal(result.node["@id"], "urn:refarm:session-entry:v1:123");
		assert.equal(result.node.session_id, "urn:refarm:session:v1:abc");
		assert.equal(
			result.node.parent_entry_id,
			"urn:refarm:session-entry:v1:100",
		);
	});

	it("leaves unrelated content untouched", () => {
		const input = {
			"@type": "SessionEntry",
			"@id": "urn:refarm:session-entry:v1:123",
			session_id: "urn:refarm:session:v1:abc",
			parent_entry_id: null,
			kind: "user",
			content: "urn:pi-agent:entry-should-not-change-inside-content",
			timestamp_ns: 1,
		};

		const result = migratePiAgentSessionNode(input);
		assert.equal(result.changed, false);
		assert.equal(
			result.node.content,
			"urn:pi-agent:entry-should-not-change-inside-content",
		);
	});

	it("reports migration totals across node lists", () => {
		const { nodes, report } = migratePiAgentSessionNodes([
			{
				"@type": "Session",
				"@id": "urn:pi-agent:session-root",
				leaf_entry_id: "urn:pi-agent:entry-1",
				parent_session_id: null,
				created_at_ns: 1,
			},
			{
				"@type": "SessionEntry",
				"@id": "urn:pi-agent:entry-1",
				session_id: "urn:pi-agent:session-root",
				parent_entry_id: null,
				kind: "user",
				content: "hi",
				timestamp_ns: 2,
			},
		]);

		assert.equal(report.total, 2);
		assert.equal(report.migrated, 2);
		assert.equal(report.idRewrites, 2);
		assert.equal(report.referenceRewrites, 2);
		assert.equal(nodes[0]["@id"], "urn:refarm:session:v1:root");
		assert.equal(nodes[1]["@id"], "urn:refarm:session-entry:v1:1");
	});
});
