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

export function analyzeContextDependencyPressure(map, inventory) {
	const contextByPath = new Map();
	for (const context of map.contexts) {
		for (const path of context.anchors) contextByPath.set(path, context.id);
	}
	const workspaceByName = new Map(inventory.workspaces.map((workspace) => [workspace.name, workspace]));
	const declared = new Set(map.relationships.map((relationship) => `${relationship.from}\0${relationship.to}`));
	const edges = [];
	for (const consumerWorkspace of inventory.workspaces) {
		const consumer = contextByPath.get(consumerWorkspace.path);
		if (!consumer) continue;
		for (const dependencyName of consumerWorkspace.internalDependencies ?? []) {
			const supplierWorkspace = workspaceByName.get(dependencyName);
			const supplier = supplierWorkspace && contextByPath.get(supplierWorkspace.path);
			if (!supplier || supplier === consumer) continue;
			const scopes = consumerWorkspace.internalDependencyScopes?.[dependencyName] ?? ["unknown"];
			edges.push({
				supplier,
				consumer,
				from: supplierWorkspace.path,
				to: consumerWorkspace.path,
				scopes,
				devOnly: scopes.every((scope) => scope === "devDependencies"),
				declared: declared.has(`${supplier}\0${consumer}`),
			});
		}
	}
	edges.sort((left, right) =>
		`${left.supplier}\0${left.consumer}\0${left.from}\0${left.to}`
			.localeCompare(`${right.supplier}\0${right.consumer}\0${right.from}\0${right.to}`));
	const byPair = new Map();
	for (const edge of edges) {
		const key = `${edge.supplier}\0${edge.consumer}`;
		const pair = byPair.get(key) ?? {
			supplier: edge.supplier,
			consumer: edge.consumer,
			declared: edge.declared,
			edges: 0,
			devOnlyEdges: 0,
			scopes: new Set(),
		};
		pair.edges += 1;
		if (edge.devOnly) pair.devOnlyEdges += 1;
		for (const scope of edge.scopes) pair.scopes.add(scope);
		byPair.set(key, pair);
	}
	const pairs = [...byPair.values()].map((pair) => ({
		...pair,
		devOnly: pair.devOnlyEdges === pair.edges,
		scopes: [...pair.scopes].sort(),
	})).sort((left, right) =>
		`${left.supplier}\0${left.consumer}`.localeCompare(`${right.supplier}\0${right.consumer}`));
	return {
		summary: {
			edges: edges.length,
			declaredEdges: edges.filter((edge) => edge.declared).length,
			undeclaredEdges: edges.filter((edge) => !edge.declared).length,
			undeclaredRuntimeEdges: edges.filter((edge) => !edge.declared && !edge.devOnly).length,
			devOnlyEdges: edges.filter((edge) => edge.devOnly).length,
			undeclaredDevOnlyEdges: edges.filter((edge) => !edge.declared && edge.devOnly).length,
			pairs: pairs.length,
			undeclaredPairs: pairs.filter((pair) => !pair.declared).length,
			undeclaredRuntimePairs: pairs.filter((pair) => !pair.declared && !pair.devOnly).length,
			undeclaredDevOnlyPairs: pairs.filter((pair) => !pair.declared && pair.devOnly).length,
		},
		pairs,
		edges,
	};
}

export function contextDependencyPressurePasses(pressure) {
	return pressure.summary.undeclaredRuntimePairs === 0;
}

function codeList(paths) {
	return paths.map((path) => `\`${path}\``).join("<br>");
}

export function renderArchitectureContextMapMarkdown(map, pressure = null) {
	const contexts = [...map.contexts].sort((left, right) => left.id.localeCompare(right.id));
	const relationships = [...map.relationships].sort((left, right) =>
		`${left.from}\0${left.to}`.localeCompare(`${right.from}\0${right.to}`));
	const lines = [
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
	];
	if (pressure) {
		lines.push(
			"## Dependency pressure (observational)",
			"",
			"This compares manifest-level dependencies among authority anchors with the strategic relationships above. An undeclared non-development pair fails the architecture fitness check; development-only pairs remain observations because test composition is not automatically a domain relationship.",
			"",
			`Observed ${pressure.summary.edges} cross-context edges across ${pressure.summary.pairs} pairs. Of the undeclared pressure, ${pressure.summary.undeclaredRuntimeEdges} non-dev edges across ${pressure.summary.undeclaredRuntimePairs} pairs need architectural explanation; ${pressure.summary.undeclaredDevOnlyEdges} edges across ${pressure.summary.undeclaredDevOnlyPairs} pairs are development-only observations.`,
			"",
			"| Supplier context | Consumer context | Manifest edges | Scopes | Declared relationship |",
			"|---|---|---:|---|---|",
			...pressure.pairs.map((pair) => `| \`${pair.supplier}\` | \`${pair.consumer}\` | ${pair.edges} | ${pair.scopes.join(", ")} | ${pair.declared ? "yes" : pair.devOnly ? "no — dev-only observation" : "no — investigate"} |`),
			"",
		);
	}
	lines.push(
		"## Reading rules",
		"",
		"- An anchor has one strategic owner in this map. Other packages may depend on it without acquiring its authority.",
		"- A seam is a contract or ABI through which two contexts integrate; direct imports may exist during migration, but they are not the desired source of shared meaning.",
		"- Unlisted packages are intentionally unclassified. Add them only when ownership or language ambiguity is causing real coordination cost.",
		"- A new non-dev dependency between anchors must use a declared relationship or update the map in the same atomic change.",
		"- Update the JSON source and run `pnpm run architecture:context-map:write`; CI verifies anchors and seams against the repository inventory.",
		"",
	);
	return lines.join("\n");
}
