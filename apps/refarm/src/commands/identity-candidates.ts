/**
 * The candidate seam for `refarm auth enroll` — the ONE place the extended
 * enrolment path plugs into the canonical one
 * (docs/superpowers/specs/2026-07-30-canonical-and-extended-flows-design.md).
 *
 * The canonical prompt (`promptForIdentity` in auth.ts) selects among candidates
 * and always offers "A new device". An extended flow does not branch inside that
 * prompt — it offers an INVOCABLE entry ("Discover devices on my tailnet…") and,
 * once invoked, CONTRIBUTES candidates to the list the prompt already renders. So
 * this module is deliberately ignorant of every source that exists: it knows
 * about labels, candidates, and "a verb the operator can pick", never about
 * tailnets, Bluetooth, an address book, or whatever the second source turns out
 * to be.
 *
 * Adding a source means writing an `IdentityCandidateSource` and registering it
 * in `identity-sources.ts`. It means touching NOTHING here and NOTHING in the
 * canonical prompt — the prompt renders one entry per registered source from the
 * source's own labels, so a second source is a second entry and no new code.
 *
 * PURE: no I/O, no spawn, no filesystem. Sources do the asking; this merges.
 */

/** Validate a device/identity label, whether it came from the CLI argument or an
 * interactively typed prompt — both paths must reject the same malformed input.
 * PURE. Minimum bar: non-empty after trimming, no control characters. */
export function validateIdentityLabel(label: string): string {
	const trimmed = label.trim();
	if (!trimmed) {
		throw new Error("identity label must not be empty");
	}
	for (let i = 0; i < trimmed.length; i++) {
		const code = trimmed.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) {
			throw new Error("identity label must not contain control characters");
		}
	}
	return trimmed;
}

/**
 * Best-effort repair of a name a SOURCE produced (never one the operator typed)
 * so it can stand as an identity label: control characters dropped, trimmed.
 * Returns null when nothing usable survives.
 *
 * A source uses this to OFFER a repaired name — never to install one. The
 * operator still sees the original and confirms or edits the repair
 * (`IdentityCandidate.needsConfirmation`), because a credential's identity is
 * theirs to choose, not something a discovery mechanism gets to rewrite behind
 * their back.
 */
export function sanitiseIdentityLabel(raw: string): string | null {
	let kept = "";
	for (const ch of raw) {
		const code = ch.charCodeAt(0);
		if (code <= 0x1f || code === 0x7f) continue;
		kept += ch;
	}
	const trimmed = kept.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/** One device a source can see and propose a name for. Proposing is NOT
 * authorising: the operator still picks, one at a time (C2.1). */
export interface IdentityCandidate {
	/** The label that would be enrolled — already a valid identity label. */
	value: string;
	/** What the operator sees in the list. Usually the same as `value`. */
	label: string;
	/** A short qualifier the source supplies, e.g. "on your tailnet". The prompt
	 * composes it with the action ("… — enroll it" / "… — rotate its token") so
	 * the canonical wording stays canonical. */
	description?: string;
	/** True when `value` is a REPAIRED form of `rawName` — the prompt must let the
	 * operator accept or edit it rather than enrolling the repair silently. */
	needsConfirmation?: boolean;
	/** The name exactly as the source reported it, when it differs from `value`. */
	rawName?: string;
	/** Which source contributed this, for diagnostics. */
	source?: string;
}

/**
 * What one source has to say. `notices` is how a source explains a SHORT list —
 * critically, how it says "I could not ask" as something different from "the
 * answer is no" (C2.3). The enrol flow prints them before prompting, then falls
 * through to the canonical prompt regardless.
 */
export interface IdentityCandidateReport {
	candidates: IdentityCandidate[];
	notices: string[];
}

/**
 * How a source's INVOCATION reads in the identity prompt. The source owns this
 * wording — the prompt only lays it out — which is what lets a second source add
 * a second entry with no change to the prompt and no new flag.
 *
 * Two labels because re-asking is a different act from asking: the first says
 * what the verb does, the second says the answer is being taken again. The list
 * a source returns is a live snapshot; "again" is how the operator picks up a
 * device that appeared after the prompt opened.
 */
export interface IdentityDiscoveryEntry {
	/** Before this source has been invoked, e.g. "Discover devices on my tailnet…". */
	readonly label: string;
	/** After it has, e.g. "Discover again on my tailnet". */
	readonly againLabel: string;
	/** Short qualifier shown beside `label`. */
	readonly description?: string;
	/** Short qualifier shown beside `againLabel`. */
	readonly againDescription?: string;
}

export interface IdentityCandidateSource {
	/** Stable id, for diagnostics and for tests that assert the registry wiring. */
	readonly id: string;
	/** What picking this source's entry looks like. Presentation only — the
	 * prompt never interprets it, and never learns what the source asks. */
	readonly discovery: IdentityDiscoveryEntry;
	/** Ask the world, NOW. Called at the moment the operator invokes the entry,
	 * never speculatively and never from a cache. */
	collect(): Promise<IdentityCandidateReport>;
}

/** The canonical answer: nothing contributed, nothing to say. With this, the
 * prompt behaves EXACTLY as it did before any source existed. */
export const NO_IDENTITY_CANDIDATES: IdentityCandidateReport = Object.freeze({
	candidates: Object.freeze([]) as unknown as IdentityCandidate[],
	notices: Object.freeze([]) as unknown as string[],
});

/**
 * Merge every source's report into one. De-duplicates by `value` (first source
 * to claim a label keeps it) so the operator never sees one device twice.
 *
 * A source that THROWS is not allowed to take the enrolment down with it: its
 * failure becomes a notice and the flow continues to the canonical prompt. An
 * optional convenience must never be able to break the irreducible path.
 */
export async function collectIdentityCandidates(
	sources: readonly IdentityCandidateSource[],
): Promise<IdentityCandidateReport> {
	const candidates: IdentityCandidate[] = [];
	const notices: string[] = [];
	const seen = new Set<string>();
	for (const source of sources) {
		let report: IdentityCandidateReport;
		try {
			report = await source.collect();
		} catch (error) {
			notices.push(`Could not ask "${source.id}" for devices (${(error as Error).message}).`);
			continue;
		}
		for (const notice of report.notices) notices.push(notice);
		for (const candidate of report.candidates) {
			if (seen.has(candidate.value)) continue;
			seen.add(candidate.value);
			candidates.push(candidate);
		}
	}
	return { candidates, notices };
}

/**
 * Fold a FRESH answer from one source into the list already on screen. PURE.
 *
 * The source's previous contribution is DROPPED, not merged: a re-query is a new
 * snapshot of the world, so a device that has since left must disappear from the
 * list exactly as a device that has since arrived must appear. Merging would turn
 * the list into an accumulating cache of everything ever seen — the one thing a
 * live query must not become. Candidates from other sources, and any the caller
 * supplied without a source, are kept as they were.
 */
export function replaceSourceCandidates(
	existing: readonly IdentityCandidate[],
	sourceId: string,
	fresh: readonly IdentityCandidate[],
): IdentityCandidate[] {
	const kept = existing.filter((candidate) => candidate.source !== sourceId);
	const merged: IdentityCandidate[] = [...kept];
	const seen = new Set(kept.map((candidate) => candidate.value));
	for (const candidate of fresh) {
		if (seen.has(candidate.value)) continue;
		seen.add(candidate.value);
		merged.push(candidate);
	}
	return merged;
}
