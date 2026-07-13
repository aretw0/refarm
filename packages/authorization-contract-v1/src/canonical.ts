/** Deterministic JSON serialization (sorted keys, recursive) — the exact bytes a proof is
 * computed over, so signing and verifying agree regardless of key order. Mirrors the
 * credentials contract's canonicalJson so authorization + credential proofs are consistent. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => sortJson(item));
	}
	if (value && typeof value === "object") {
		const input = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(input)
				.sort()
				.map((key) => [key, sortJson(input[key])]),
		);
	}
	return value;
}
