import { createHash } from "node:crypto";

/**
 * Node-flavored hash convenience (imports node:crypto, so kept out of the pure index — import from
 * `@refarm.dev/std/node`). This is the one `createHash("sha256").digest("hex")` the substrate's
 * node consumers should share instead of re-writing it.
 */

/** Lowercase-hex SHA-256 of the given bytes or string, via node:crypto. */
export function sha256Hex(input: Uint8Array | string): string {
	return createHash("sha256").update(input).digest("hex");
}
