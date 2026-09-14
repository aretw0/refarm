/**
 * PROPOSING THE RENEWAL WHERE THE OBLIGATION IS BORN.
 *
 * The operator's argument, 2026-08-19, and it is the right one: renewal should be part of holding
 * a credential rather than something left loose for him to remember. Storing a token that expires
 * CREATES the obligation — leaving him to discover it later, from a health advisory or from the
 * node stopping, puts a gap between the two where there does not need to be one.
 *
 * It is also not a new capability. Authorising this node to hold a GitHub credential authorised it
 * to speak to GitHub as him; renewing is maintenance of that, not another door. What IS a system
 * change is installing a supervisor unit — so this PROPOSES through the same consent journey
 * `process add` walks, which shows the diff, records the decision and keeps an undo.
 *
 * ONE QUESTION, IN CONTEXT, instead of an advisory to act on later. A decline is remembered by the
 * trail, so this never becomes a wizard that nags.
 */
import { EXPIRING_PROVIDERS, renewalCoverage } from "@refarm.dev/health";

/** Seconds between renewals. TWO minutes against a five-minute margin: a check interval must fit
 *  INSIDE the tolerance rather than tie with it, or the worst case renews exactly at the wire. */
export const RENEWAL_EVERY_SECONDS = 120;
export const RENEWAL_PROCESS_NAME = "credential-renew";

export type RenewalProposal =
	/** Nothing to propose: the provider's credential does not expire, or something already renews. */
	| { readonly kind: "not-needed"; readonly because: string }
	| {
			readonly kind: "propose";
			readonly name: string;
			readonly description: string;
			readonly command: string;
			readonly everySeconds: number;
	  };

/**
 * PURE. Should this node be offered a renewal declaration right now?
 *
 * `binary` is the path to this CLI as the operator invoked it — the declaration must name a real
 * executable, and guessing `refarm` from PATH would write a unit that works in a shell and not
 * under a supervisor, which is exactly the class of failure supervised units are prone to.
 */
export function proposeRenewal(
	provider: string,
	declaredProcesses: readonly { name?: string; command?: string[] | string }[],
	binary: string,
): RenewalProposal {
	if (!EXPIRING_PROVIDERS.includes(provider)) {
		return {
			kind: "not-needed",
			because: `${provider} credentials do not expire on a clock, so nothing needs to renew them.`,
		};
	}
	const coverage = renewalCoverage([{ provider }], declaredProcesses);
	if (coverage.state === "covered") {
		return {
			kind: "not-needed",
			because: `"${coverage.by}" already renews on this node.`,
		};
	}
	if (!binary.trim()) {
		return {
			kind: "not-needed",
			because:
				"this node could not tell where its own binary lives, and a declaration naming a " +
				"command a supervisor cannot find is worse than none.",
		};
	}
	return {
		kind: "propose",
		name: RENEWAL_PROCESS_NAME,
		description: "renews short-lived model credentials before they lapse",
		command: `${binary.trim()} credential renew`,
		everySeconds: RENEWAL_EVERY_SECONDS,
	};
}
