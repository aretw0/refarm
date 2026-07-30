/**
 * The candidate seam for `refarm auth enroll` — the ONE place the extended
 * enrolment path plugs into the canonical one
 * (docs/superpowers/specs/2026-07-30-canonical-and-extended-flows-design.md).
 *
 * The canonical prompt (`promptForIdentity` in auth.ts) selects among candidates
 * and always offers "A new device". An extended flow does not branch inside that
 * prompt — it CONTRIBUTES candidates to the list the prompt already renders. So
 * this module is deliberately ignorant of every source that exists: it knows
 * about labels and candidates, never about tailnets, Bluetooth, an address book,
 * or whatever the second source turns out to be.
 *
 * Adding a source means writing an `IdentityCandidateSource` and registering it
 * in `identity-sources.ts`. It means touching NOTHING here and NOTHING in the
 * canonical prompt. That is the whole point.
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

export interface IdentityCandidateSource {
	/** Stable id, for diagnostics and for tests that assert the registry wiring. */
	readonly id: string;
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
