import type { CapabilityTelemetryEvent, Expect, TypesAreEqual } from "@refarm.dev/capability-telemetry-v1";

import { STORAGE_CAPABILITY, type StorageErrorCode, type StorageTelemetryEvent } from "./types.js";

/**
 * Type-level proof, not a runtime check: `StorageTelemetryEvent` (declared
 * as a literal interface in types.ts — see the doc comment there for why)
 * must be structurally IDENTICAL to instantiating
 * `@refarm.dev/capability-telemetry-v1`'s shared `CapabilityTelemetryEvent`
 * skeleton with this contract's own capability constant, operation union,
 * and error-code union — no narrower, no wider. If a future edit changes
 * one side without the other, this fails `tsc`, not silently.
 *
 * DELIBERATELY A SEPARATE FILE — see enrichment-contract-v1's
 * src/telemetry-shape-proof.ts for why this can't be inlined into types.ts
 * without breaking scripts/ci/check-contract-reachability.mjs's extraction.
 */
export type StorageTelemetryEventShapeProof = Expect<
	TypesAreEqual<
		StorageTelemetryEvent,
		CapabilityTelemetryEvent<
			typeof STORAGE_CAPABILITY,
			"get" | "put" | "put_many" | "delete" | "delete_many" | "query",
			StorageErrorCode
		>
	>
>;
