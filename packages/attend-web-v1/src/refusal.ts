/**
 * The three refusals, kept apart.
 *
 * A page that collapses "your credential expired", "someone else already answered" and
 * "the node is not answering" into *something went wrong* has destroyed the only
 * information the operator needed:
 *
 *   - **401 / 403 — the credential is done.** The fix is to run the handshake again. The
 *     page can do that itself; nothing is broken and nothing was lost.
 *   - **409 — someone else answered.** Nothing is wrong at all. The question is settled,
 *     the answer stands, and the page must say WHICH device settled it (P2). This is the
 *     one refusal that is good news.
 *   - **unreachable — the transport failed.** No HTTP status exists, because no response
 *     came back. Retrying is right; re-running the handshake is not, and would fail for
 *     the same reason the request did.
 *
 * Two more are carried because the wire really does distinguish them: `404` (the asker is
 * gone — P1's correct outcome, not an error) and `400` (the shape refused the answer).
 * Everything else lands on `http`, which states the status rather than pretending to
 * understand it.
 *
 * One more joined them when the declared wire version stopped being decoration.
 * `wire-incompatible` is not the node refusing THIS request — it is the node speaking a
 * shape this page cannot read at all, on every request it will ever make. It is therefore
 * the only refusal that must not be retried, and `refusalIsTerminal` is what says so.
 *
 * PURE — a status and a parsed body in, a verdict out. The client below turns a thrown
 * fetch into `unreachable`; nothing here performs I/O.
 */

import { checkAttendListWire, type AttendWireCheck } from "./wire.js";

/** What a settled prompt's `409` tells a loser of the race. */
export interface AttendSettledElsewhere {
	/** Which device settled it (P3). Never null in practice; typed nullable because the
	 *  page must not crash on a node that omitted it. */
	readonly device: string | null;
	/** `answered` or `abandoned` — a prompt can be settled by nobody answering. */
	readonly outcome: string | null;
	/** `cancelled` | `expired` | `withdrawn`, when it was abandoned. */
	readonly reason: string | null;
}

export type AttendRefusal =
	/** 401/403 — the scoped credential expired or was revoked. Re-run the handshake. */
	| { readonly reason: "credential-expired"; readonly status: number }
	/** 409 — first-answer-wins, and this surface was not first (P2). */
	| { readonly reason: "settled-elsewhere"; readonly settled: AttendSettledElsewhere }
	/** 404 — the asker is gone, so the question is gone with it (P1). */
	| { readonly reason: "asker-gone" }
	/** 400 — the shape refused this answer. `detail` never quotes the value. */
	| { readonly reason: "invalid-answer"; readonly detail: string | null }
	/** No response at all: DNS, connection refused, TLS, an aborted fetch. */
	| { readonly reason: "unreachable"; readonly detail: string }
	/**
	 * The node declared a wire version this page does not speak.
	 *
	 * The one refusal that must not be retried: the node will keep declaring the same
	 * version, and every poll would drop every prompt and paint "Nothing pending" over a
	 * farm full of questions. Carries BOTH versions, because a refusal an operator cannot
	 * act on is a refusal that leaves them stuck.
	 */
	| { readonly reason: "wire-incompatible"; readonly declared: string; readonly expected: string }
	/** A status this surface does not claim to understand. Stated, not guessed. */
	| { readonly reason: "http"; readonly status: number };

/** The verdict on a raw `GET /prompts` response, BEFORE the body is read as prompts.
 *  `client.ts` narrows it to `AttendListOutcome`, which carries the parsed list. */
export type AttendListClassification =
	| { readonly ok: true; readonly body: unknown; readonly wire: AttendWireCheck }
	| { readonly ok: false; readonly refusal: AttendRefusal };

