/**
 * Pure hash helpers — the runtime-agnostic core. The actual SHA-256 digest is node/web specific
 * (node:crypto vs crypto.subtle), so it is INJECTED here; a node convenience lives in the `/node`
 * subpath. Before this, ~6 sites re-`createHash("sha256")…digest("hex")` independently, with
 * divergent `sha256-`/`sha256:`/bare-hex prefix conventions; this standardizes on bare lowercase hex.
 */

/** Lowercase-hex SHA-256 shape guard (exactly 64 hex chars). */
export function isSha256Hex(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Constant-time comparison of two lowercase-hex strings. A hash check should not leak, via timing,
 * how many leading characters matched — cheap insurance when the bytes are attacker-influenced.
 */
export function timingSafeHexEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i += 1) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}
