/**
 * Canonical process-lifetime cache primitive.
 *
 * Several values are stable for a process's lifetime but expensive to resolve
 * (the refarm version, the sidecar URL). Each was memoized ad-hoc with a bare
 * module-level `let cached; export resetX()` — and every test that exercised the
 * cached path had to remember to call that specific reset, or leak state into the
 * next test. This centralizes both concerns: a cache built here self-registers,
 * so a single {@link resetAllProcessCaches} (wired into the vitest global
 * beforeEach) clears every process cache at once. New process caches use this
 * factory and get reset-on-test for free — no per-suite reset, no new reset fn to
 * remember.
 */

const registry = new Set<() => void>();

export interface ProcessCache<T> {
	/** The memoized value, or undefined until first set. */
	get(): T | undefined;
	/** Memoize a value. */
	set(value: T): T;
	/** Drop the memoized value (also invoked by resetAllProcessCaches). */
	clear(): void;
}

/**
 * Create a process-lifetime cache for one value. It registers its own clear() so
 * {@link resetAllProcessCaches} resets it — callers never wire a bespoke reset.
 */
export function makeProcessCache<T>(): ProcessCache<T> {
	let value: T | undefined;
	const cache: ProcessCache<T> = {
		get: () => value,
		set: (next) => {
			value = next;
			return next;
		},
		clear: () => {
			value = undefined;
		},
	};
	registry.add(cache.clear);
	return cache;
}

/** Clear every registered process cache. Wired into the vitest global beforeEach
 * so no test leaks a memoized value into the next; also usable in production
 * after a config change within a long-lived process. */
export function resetAllProcessCaches(): void {
	for (const clear of registry) clear();
}
