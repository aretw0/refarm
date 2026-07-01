export function validateSurfaceMapEnvelope(envelope) {
	const issues = [];
	if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
		return ["envelope must be an object"];
	}
	if (envelope.schema !== "refarm.xr_surface_fixture.v1") {
		issues.push("schema must be refarm.xr_surface_fixture.v1");
	}
	if (typeof envelope.title !== "string" || envelope.title.length === 0) {
		issues.push("title must be a non-empty string");
	}
	if (!Array.isArray(envelope.nodes) || envelope.nodes.length === 0) {
		issues.push("nodes must be a non-empty array");
	}
	if (!Array.isArray(envelope.links)) {
		issues.push("links must be an array");
	}
	if (!Array.isArray(envelope.actions)) {
		issues.push("actions must be an array");
	}

	const nodeIds = new Set();
	for (const [index, node] of (envelope.nodes || []).entries()) {
		if (!node || typeof node !== "object") {
			issues.push(`nodes[${index}] must be an object`);
			continue;
		}
		if (typeof node.id !== "string" || node.id.length === 0) {
			issues.push(`nodes[${index}].id must be a non-empty string`);
		} else if (nodeIds.has(node.id)) {
			issues.push(`duplicate node id: ${node.id}`);
		} else {
			nodeIds.add(node.id);
		}
		if (typeof node.label !== "string" || node.label.length === 0) {
			issues.push(`nodes[${index}].label must be a non-empty string`);
		}
		if (typeof node.kind !== "string" || node.kind.length === 0) {
			issues.push(`nodes[${index}].kind must be a non-empty string`);
		}
	}

	for (const [index, link] of (envelope.links || []).entries()) {
		if (!nodeIds.has(link?.from)) {
			issues.push(`links[${index}].from must reference a node`);
		}
		if (!nodeIds.has(link?.to)) {
			issues.push(`links[${index}].to must reference a node`);
		}
		if (typeof link?.relation !== "string" || link.relation.length === 0) {
			issues.push(`links[${index}].relation must be a non-empty string`);
		}
	}

	for (const [index, action] of (envelope.actions || []).entries()) {
		if (typeof action?.id !== "string" || action.id.length === 0) {
			issues.push(`actions[${index}].id must be a non-empty string`);
		}
		if (!nodeIds.has(action?.targetNodeId)) {
			issues.push(`actions[${index}].targetNodeId must reference a node`);
		}
	}

	return issues;
}

export function surfaceMapIds(envelope) {
	return {
		nodes: envelope.nodes.map((node) => node.id).sort(),
		links: envelope.links.map((link) => `${link.from}->${link.to}:${link.relation}`).sort(),
		actions: envelope.actions.map((action) => action.id).sort(),
	};
}
