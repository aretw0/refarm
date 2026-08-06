function duplicates(values) {
	return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}

export function validateArchitectureContextMap(map, inventory) {
	const violations = [];
	if (map?.schemaVersion !== 1) violations.push({ id: "unsupported-schema-version" });
	if (map?.status !== "provisional") violations.push({ id: "map-status-must-be-provisional" });
	if (map?.direction !== "upstream-to-downstream") violations.push({ id: "unknown-relationship-direction" });
	const contexts = Array.isArray(map?.contexts) ? map.contexts : [];
	const relationships = Array.isArray(map?.relationships) ? map.relationships : [];
	const contextIds = contexts.map((context) => context.id);
	for (const id of duplicates(contextIds)) violations.push({ id: "duplicate-context-id", context: id });
	const knownContexts = new Set(contextIds);
	const knownPaths = new Set(inventory.workspaces.map((workspace) => workspace.path));
	const anchorOwners = new Map();

	for (const context of contexts) {
		if (!context.id || !context.name || !context.purpose) {
			violations.push({ id: "incomplete-context", context: context.id ?? null });
		}
		if (!["established-boundary", "candidate-boundary"].includes(context.maturity)) {
			violations.push({ id: "unknown-context-maturity", context: context.id });
		}
		for (const path of context.anchors ?? []) {
			if (!knownPaths.has(path)) violations.push({ id: "unknown-anchor", context: context.id, path });
			const owner = anchorOwners.get(path);
			if (owner) violations.push({ id: "ambiguous-anchor-owner", path, contexts: [owner, context.id].sort() });
			else anchorOwners.set(path, context.id);
		}
	}

	const relationshipKeys = [];
	for (const relationship of relationships) {
		if (!knownContexts.has(relationship.from)) violations.push({ id: "unknown-upstream-context", context: relationship.from });
		if (!knownContexts.has(relationship.to)) violations.push({ id: "unknown-downstream-context", context: relationship.to });
		if (relationship.from === relationship.to) violations.push({ id: "self-context-relationship", context: relationship.from });
		if (!relationship.kind) violations.push({ id: "relationship-kind-required", from: relationship.from, to: relationship.to });
		if (!Array.isArray(relationship.seams) || relationship.seams.length === 0) {
			violations.push({ id: "relationship-seam-required", from: relationship.from, to: relationship.to });
		}
		for (const path of relationship.seams ?? []) {
			if (!knownPaths.has(path)) violations.push({ id: "unknown-relationship-seam", path });
		}
		relationshipKeys.push(`${relationship.from}\0${relationship.to}\0${relationship.kind}`);
	}
	for (const key of duplicates(relationshipKeys)) violations.push({ id: "duplicate-relationship", key });

	return { ok: violations.length === 0, violations };
}

function codeList(paths) {
	return paths.map((path) => `\`${path}\``).join("<br>");
}

export function renderArchitectureContextMapMarkdown(map) {
	const contexts = [...map.contexts].sort((left, right) => left.id.localeCompare(right.id));
	const relationships = [...map.relationships].sort((left, right) =>
		`${left.from}\0${left.to}`.localeCompare(`${right.from}\0${right.to}`));
	return [
		"# Architecture Context Map",
		"",
		"> Provisional strategic map generated from `architecture-context-map.v1.json`.",
		"> It identifies authority anchors and integration seams; it does not classify every package as a bounded context.",
		"",
		"Read relationships from upstream supplier to downstream consumer. `established-boundary` means an accepted contract or ADR already defines the separation; `candidate-boundary` is a useful current grouping that still needs pressure from implementation and additional consumers.",
		"",
		"## Contexts",
		"",
		"| Context | Maturity | Purpose | Authority anchors |",
		"|---|---|---|---|",
		...contexts.map((context) => `| **${context.name}**<br>\`${context.id}\` | ${context.maturity} | ${context.purpose} | ${codeList(context.anchors)} |`),
		"",
		"## Relationships",
		"",
		"| Upstream | Downstream | Relationship | Explicit seams |",
		"|---|---|---|---|",
		...relationships.map((relationship) => `| \`${relationship.from}\` | \`${relationship.to}\` | ${relationship.kind} | ${codeList(relationship.seams)} |`),
		"",
		"## Reading rules",
		"",
		"- An anchor has one strategic owner in this map. Other packages may depend on it without acquiring its authority.",
		"- A seam is a contract or ABI through which two contexts integrate; direct imports may exist during migration, but they are not the desired source of shared meaning.",
		"- Unlisted packages are intentionally unclassified. Add them only when ownership or language ambiguity is causing real coordination cost.",
		"- Update the JSON source and run `pnpm run architecture:context-map:write`; CI verifies anchors and seams against the repository inventory.",
		"",
	].join("\n");
}
