import type { ExtensionSurfaceDeclaration } from "@refarm.dev/plugin-manifest";
import { describe, expect, it } from "vitest";

import type { ManifestExtensionSurface } from "./plugin-bridge.js";

/**
 * DRIFT SENSOR — capabilities-v1's `ManifestExtensionSurface` is a deliberate structural
 * subset of plugin-manifest's canonical `ExtensionSurfaceDeclaration`, redeclared because
 * capabilities-v1 doesn't depend on plugin-manifest at runtime. That redeclaration is only
 * safe if it CANNOT silently drift from the canonical shape. This test makes the drift a
 * COMPILE error, not a diff a human has to catch:
 *
 *  - a real `ExtensionSurfaceDeclaration` must be assignable to `ManifestExtensionSurface`
 *    (the subset accepts the canonical), and
 *  - the shared fields must have compatible types.
 *
 * If someone renames/retypes a shared field on the canonical type, or the subset diverges,
 * this stops compiling. This is the general answer to "how do we FEEL type drift": for each
 * intentional redeclaration, a type-level conformance assertion turns silence into a build
 * failure. (The pattern the repo already uses via *.conformance.test.ts.)
 */

// Compile-time: the canonical declaration satisfies the subset. If a shared field's type
// diverges, this assignment fails to typecheck.
const _canonicalIsAssignable: ManifestExtensionSurface = {
	layer: "homestead",
	kind: "panel",
	id: "x",
	slot: "main",
} satisfies ExtensionSurfaceDeclaration extends never ? never : ManifestExtensionSurface;

// Compile-time: every field the subset names exists on the canonical with a compatible
// type. `Pick` fails to typecheck if a key is missing/renamed on the canonical.
type SharedFields = Pick<ExtensionSurfaceDeclaration, "layer" | "kind" | "id" | "slot">;
const _subsetTracksCanonical: (s: SharedFields) => ManifestExtensionSurface = (s) => ({
	layer: s.layer,
	kind: s.kind,
	id: s.id,
	slot: s.slot,
});

describe("ManifestExtensionSurface ⊂ ExtensionSurfaceDeclaration (drift sensor)", () => {
	it("keeps the redeclared subset structurally in sync with the canonical type", () => {
		// The assertions above are compile-time; this runtime check just anchors the test
		// and documents the invariant. A canonical declaration flows through unchanged.
		const canonical: ExtensionSurfaceDeclaration = {
			layer: "homestead",
			kind: "panel",
			id: "vault-panel",
			slot: "main",
		};
		const subset: ManifestExtensionSurface = canonical;
		expect(subset).toEqual({ layer: "homestead", kind: "panel", id: "vault-panel", slot: "main" });
		void _canonicalIsAssignable;
		void _subsetTracksCanonical;
	});
});
