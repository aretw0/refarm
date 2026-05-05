const OLD_SESSION_PREFIX = "urn:pi-agent:session-";
const OLD_ENTRY_PREFIX = "urn:pi-agent:entry-";
const NEW_SESSION_PREFIX = "urn:refarm:session:v1:";
const NEW_ENTRY_PREFIX = "urn:refarm:session-entry:v1:";

function rewritePiAgentUrn(value) {
	if (typeof value !== "string") {
		return { value, changed: false };
	}

	if (value.startsWith(OLD_SESSION_PREFIX)) {
		return {
			value: `${NEW_SESSION_PREFIX}${value.slice(OLD_SESSION_PREFIX.length)}`,
			changed: true,
		};
	}

	if (value.startsWith(OLD_ENTRY_PREFIX)) {
		return {
			value: `${NEW_ENTRY_PREFIX}${value.slice(OLD_ENTRY_PREFIX.length)}`,
			changed: true,
		};
	}

	return { value, changed: false };
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function migrateByKey(value, keyHint) {
	if (Array.isArray(value)) {
		let changed = false;
		const migrated = value.map((item) => {
			const result = migrateByKey(item, keyHint);
			if (result.changed) changed = true;
			return result.value;
		});
		return { value: migrated, changed };
	}

	if (isPlainObject(value)) {
		let changed = false;
		const migrated = {};
		for (const [key, child] of Object.entries(value)) {
			const result = migrateByKey(child, key);
			migrated[key] = result.value;
			if (result.changed) changed = true;
		}
		return { value: migrated, changed };
	}

	const shouldRewrite =
		keyHint === "@id" ||
		keyHint === "context_id" ||
		keyHint === "leaf_entry_id" ||
		keyHint === "parent_session_id" ||
		keyHint === "parent_entry_id" ||
		keyHint === "session_id" ||
		(typeof keyHint === "string" && keyHint.endsWith("_id"));

	if (!shouldRewrite) {
		return { value, changed: false };
	}

	return rewritePiAgentUrn(value);
}

export function migratePiAgentSessionNode(node) {
	if (!isPlainObject(node)) {
		return {
			node,
			changed: false,
			idRewrites: 0,
			referenceRewrites: 0,
		};
	}

	const { value: migrated, changed } = migrateByKey(node, null);
	if (!changed) {
		return {
			node,
			changed: false,
			idRewrites: 0,
			referenceRewrites: 0,
		};
	}

	const before = node;
	const after = migrated;
	const idRewrites =
		typeof before["@id"] === "string" && before["@id"] !== after["@id"] ? 1 : 0;

	const fields = [
		"session_id",
		"parent_entry_id",
		"leaf_entry_id",
		"parent_session_id",
		"context_id",
	];
	let referenceRewrites = 0;
	for (const field of fields) {
		if (
			typeof before[field] === "string" &&
			typeof after[field] === "string" &&
			before[field] !== after[field]
		) {
			referenceRewrites += 1;
		}
	}

	return {
		node: after,
		changed: true,
		idRewrites,
		referenceRewrites,
	};
}

export function migratePiAgentSessionNodes(nodes) {
	const report = {
		total: Array.isArray(nodes) ? nodes.length : 0,
		migrated: 0,
		idRewrites: 0,
		referenceRewrites: 0,
	};

	if (!Array.isArray(nodes)) {
		return { nodes: [], report };
	}

	const migratedNodes = nodes.map((node) => {
		const migrated = migratePiAgentSessionNode(node);
		if (migrated.changed) {
			report.migrated += 1;
			report.idRewrites += migrated.idRewrites;
			report.referenceRewrites += migrated.referenceRewrites;
		}
		return migrated.node;
	});

	return { nodes: migratedNodes, report };
}
