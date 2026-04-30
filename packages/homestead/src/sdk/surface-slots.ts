import {
	getExtensionSurfaces,
	type ExtensionSurfaceDeclaration,
	type PluginManifest,
} from "@refarm.dev/plugin-manifest";

export const DEFAULT_HOMESTEAD_SURFACE_CAPABILITIES = new Set([
	"ui:panel:render",
	"ui:stream:read",
]);

export interface HomesteadSurfaceSlotOptions {
	allowedCapabilities?: ReadonlySet<string> | readonly string[];
	availableSlots?: ReadonlySet<string> | readonly string[];
}

export interface HomesteadSurfaceMount {
	slotId: string;
	source: "legacy-ui-slot" | "extension-surface";
	surface?: ExtensionSurfaceDeclaration;
}

export type HomesteadSurfaceRejectionReason =
	| "missing-slot"
	| "unknown-slot"
	| "unsupported-capability"
	| "duplicate-surface-id";

export interface HomesteadSurfaceRejection {
	reason: HomesteadSurfaceRejectionReason;
	surface: ExtensionSurfaceDeclaration;
	missingCapabilities?: string[];
}

export interface HomesteadSurfaceActivationPlan {
	mounts: HomesteadSurfaceMount[];
	rejected: HomesteadSurfaceRejection[];
}

/**
 * Resolve Homestead shell slots from both the legacy `ui.slots` field and the
 * additive multi-surface manifest contract.
 */
export function resolveHomesteadSurfaceSlots(
	manifest: PluginManifest,
	options: HomesteadSurfaceSlotOptions = {},
): string[] {
	const slots = new Set<string>();
	for (const mount of resolveHomesteadSurfaceMounts(manifest, options)) {
		slots.add(mount.slotId);
	}
	return [...slots];
}

/**
 * Resolve mount descriptors for Homestead. Hosts can use these descriptors to
 * preserve surface identity (`layer:id`) while still supporting legacy slots.
 */
export function resolveHomesteadSurfaceMounts(
	manifest: PluginManifest,
	options: HomesteadSurfaceSlotOptions = {},
): HomesteadSurfaceMount[] {
	return resolveHomesteadSurfaceActivationPlan(manifest, options).mounts;
}

/**
 * Resolve mountable Homestead surfaces plus explicit rejections. The shell uses
 * this plan to keep discovery deterministic while emitting auditable telemetry
 * for surfaces that were declared but not activated.
 */
export function resolveHomesteadSurfaceActivationPlan(
	manifest: PluginManifest,
	options: HomesteadSurfaceSlotOptions = {},
): HomesteadSurfaceActivationPlan {
	const mounts: HomesteadSurfaceMount[] = [];
	const rejected: HomesteadSurfaceRejection[] = [];
	const legacySlots = new Set<string>();
	const surfaceIds = new Set<string>();
	const allowedCapabilities = normalizeAllowedCapabilities(
		options.allowedCapabilities,
	);
	const availableSlots = normalizeAvailableSlots(options.availableSlots);

	for (const slotId of manifest.ui?.slots ?? []) {
		if (typeof slotId === "string" && slotId.trim().length > 0) {
			legacySlots.add(slotId);
		}
	}
	for (const slotId of legacySlots) {
		if (availableSlots && !availableSlots.has(slotId)) continue;
		mounts.push({ slotId, source: "legacy-ui-slot" });
	}

	for (const surface of getExtensionSurfaces(manifest, "homestead")) {
		if (surface.slot === undefined || surface.slot.trim().length === 0) {
			rejected.push({ reason: "missing-slot", surface });
			continue;
		}

		if (availableSlots && !availableSlots.has(surface.slot)) {
			rejected.push({ reason: "unknown-slot", surface });
			continue;
		}

		const missingCapabilities = unsupportedHomesteadSurfaceCapabilities(
			surface,
			allowedCapabilities,
		);
		if (missingCapabilities.length > 0) {
			rejected.push({
				reason: "unsupported-capability",
				surface,
				missingCapabilities,
			});
			continue;
		}

		if (surfaceIds.has(surface.id)) {
			rejected.push({ reason: "duplicate-surface-id", surface });
			continue;
		}
		surfaceIds.add(surface.id);
		mounts.push({
			slotId: surface.slot,
			source: "extension-surface",
			surface,
		});
	}

	return { mounts, rejected };
}

function normalizeAllowedCapabilities(
	capabilities: HomesteadSurfaceSlotOptions["allowedCapabilities"],
): ReadonlySet<string> {
	if (capabilities instanceof Set) return capabilities;
	return new Set(capabilities ?? DEFAULT_HOMESTEAD_SURFACE_CAPABILITIES);
}

function normalizeAvailableSlots(
	slots: HomesteadSurfaceSlotOptions["availableSlots"],
): ReadonlySet<string> | undefined {
	if (!slots) return undefined;
	return slots instanceof Set ? slots : new Set(slots);
}

export function unsupportedHomesteadSurfaceCapabilities(
	surface: ExtensionSurfaceDeclaration,
	allowedCapabilities: ReadonlySet<string>,
): string[] {
	return (surface.capabilities ?? []).filter(
		(capability) => !allowedCapabilities.has(capability),
	);
}
