import { deliver, routeDelivery, type DeliveryRequest } from "@refarm.dev/delivery-contract-v1";

import { refarmCommand } from "../brand.js";
import { loadDeclaredDelivery, operatorIsAttending } from "./delivery.js";

/**
 * THE NODE SAYING IT IS ABOUT TO STOP BEING ABLE TO WORK.
 *
 * A credential the node could not renew is the one notice that is not chatter: every dispatch
 * after it fails, and the operator finds out when he next asks for something. MEASURED
 * 2026-08-28: `credential renew` printed `Could not renew: …` to the stdout of a systemd
 * oneshot — the journal — and published nothing. ISS-081's ledger entry recommended declaring
 * the channel unattended to fix this, and that would have changed NOTHING, because there was
 * no notice to route.
 *
 * A NOTICE, NEVER A QUESTION (`needsDecision: false`). Nothing here is settled by an answer:
 * the node already tried the exchange it could do alone, and what remains needs a browser. An
 * announce-only channel may carry it, which is one fewer capability required of a transport
 * whose whole job here is to wake someone.
 *
 * IT REPORTS ITS OWN REFUSALS. When no channel can carry it — an attended-only declaration with
 * no window armed, which is this node's state today — the caller is told WHY rather than the
 * notice evaporating. Silence about a failed delivery is the same defect one layer up.
 */
export interface CredentialLapseNotice {
	/** Adapters that accepted it. */
	readonly delivered: string[];
	/** Channels that could not carry it, and the reason each gave. */
	readonly refused: { readonly channel: string; readonly reason: string }[];
}

export interface CredentialLapseDeps {
	readonly loadDelivery?: typeof loadDeclaredDelivery;
	readonly attending?: () => boolean;
	readonly route?: typeof routeDelivery;
	readonly send?: typeof deliver;
	readonly now?: () => number;
}

/** PURE. What the operator reads on a small screen: what lapsed, and the one command that fixes it. */
export function credentialLapseMessage(because: string): string {
	return `refarm: a credential lapsed and this node could not renew it — ${because} Dispatch will fail until it is re-authenticated: ${refarmCommand(["sow"])}`;
}

export async function publishCredentialLapse(
	because: string,
	deps: CredentialLapseDeps = {},
): Promise<CredentialLapseNotice> {
	const { channels } = (deps.loadDelivery ?? loadDeclaredDelivery)();
	if (channels.length === 0) return { delivered: [], refused: [] };

	const request: DeliveryRequest = {
		promptId: "(credential-lapse)",
		question: credentialLapseMessage(because),
		asker: refarmCommand(["credential", "renew"]),
		needsDecision: false,
		answerTravels: false,
		expiresAt: null,
	};
	const plan = (deps.route ?? routeDelivery)({
		request,
		channels,
		attending: (deps.attending ?? operatorIsAttending)(),
	});
	const outcomes = await (deps.send ?? deliver)({
		plan,
		request,
		// Nothing can settle a notice; the sink exists because `deliver` takes one.
		sink: { answer: () => false },
		...(deps.now ? { now: deps.now } : {}),
	});
	return {
		delivered: outcomes
			.filter((outcome) => outcome.status === "delivered")
			.map((outcome) => outcome.adapter),
		refused: plan.refusals.map((refusal) => ({
			channel: refusal.channel,
			reason: refusal.detail ?? refusal.reason,
		})),
	};
}
