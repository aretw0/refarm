import type { CapabilityTelemetryEvent, Expect, TypesAreEqual } from "@refarm.dev/capability-telemetry-v1";

import { ENRICHMENT_CAPABILITY, type EnrichmentErrorCode, type EnrichmentTelemetryEvent } from "./types.js";

/**
 * Type-level proof, not a runtime check: `EnrichmentTelemetryEvent` (declared
 * as a literal interface in types.ts — see the doc comment there for why)
 * must be structurally IDENTICAL to instantiating
 * `@refarm.dev/capability-telemetry-v1`'s shared `CapabilityTelemetryEvent`
 * skeleton with this contract's own capability constant, operation union,
 * and error-code union — no narrower, no wider. If a future edit changes
 * one side without the other, this fails `tsc`, not silently.
 *
 * DELIBERATELY A SEPARATE FILE, not inlined into types.ts: this repository's
 * reachability gate (`scripts/ci/check-contract-reachability.mjs`) extracts
 * a contract's declared wire fields ONLY from `src/types.ts`, and — to avoid
 * treating a type's own declaration as evidence that something constructs
 * it — blanks the body of every EXPORTED interface/type block it finds
 * there, but only recognizes a plain `interface X { ... }` / `type X = {
 * ... }` block (an unexported alias, or one whose body isn't a literal
 * object, is invisible to that same-file blanking). Keeping this comparison
 * here, in a file the gate scans only as generic evidence (not as a
 * contract's declared-field source), means its own EXPORTED type aliases
 * get blanked correctly wherever they're scanned, without touching
 * types.ts's extraction at all.
 */
export type EnrichmentTelemetryEventShapeProof = Expect<
	TypesAreEqual<
		EnrichmentTelemetryEvent,
		CapabilityTelemetryEvent<
			typeof ENRICHMENT_CAPABILITY,
			"describe" | "select" | "enrich",
			EnrichmentErrorCode
		>
	>
>;
