import type { IdentityCandidateSource } from "./identity-candidates.js";
import { createTailnetIdentitySource } from "./identity-source-tailnet.js";

/**
 * The registry of extended identity sources — the ONLY file that knows which
 * extended flows exist.
 *
 * `auth.ts` (the canonical flow) asks for "the sources"; it never names one. Each
 * registered source becomes ONE invocable entry in the identity prompt, labelled
 * from the source's own `discovery` block. Adding a second source is an edit HERE
 * and a new `identity-source-*.ts` file: no new flag, no change to the prompt, and
 * the canonical prompt, the candidate seam, and every canonical test stay untouched.
 *
 * Registering a source does NOT make it run. Nothing here queries anything until
 * the operator picks its entry (or passes `--discover`) — the invocation is the
 * declaration of intent (C3).
 */
export function defaultIdentityCandidateSources(): IdentityCandidateSource[] {
	return [createTailnetIdentitySource()];
}
