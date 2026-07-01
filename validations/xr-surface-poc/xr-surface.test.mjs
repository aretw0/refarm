import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { surfaceMapIds, validateSurfaceMapEnvelope } from "./src/envelope.mjs";
import { probeWebXrCapability } from "./src/probe.mjs";
import {
	renderAFrameScene,
	renderFallbackHtml,
	renderedSurfaceIds,
} from "./src/renderers.mjs";

const fixture = JSON.parse(
	readFileSync(path.join(import.meta.dirname, "fixture/refarm-surface-map.json"), "utf8"),
);

test("fixture is a renderer-neutral Refarm surface map", () => {
	assert.deepEqual(validateSurfaceMapEnvelope(fixture), []);
	assert.deepEqual(surfaceMapIds(fixture), {
		nodes: ["dispatch-surface", "ds", "ds-html", "release-engine"],
		links: [
			"dispatch-surface->ds-html:actions",
			"ds->ds-html:styles",
			"release-engine->dispatch-surface:handoff",
		],
		actions: ["inspect-surface", "open-release-plan"],
	});
});

test("WebXR probe reports unsupported when navigator.xr is absent", async () => {
	const payload = await probeWebXrCapability({
		navigatorLike: {},
		isSecureContext: true,
	});

	assert.equal(payload.ok, true);
	assert.equal(payload.schema, "refarm.webxr_capability.v1");
	assert.equal(payload.status, "unsupported");
	assert.equal(payload.fallback, "homestead-2d");
});

test("WebXR probe reports blocked in insecure contexts", async () => {
	const payload = await probeWebXrCapability({
		navigatorLike: {
			xr: {
				isSessionSupported: async () => true,
			},
		},
		isSecureContext: false,
	});

	assert.equal(payload.status, "blocked");
	assert.equal(payload.secureContext, false);
});

test("WebXR probe reports supported when the requested mode is available", async () => {
	const payload = await probeWebXrCapability({
		navigatorLike: {
			xr: {
				isSessionSupported: async (mode) => mode === "immersive-vr",
			},
		},
		isSecureContext: true,
		sessionMode: "immersive-vr",
	});

	assert.equal(payload.status, "supported");
	assert.equal(payload.apiPresent, true);
});

test("2D fallback and XR scene consume the same fixture ids", () => {
	const fallbackHtml = renderFallbackHtml(fixture);
	const xrSceneHtml = renderAFrameScene(fixture);
	const ids = renderedSurfaceIds(fixture, fallbackHtml, xrSceneHtml);

	assert.deepEqual(ids.fallback.nodes, ids.expected.nodes);
	assert.deepEqual(ids.xr.nodes, ids.expected.nodes);
	assert.deepEqual(ids.fallback.actions, ids.expected.actions);
	assert.deepEqual(ids.xr.actions, ids.expected.actions);
	assert.match(fallbackHtml, /data-refarm-xr-fallback/);
	assert.match(xrSceneHtml, /data-refarm-xr-scene/);
});
