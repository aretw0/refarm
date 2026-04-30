const ALL_EXTENSION_SURFACE_LAYERS = [
	"tractor",
	"homestead",
	"pi",
	"automation",
	"desktop",
	"asset",
];

/** @type {ReadonlySet<import('./types.js').ExtensionSurfaceLayer>} */
export const EXTENSION_SURFACE_LAYERS = new Set(ALL_EXTENSION_SURFACE_LAYERS);

/**
 * @param {unknown} layer
 * @returns {layer is import('./types.js').ExtensionSurfaceLayer}
 */
export function isExtensionSurfaceLayer(layer) {
	return typeof layer === "string" && EXTENSION_SURFACE_LAYERS.has(layer);
}

/**
 * @param {import('./types.js').ExtensionSurfaceDeclaration} surface
 * @returns {string}
 */
export function extensionSurfaceKey(surface) {
	return `${surface.layer}:${surface.id}`;
}

/**
 * @param {import('./types.js').PluginManifest} manifest
 * @param {import('./types.js').ExtensionSurfaceLayer} [layer]
 * @returns {import('./types.js').ExtensionSurfaceDeclaration[]}
 */
export function getExtensionSurfaces(manifest, layer) {
	const surfaces = manifest.extensions?.surfaces ?? [];
	if (layer === undefined) return [...surfaces];
	return surfaces.filter((surface) => surface.layer === layer);
}
