export { slugify, type SlugifyOptions } from "./slug.js";
export { isSha256Hex, timingSafeHexEqual } from "./hash.js";
export {
	assertBindAllowed,
	bindHostsMatch,
	DEFAULT_BIND_HOST,
	isLoopbackBindHost,
	refuseUnguardedNonLoopbackBind,
	type BindDecision,
} from "./bind-guard.js";
export {
	anySurfaceDeclaresDeviceTokenGate,
	KNOWN_SURFACES,
	parseSurfaces,
	refuseBindOutsideDeclaration,
	refuseGateThisListenerCannotEnforce,
	resolveDeclaredBindHost,
	resolveDeclaredSurfaceBind,
	SURFACE_CAPABILITIES,
	SURFACE_DAEMON_WS,
	SURFACE_SIDECAR_HTTP,
	SURFACE_WEB,
	SurfaceDeclarationError,
	surfaceEnforceableGate,
	type ResolveDeclaredSurfaceBindInput,
	type SurfaceBindResolution,
	type SurfaceCatalog,
	type SurfaceDeclaration,
	type SurfaceExpose,
	type SurfaceGate,
	type TailnetSelfResolution,
} from "./surfaces.js";
