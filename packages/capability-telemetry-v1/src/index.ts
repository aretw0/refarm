/**
 * The shared skeleton behind every `*TelemetryEvent` type declared by a
 * `packages/*-contract-v1` capability contract (enrichment:v1, identity:v1,
 * source:v1, storage:v1, sync:v1). Each contract's telemetry event was
 * hand-copied from the others — traceId/pluginId/capability/operation/
 * durationMs/ok/errorCode, differing only in which capability constant,
 * which operation union, and which error-code union it carries (`source`
 * additionally carries `kind?: SourceKind`, so a contract can still extend
 * the instantiation with `& { ... }`). Five hand-copied declarations of one
 * skeleton is the "two sources for one answer" defect this repository has
 * found repeatedly (`scripts/ci/check-contract-reachability.mjs`'s first
 * real finding, 2026-08-04); this package expresses the skeleton ONCE,
 * generic over the three points that vary.
 *
 * WHY THIS PACKAGE, AND NOT AN EXISTING ONE (decided from evidence, not
 * preference):
 *
 * - `packages/event-contract-v1` declares `EventBus`/`EventHandler` — the
 *   TRANSPORT (emit/subscribe primitives), not a payload shape; a telemetry
 *   EVENT is data that could ride such a bus, not the bus itself. It is
 *   also `"private": true` (never published to npm), while every one of
 *   the five `*TelemetryEvent` owners (enrichment/identity/source/storage/
 *   sync-contract-v1) is a published, consumer-pulled contract package —
 *   storage/sync/identity are 3 of the 4 zero-runtime-dependency
 *   "kernel-candidate" contracts `docs/2026-07-25-v0.1.0-release-readiness.md`
 *   names as the smallest-safe 0.1.0 release. A published package depending
 *   on a private, unpublished one reproduces "Rope #2" from that same doc,
 *   almost verbatim ("`@refarm.dev/health` has an unpublishable dep... on
 *   publish, `npm install` 404s") — the exact defect class this repo
 *   already found and fixed once. Reusing `event-contract-v1` here would be
 *   dishonest, not neutral.
 * - None of the five `*-contract-v1` packages import anything today
 *   (`dependencies: {}` in every one of their `package.json`s) — they are
 *   deliberately zero-dep leaves. There is no existing shared home among
 *   them to force this into.
 * - This package follows the one precedent that already exists for a
 *   small, zero-dependency, cross-contract primitive shared by leaf
 *   contracts: `@refarm.dev/std` ("zero-dependency pure primitives shared
 *   across the substrate"), already a real dependency of
 *   `skill-contract-v1` and `vault-contract-v1`. Same shape (zero
 *   dependencies of its own), scoped to ONE concern (a telemetry-event
 *   skeleton) instead of general primitives, so `std` does not absorb a
 *   concern it does not own.
 *
 * TRADE-OFF, STATED PLAINLY: this gives `identity-contract-v1`,
 * `storage-contract-v1`, and `sync-contract-v1` — today's three
 * zero-runtime-dependency kernel-candidate contracts — their first
 * workspace dependency. The dependency is type-only: this package exports
 * no runtime values, so its compiled `dist/index.js` is empty and nothing
 * executes at import time. It is not yet listed in `refarm.config.json`'s
 * release-policy selections (`kernel-contracts` / `vault-seed-ready`) —
 * closing that gap is release-policy work, out of scope for this change;
 * disclosed here rather than silently assumed away.
 */

export interface CapabilityTelemetryEvent<
	Capability extends string,
	Operation extends string,
	ErrorCode extends string,
> {
	traceId: string;
	pluginId: string;
	capability: Capability;
	operation: Operation;
	durationMs: number;
	ok: boolean;
	errorCode?: ErrorCode;
}

/**
 * Flattens an intersection (`A & B`) into a single object type with the same
 * members. TypeScript does not do this automatically — `A & B` and an
 * equivalent plain interface are mutually assignable but are NOT the same
 * type node, and the exact-equality check below (which compares type nodes,
 * not assignability) tells them apart otherwise. Needed because
 * `source-contract-v1`'s telemetry event instantiates
 * `CapabilityTelemetryEvent<...> & { kind?: SourceKind }` — an intersection —
 * and must still prove equal to its plain literal interface. Verified
 * directly: without this, `TypesAreEqual<SourceTelemetryEvent,
 * CapabilityTelemetryEvent<...> & { kind?: SourceKind }>` evaluates to
 * `false` despite the two being structurally identical.
 */
type Flatten<T> = T extends object ? { [K in keyof T]: T[K] } : T;

/**
 * Exact type equality — NOT mere structural `extends` in both directions,
 * which can give false positives around optional properties and unions.
 * The double-conditional "distributive homomorphic" form is the standard
 * exact-equality check (the same one `tsd`/type-challenges use), applied to
 * the FLATTENED form of each side so an intersection and an equivalent
 * plain object type compare equal.
 */
export type TypesAreEqual<A, B> = (<T>() => T extends Flatten<A> ? 1 : 2) extends <
	T,
>() => T extends Flatten<B> ? 1 : 2
	? true
	: false;

/**
 * `Expect<true>` compiles silently; `Expect<false>` fails `tsc` with "Type
 * 'false' is not assignable to type 'true'". Each contract pairs this with
 * `TypesAreEqual` right where its telemetry event is declared, so the
 * proof that the generic instantiation still matches the type's
 * pre-refactor shape breaks the BUILD, not just a review, the moment it
 * stops holding.
 */
export type Expect<T extends true> = T;
