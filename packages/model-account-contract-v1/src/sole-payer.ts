/**
 * WHO PAID, when nobody declared it.
 *
 * A dispatch records its payer from a workspace BINDING. Measured 2026-08-18 on a real node: 36 of
 * 57 budget observations named no account, every one of them dispatched from a directory with no
 * binding — and every one of them still spent a real seat. The record called them `unattributed`,
 * which was true and was also a hole in the denominator the quota report reads.
 *
 * The seat is knowable exactly when the provider has ONE usable account. With two, nothing here
 * knows which one the host chose, and naming either would attribute spend to a seat that may not
 * have paid — the same silent substitution ISS-131 removed from the resolver. So this refuses,
 * and `unattributed` stays the honest answer for that case.
 */
import type { ModelAccountDescriptor } from "./types.js";

/**
 * PURE. The single usable account of a provider, or nothing.
 *
 * `healthy` only: an `incomplete` account has no secret to spend, so it cannot have paid. Counting
 * it toward the ambiguity would throw away an attribution that is actually determined.
 */
export function solePayerFor(
	provider: string,
	accounts: readonly ModelAccountDescriptor[],
): ModelAccountDescriptor | null {
	const usable = accounts.filter((a) => a.provider === provider && a.health === "healthy");
	return usable.length === 1 ? usable[0]! : null;
}
