/**
 * A CREDENTIAL THAT EXPIRES, AND NOTHING RENEWING IT.
 *
 * Measured 2026-08-19: a node up for a day answered every dispatch with `token expired`. The
 * pieces to fix it exist — the credential renews, the host re-reads it from a file, and a command
 * hands it over — but only if something RUNS that command when the operator is not typing.
 *
 * This reports the gap. It does NOT declare the process: writing a timer that talks to a provider
 * every few minutes into someone's machine is an operator's decision. The node's job is to make
 * sure that decision is made deliberately, rather than discovered by the node stopping.
 */

/**
 * Providers whose credential is a SHORT-LIVED token rather than a durable key.
 *
 * A list rather than a heuristic: "does it expire" is a fact about a provider's auth model, and
 * guessing it from a stored field would report a gap for every provider that happens to record an
 * expiry it never enforces.
 *
 * @type {readonly string[]}
 */
export const EXPIRING_PROVIDERS = ["github-copilot"];

/** The subcommand that actually renews. Matched loosely on purpose — see the test. */
const RENEWAL_MARKERS = ["credential", "renew"];

/**
 * @typedef {{ provider?: string, alias?: string }} HeldAccount
 * @typedef {{ name?: string, command?: string[] | string }} DeclaredProcess
 * @typedef {{ state: "unneeded" | "covered" | "uncovered", providers: string[], by?: string }} RenewalCoverage
 */

/**
 * PURE. Does anything on this node keep its expiring credentials alive?
 *
 * Reads DESCRIPTORS only — no secret is touched. Whether a provider's token expires is a fact
 * about the provider, not about the stored blob.
 *
 * @param {readonly HeldAccount[]} accounts
 * @param {readonly DeclaredProcess[]} processes
 * @returns {RenewalCoverage}
 */
export function renewalCoverage(accounts, processes) {
	const expiring = [
		...new Set(
			(accounts ?? [])
				.map((a) => (typeof a?.provider === "string" ? a.provider : ""))
				.filter((p) => EXPIRING_PROVIDERS.includes(p)),
		),
	];
	if (expiring.length === 0) return { state: "unneeded", providers: [] };

	for (const process of processes ?? []) {
		const command = Array.isArray(process?.command)
			? process.command.join(" ")
			: typeof process?.command === "string"
				? process.command
				: "";
		const words = command.toLowerCase().split(/\s+/u);
		// BOTH words, ADJACENT. `credential list` shares one of them and renews nothing; accepting
		// it would report covered on a node that still dies daily.
		const index = words.indexOf(RENEWAL_MARKERS[0]);
		if (index !== -1 && words[index + 1] === RENEWAL_MARKERS[1]) {
			return { state: "covered", providers: expiring, by: process.name ?? command };
		}
	}
	return { state: "uncovered", providers: expiring };
}

/**
 * PURE. The fact, for a gap. Never names a CLI verb — the handoff is rendered where every other
 * one is, from `nextCommands`.
 *
 * @param {RenewalCoverage} coverage
 * @returns {string | null}
 */
export function describeRenewalCoverage(coverage) {
	if (coverage.state !== "uncovered") return null;
	return (
		`this node holds a ${coverage.providers.join(", ")} credential, which is a short-lived token, ` +
		"and nothing declared here renews it. A dispatch arriving after it lapses fails until " +
		"something hands the node a fresh one — declare a supervised process that renews, or expect " +
		"to do it by hand."
	);
}
