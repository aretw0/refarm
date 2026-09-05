/**
 * GITHUB COPILOT'S UNDOCUMENTED SURFACE, in one place.
 *
 * ## Why this is a package and not a folder
 *
 * GitHub publishes no supported model API billed against a Copilot subscription, so the shape this
 * speaks cannot be cited from a contract — it is read from behaviour and pinned by tests. That is
 * exactly the kind of knowledge that must live in ONE block: two implementations of an endpoint
 * nobody documents are two places to be wrong about it, and they drift silently because there is no
 * spec to catch the drift.
 *
 * THREE CONSUMERS NEEDED IT and could not share it. The CLI provisions the runtime and renews a
 * seat before handing it over; the daemon renews mid-run; and `apps/farmhand` cannot import from
 * `apps/refarm`. It spent one slice parked inside `@refarm.dev/model-account-contract-v1` as a
 * waypoint (ISS-142), which was the wrong home for the opposite reason: that package is the GENERIC
 * account vocabulary — descriptors, health, resolution, bindings, authorization — and letting one
 * provider's quirks settle there is how a contract package quietly becomes a provider adapter.
 *
 * ## The line
 *
 *     GENERIC (model-account-contract-v1)      PROVIDER (here)
 *     descriptors, health, resolution          the token exchange url and headers
 *     bindings, authorization, precedence      parsing a copilot token's fields
 *     QuotaMeter / AccountQuota vocabulary     deriving the per-seat endpoint from it
 *     isMeterExhausted, provisionableAccounts  the client identities a caller may present
 *
 * VOCABULARY IS GENERIC, PARSING IS PER PROVIDER.
 *
 * NOT NAMED `*-contract-v1`, deliberately: it is an adapter for one provider's undocumented
 * surface, it has no conformance suite to offer, and that name would trip the ratchet ISS-137
 * planted — correctly.
 *
 * PURE. No network, no credential, no login. The I/O belongs to whoever calls this.
 */
export * from "./identity.js";
export * from "./quota.js";
export * from "./wire.js";
