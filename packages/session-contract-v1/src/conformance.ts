import type {
	Session,
	SessionConformanceResult,
	SessionContractAdapter,
} from "./types.js";

export async function runSessionV1Conformance(
	adapter: SessionContractAdapter,
): Promise<SessionConformanceResult> {
	const failures: string[] = [];
	let total = 3;

	const sessionInput: Omit<Session, "@id" | "created_at_ns"> = {
		"@type": "Session",
		participants: ["urn:refarm:conformance", "urn:refarm:agent:test"],
		context_id: "urn:refarm:context:conformance",
	};

	let created: Session | undefined;

	// 1 — create
	try {
		created = await adapter.create(sessionInput);
		if (!created["@id"]) failures.push("create() returned Session without @id");
		if (created["@type"] !== "Session") {
			failures.push("create() returned wrong @type");
		}
		if (!created.created_at_ns) {
			failures.push("create() did not set created_at_ns");
		}
	} catch (error) {
		failures.push(`create() threw: ${String(error)}`);
	}

	// 2 — get
	if (created) {
		try {
			const fetched = await adapter.get(created["@id"]);
			if (!fetched) {
				failures.push(`get() returned null for id ${created["@id"]}`);
			} else if (fetched["@id"] !== created["@id"]) {
				failures.push("get() returned wrong @id");
			}
		} catch (error) {
			failures.push(`get() threw: ${String(error)}`);
		}
	}

	// 3 — appendEntry + parent chain
	if (created) {
		try {
			const first = await adapter.appendEntry({
				"@type": "SessionEntry",
				session_id: created["@id"],
				parent_entry_id: null,
				kind: "user",
				content: "Conformance first entry",
			});

			if (first.session_id !== created["@id"]) {
				failures.push("appendEntry() returned wrong session_id");
			}

			const second = await adapter.appendEntry({
				"@type": "SessionEntry",
				session_id: created["@id"],
				parent_entry_id: first["@id"],
				kind: "agent",
				content: "Conformance second entry",
			});

			if (second.parent_entry_id !== first["@id"]) {
				failures.push("appendEntry() parent_entry_id chain mismatch");
			}
		} catch (error) {
			failures.push(`appendEntry() threw: ${String(error)}`);
		}
	}

	// 4* — entries (optional)
	if (created && adapter.entries) {
		total++;
		try {
			const list = await adapter.entries(created["@id"], 1);
			if (list.length > 1) {
				failures.push("entries(sessionId, limit) did not respect limit");
			}
			for (let i = 1; i < list.length; i++) {
				if (list[i].timestamp_ns < list[i - 1].timestamp_ns) {
					failures.push("entries() not in chronological order");
				}
			}
		} catch (error) {
			failures.push(`entries() threw: ${String(error)}`);
		}
	}

	// 5* — query (optional)
	if (created && adapter.query) {
		total++;
		try {
			const result = await adapter.query({
				participants: ["urn:refarm:conformance"],
			});
			const found = result.some(
				(session) => session["@id"] === created?.["@id"],
			);
			if (!found) {
				failures.push("query({ participants }) did not return created session");
			}
		} catch (error) {
			failures.push(`query() threw: ${String(error)}`);
		}
	}

	const failed = failures.length;
	return { pass: failed === 0, total, failed, failures };
}