export type AttendAnswerOutcome =
	/** 200 — THIS surface's answer is the one that settled it. */
	| { readonly ok: true; readonly device: string | null }
	| { readonly ok: false; readonly refusal: AttendRefusal };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringOrNull(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

/**
 * `401` and `403` are one verdict on purpose.
 *
 * The gate answers `401` for a credential it does not recognise and for one whose
 * deadline has passed — deliberately, so a caller cannot use the distinction to
 * enumerate. From this side both mean the same thing and have the same fix, so inventing
 * a second story for `403` would be inventing information the gate refused to give.
 */
function credentialRefusal(status: number): AttendRefusal {
	return { reason: "credential-expired", status };
}

/**
 * What `GET /prompts` came back as.
 *
 * The wire check runs on a `200` and BEFORE the body is read as prompts, because that is
 * the only order in which it helps: once the reader has run, an unspeakable version is
 * indistinguishable from an empty farm.
 */
export function classifyAttendListResponse(status: number, body: unknown): AttendListClassification {
	if (status === 200) {
		const wire = checkAttendListWire(body);
		if (wire.verdict === "incompatible") {
			return {
				ok: false,
				refusal: {
					reason: "wire-incompatible",
					declared: wire.declared ?? "",
					expected: wire.expected,
				},
			};
		}
		// `compatible` and `unknown` both proceed — and are kept apart, so the page can
		// say which one happened. See `checkAttendWire` for why `unknown` is admitted.
		return { ok: true, body, wire };
	}
	if (status === 401 || status === 403) return { ok: false, refusal: credentialRefusal(status) };
	return { ok: false, refusal: { reason: "http", status } };
}

/** What `POST /prompts/:id/answer` came back as. */
export function classifyAttendAnswerResponse(status: number, body: unknown): AttendAnswerOutcome {
	const record = isRecord(body) ? body : {};
	if (status === 200) return { ok: true, device: asStringOrNull(record.device) };
	if (status === 401 || status === 403) return { ok: false, refusal: credentialRefusal(status) };
	if (status === 409) {
		return {
			ok: false,
			refusal: {
				reason: "settled-elsewhere",
				settled: {
					device: asStringOrNull(record.device),
					outcome: asStringOrNull(record.outcome),
					reason: asStringOrNull(record.reason),
				},
			},
		};
	}
	if (status === 404) return { ok: false, refusal: { reason: "asker-gone" } };
	if (status === 400) {
		return { ok: false, refusal: { reason: "invalid-answer", detail: asStringOrNull(record.detail) } };
	}
	return { ok: false, refusal: { reason: "http", status } };
}

/** Whatever a fetch threw, as the one refusal it can possibly be. The message is kept
 *  because "load failed" and "connection refused" send an operator to different places. */
export function unreachableRefusal(error: unknown): AttendRefusal {
	const detail = error instanceof Error && error.message ? error.message : String(error);
	return { reason: "unreachable", detail };
}

/** Does this refusal mean the page should run the handshake again? EXACTLY one does. A
 *  page that re-handshakes on `unreachable` would hammer a node that is down. */
export function refusalNeedsNewCredential(refusal: AttendRefusal): boolean {
	return refusal.reason === "credential-expired";
}

/**
 * Is retrying this refusal pointless?
 *
 * EXACTLY one is. `unreachable` and `http` are worth another go with a longer wait;
 * `credential-expired` has its own path. A node that declared a version this page cannot
 * speak will declare the same version on the next poll and on every poll after it, so a
 * loop that keeps asking is a loop that keeps failing while looking busy.
 */
export function refusalIsTerminal(refusal: AttendRefusal): boolean {
	return refusal.reason === "wire-incompatible";
}

/** A settlement is not a failure — it is the answer arriving from somewhere else. The
 *  page uses this to decide whether to say "gone wrong" or simply "already done". */
export function refusalIsSettlement(refusal: AttendRefusal): boolean {
	return refusal.reason === "settled-elsewhere" || refusal.reason === "asker-gone";
}

function describeSettlement(settled: AttendSettledElsewhere, describeDevice: (d: string | null) => string): string {
	if (settled.outcome === "abandoned") {
		const why =
			settled.reason === "expired"
				? "the asker's deadline passed"
				: settled.reason === "cancelled"
					? "it was cancelled at the terminal"
					: settled.reason === "withdrawn"
						? "the asker withdrew it"
						: "nobody answered";
		return `Too late — this question was closed without an answer (${why}).`;
	}
	return `Too late — ${describeDevice(settled.device)} answered this one first.`;
}

/**
 * One sentence per refusal, in the operator's terms.
 *
 * `describeDevice` is injected rather than imported so this file stays a pure classifier
 * with no opinion about the block's reserved identities; the page passes
 * `describeAttendingDevice`.
 */
export function describeAttendRefusal(
	refusal: AttendRefusal,
	describeDevice: (device: string | null) => string,
): string {
	switch (refusal.reason) {
		case "credential-expired":
			return "This surface's credential has expired. Comparing the emoji again will issue a new one.";
		case "settled-elsewhere":
			return describeSettlement(refusal.settled, describeDevice);
		case "asker-gone":
			return "The command that asked this is gone, so the question went with it. Nothing to answer.";
		case "invalid-answer":
			return refusal.detail
				? `The question refused that answer: ${refusal.detail}`
				: "The question refused that answer.";
		case "unreachable":
			return `The node did not answer — this is the network, not the credential (${refusal.detail}).`;
		case "wire-incompatible":
			return wireIncompatibleSentence(refusal.declared, refusal.expected);
		default:
			return `The node answered HTTP ${refusal.status}.`;
	}
}

/**
 * The refusal an operator reads when the versions have parted, in their terms: what this
 * page speaks, what the node speaks, and the ONE thing that fixes it.
 *
 * The fix is a reload, and specifically a hard one, because the thing that is out of date
 * is JavaScript this browser is holding. The second sentence matters as much as the
 * first: the terminal that asked is always able to answer, so the operator is never left
 * with only a fix that might not work.
 */
function wireIncompatibleSentence(declared: string, expected: string): string {
	return (
		`This page speaks ${expected} and the node now speaks ${declared || "something it did not name"}. ` +
		"Reload the page (Ctrl-Shift-R, or ⌘⇧R) to get the version this node serves. " +
		"Until then, answer at the terminal that asked."
	);
}

/**
 * What to say about a wire check that did NOT refuse — or nothing.
 *
 * `compatible` returns null: a version that matches is not news, and a banner that is
 * always there is a banner nobody reads. `unknown` returns a sentence, because the
 * alternative is letting "the node declared nothing" pass as "checked and fine".
 */
export function describeAttendWireNotice(check: AttendWireCheck): string | null {
	if (check.verdict === "compatible") return null;
	if (check.verdict === "unknown") {
		return `This node did not declare a wire version. Continuing as ${check.expected} without checking it.`;
	}
	return wireIncompatibleSentence(check.declared ?? "", check.expected);
}
