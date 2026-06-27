import { surfaceMapIds, validateSurfaceMapEnvelope } from "./envelope.mjs";

export function renderFallbackHtml(envelope) {
	assertEnvelope(envelope);
	return [
		`<section class="xr-fallback" data-refarm-xr-fallback data-schema="${escapeAttr(envelope.schema)}">`,
		`  <h1>${escapeHtml(envelope.title)}</h1>`,
		'  <ol class="xr-fallback__nodes">',
		...envelope.nodes.map(
			(node) =>
				`    <li data-node-id="${escapeAttr(node.id)}"><strong>${escapeHtml(node.label)}</strong><span>${escapeHtml(node.kind)}</span></li>`,
		),
		"  </ol>",
		'  <nav class="xr-fallback__actions" aria-label="Surface actions">',
		...envelope.actions.map(
			(action) =>
				`    <button type="button" data-action-id="${escapeAttr(action.id)}" data-target-node-id="${escapeAttr(action.targetNodeId)}">${escapeHtml(action.label)}</button>`,
		),
		"  </nav>",
		"</section>",
	].join("\n");
}

export function renderAFrameScene(envelope) {
	assertEnvelope(envelope);
	const positions = envelope.nodes.map((node, index) => ({
		node,
		x: (index - (envelope.nodes.length - 1) / 2) * 1.8,
		y: 1.5,
		z: -3,
	}));

	return [
		`<a-scene embedded data-refarm-xr-scene data-schema="${escapeAttr(envelope.schema)}">`,
		...positions.map(
			({ node, x, y, z }) =>
				`  <a-box data-node-id="${escapeAttr(node.id)}" position="${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}" depth="0.4" height="0.4" width="0.4"></a-box>`,
		),
		...positions.map(
			({ node, x, y, z }) =>
				`  <a-text data-node-label-id="${escapeAttr(node.id)}" value="${escapeAttr(node.label)}" position="${x.toFixed(1)} ${(y - 0.5).toFixed(1)} ${z.toFixed(1)}" align="center"></a-text>`,
		),
		...envelope.actions.map(
			(action, index) =>
				`  <a-entity data-action-id="${escapeAttr(action.id)}" data-target-node-id="${escapeAttr(action.targetNodeId)}" position="${(-1 + index * 2).toFixed(1)} 0.3 -2.5"></a-entity>`,
		),
		"</a-scene>",
	].join("\n");
}

export function renderedSurfaceIds(envelope, fallbackHtml, xrSceneHtml) {
	const expected = surfaceMapIds(envelope);
	return {
		expected,
		fallback: extractIds(fallbackHtml),
		xr: extractIds(xrSceneHtml),
	};
}

function assertEnvelope(envelope) {
	const issues = validateSurfaceMapEnvelope(envelope);
	if (issues.length > 0) {
		throw new Error(`Invalid XR surface envelope: ${issues.join("; ")}`);
	}
}

function extractIds(markup) {
	return {
		nodes: [...markup.matchAll(/data-node-id="([^"]+)"/g)].map((match) => match[1]).sort(),
		actions: [...markup.matchAll(/data-action-id="([^"]+)"/g)].map((match) => match[1]).sort(),
	};
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function escapeAttr(value) {
	return escapeHtml(value).replaceAll('"', "&quot;");
}
