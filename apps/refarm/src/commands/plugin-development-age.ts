import { readPluginDevelopment } from "@refarm.dev/config";

/**
 * HOW LONG A PLUGIN HAS BEEN DECLARED UNDER DEVELOPMENT, and on which node.
 *
 * The plugin-lifecycle work inverted a default to closed: an unsigned plugin runs ONLY where the
 * node declares it under development. The spec paired that enforcement with visibility — "the
 * state is visible wherever the plugin is" and "it ages out loud" — and only the first half
 * shipped (ISS-169).
 *
 * WHY AGE IS THE POINT rather than presence. The failure mode is not a waiver being granted; it
 * is a waiver becoming PERMANENT because nothing mentions it again. `local: []` was a field
 * nobody populated and nobody noticed for as long as it existed; a state enforced everywhere and
 * named in one place has the same shape.
 *
 * NOTHING IS REMOVED OR EXPIRED HERE. Withdrawing a declaration is the operator's, per the
 * guardrails; this reports a duration and lets them decide — the shape `staleBuilds` and the
 * ledger's own freshness gate already use.
 */
export interface PluginUnderDevelopment {
	/** The runtime id the node's config keys this by. */
	readonly pluginId: string;
	readonly declaredAt: string;
	/** Whole days since the declaration, or null when `declaredAt` cannot be read as a date. */
	readonly ageDays: number | null;
}

/** After this many days a waiver is reported as worth revisiting. Reported, never enforced. */
export const DEVELOPMENT_STALE_AFTER_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** PURE. Whole days between a declaration and now, or null when the stamp is unreadable. */
export function developmentAgeDays(declaredAt: string, now: Date): number | null {
	const stamp = Date.parse(declaredAt);
	if (Number.isNaN(stamp)) return null;
	// FLOORED, and never negative: a clock that disagrees with a stamp is a fact about the clock,
	// and reporting "-3 days under development" would send the reader after the wrong thing.
	return Math.max(0, Math.floor((now.getTime() - stamp) / MS_PER_DAY));
}

/**
 * Every plugin this node declares under development, oldest first.
 *
 * NEVER THROWS. A config that cannot be read reports NOTHING under development rather than
 * failing the audit — the enforcement path already treats an unreadable declaration as absent,
 * and a reporter that disagreed with it would describe a node that does not exist.
 */
export function readPluginsUnderDevelopment(
	config: unknown,
	now: Date = new Date(),
): PluginUnderDevelopment[] {
	let declared: Map<string, { declaredAt: string }>;
	try {
		declared = readPluginDevelopment(config) as Map<string, { declaredAt: string }>;
	} catch {
		return [];
	}
	return [...declared.entries()]
		.map(([pluginId, entry]) => ({
			pluginId,
			declaredAt: entry.declaredAt,
			ageDays: developmentAgeDays(entry.declaredAt, now),
		}))
		.sort((left, right) => (right.ageDays ?? -1) - (left.ageDays ?? -1));
}

/** PURE. The ones old enough to be worth a second look. An unreadable stamp is never stale — it
 *  is a different finding, and folding it in would hide it. */
export function stalePluginDevelopment(
	entries: readonly PluginUnderDevelopment[],
	afterDays: number = DEVELOPMENT_STALE_AFTER_DAYS,
): PluginUnderDevelopment[] {
	return entries.filter((entry) => entry.ageDays !== null && entry.ageDays >= afterDays);
}
