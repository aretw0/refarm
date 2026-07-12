/**
 * The THREADING core: resolve `{{ path }}` references in a step's `with` against a scope (the
 * initial input plus earlier steps' saved results). This is what lets one step's output feed
 * the next — the piece refarm's Effort `tasks[]` lack (they run independently).
 *
 * Two forms, so types are preserved when they matter:
 *  - a string that is EXACTLY `{{ path }}` resolves to the raw value at that path (which may be
 *    an object/array/number — e.g. `records: "{{ pulled.records }}"` passes the array through),
 *  - a string with `{{ path }}` embedded in other text does string substitution (stringifying).
 * Nested objects/arrays in `with` are interpolated recursively.
 */

const EXACT_REF = /^\{\{\s*([^}]+?)\s*\}\}$/;
const EMBEDDED_REF = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Resolve a dotted path (`a.b.0.c`) against a scope. Returns undefined if any segment is
 * missing. Array indices are numeric segments. */
export function resolvePath(scope: unknown, path: string): unknown {
	const segments = path
		.split(".")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	let cursor: unknown = scope;
	for (const segment of segments) {
		if (cursor == null) return undefined;
		if (typeof cursor !== "object") return undefined;
		cursor = (cursor as Record<string, unknown>)[segment];
	}
	return cursor;
}

function interpolateString(value: string, scope: unknown): unknown {
	const exact = EXACT_REF.exec(value);
	if (exact?.[1]) {
		return resolvePath(scope, exact[1]); // raw value, type preserved
	}
	return value.replace(EMBEDDED_REF, (_, path: string) => {
		const resolved = resolvePath(scope, path.trim());
		if (resolved == null) return "";
		return typeof resolved === "object" ? JSON.stringify(resolved) : String(resolved);
	});
}

/** Recursively interpolate every string in a value against the scope. */
export function interpolate(value: unknown, scope: unknown): unknown {
	if (typeof value === "string") return interpolateString(value, scope);
	if (Array.isArray(value)) return value.map((item) => interpolate(item, scope));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
			out[key] = interpolate(val, scope);
		}
		return out;
	}
	return value;
}
