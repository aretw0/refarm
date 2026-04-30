import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createMockManifest } from "./fixtures";
import {
	extensionSurfaceKey,
	getExtensionSurfaces,
	isExtensionSurfaceLayer,
} from "./extension-surfaces";
import { validatePluginManifest } from "./validate";

describe("extension surface helpers", () => {
	it("filters manifest surfaces by layer without mutating the manifest", () => {
		const manifest = createMockManifest({
			extensions: {
				surfaces: [
					{
						layer: "homestead",
						kind: "panel",
						id: "stream-panel",
						slot: "main",
					},
					{
						layer: "automation",
						kind: "workflow-step",
						id: "rotate-theme",
					},
				],
			},
		});

		const homesteadSurfaces = getExtensionSurfaces(manifest, "homestead");
		const allSurfaces = getExtensionSurfaces(manifest);

		expect(homesteadSurfaces).toHaveLength(1);
		expect(homesteadSurfaces[0].id).toBe("stream-panel");
		expect(allSurfaces).toHaveLength(2);
		expect(allSurfaces).not.toBe(manifest.extensions?.surfaces);
	});

	it("builds stable layer/id keys and guards known layers", () => {
		expect(
			extensionSurfaceKey({
				layer: "pi",
				kind: "tool",
				id: "local-file-tool",
			}),
		).toBe("pi:local-file-tool");
		expect(isExtensionSurfaceLayer("desktop")).toBe(true);
		expect(isExtensionSurfaceLayer("unknown")).toBe(false);
	});

	it("keeps the multi-surface example manifest valid", () => {
		const manifest = JSON.parse(
			readFileSync(
				new URL(
					"../../../examples/multi-surface-plugin/plugin-manifest.json",
					import.meta.url,
				),
				"utf8",
			),
		);

		const result = validatePluginManifest(manifest);
		expect(result.valid).toBe(true);
		expect(getExtensionSurfaces(manifest).map(extensionSurfaceKey)).toEqual([
			"homestead:stream-panel",
			"asset:stream-theme-assets",
			"automation:summarize-terminal-stream",
		]);
	});
});
