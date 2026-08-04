import type { CapabilityTelemetryEvent, Expect, TypesAreEqual } from "@refarm.dev/capability-telemetry-v1";

import {
	SOURCE_CAPABILITY,
	type SourceErrorCode,
	type SourceKind,
	type SourceTelemetryEvent,
} from "./types.js";

/**
 * Type-level proof, not a runtime check: `SourceTelemetryEvent` (declared as
 * a literal interface in types.ts — see the doc comment there for why) must
 * be structurally IDENTICAL to instantiating
 * `@refarm.dev/capability-telemetry-v1`'s shared `CapabilityTelemetryEvent`
 * skeleton with this contract's own capability constant, operation union,
 * and error-code union, intersected with `{ kind?: SourceKind }` — the one
 * field this contract adds beyond the shared skeleton. No narrower, no
 * wider. If a future edit changes one side without the other, this fails
 * `tsc`, not silently.
 *
 * DELIBERATELY A SEPARATE FILE — see enrichment-contract-v1's
 * src/telemetry-shape-proof.ts for why this can't be inlined into types.ts
 * without breaking scripts/ci/check-contract-reachability.mjs's extraction.
 */
export type SourceTelemetryEventShapeProof = Expect<
	TypesAreEqual<
		SourceTelemetryEvent,
		CapabilityTelemetryEvent<
			typeof SOURCE_CAPABILITY,
			"resolve" | "materialize" | "status" | "refresh" | "discover",
			SourceErrorCode
		> & { kind?: SourceKind }
	>
>;
