import type { IdentityCandidateSource } from "./identity-candidates.js";
import { createTailnetIdentitySource } from "./identity-source-tailnet.js";

/**
 * The registry of extended identity sources — the ONLY file that knows which
 * extended flows exist.
 *
 * `auth.ts` (the canonical flow) asks for "the sources"; it never names one.
 * Adding a second source is an edit HERE and a new `identity-source-*.ts` file:
 * the canonical prompt, the candidate seam, and every canonical test stay
 * untouched. Each source is individually gated by its own operator declaration
 * (C3), so an empty declaration file means an empty list means byte-identical
 * canonical behaviour.
 */
export function defaultIdentityCandidateSources(): IdentityCandidateSource[] {
	return [createTailnetIdentitySource()];
}
