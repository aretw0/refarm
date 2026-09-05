/**
 * What each prompt kind LOOKS like, as data.
 *
 * P6 says the wire shape carries no rendering instruction: a surface renders, the shape
 * does not decide how. That leaves the how to this file — and it is written as a pure
 * view model rather than as DOM so that "a select shows exactly the offered options",
 * "a secret is masked", "a secret warns before the operator types" are assertions a test
 * can make with no browser in the room.
 *
 * The page then contains one small generic builder that walks a view model. That is the
 * whole trick: the part with the judgement in it is tested, and the part that touches the
 * DOM is too dumb to be wrong.
 *
 * PURE.
 */

import type { OperatorPrompt, PendingPrompt } from "@refarm.dev/prompt-contract-v1";

import { attendAnswerTravels } from "./wire.js";

export interface AttendSelectChoice {
	readonly value: string;
	readonly label: string;
	readonly description: string | null;
	/** The option the shape named as its default, if it named one that exists. */
	readonly selected: boolean;
}

/**
 * The control to draw. One variant per prompt kind, and `control` is the only thing the
 * page switches on — a kind added to the block that this file has not learned yet
 * produces `unsupported` rather than a blank card, so the operator is told to answer at
 * the terminal instead of staring at nothing.
 */
export type AttendControl =
	| {
			readonly control: "confirm";
			/** The label of the button that answers `true`, and of the one that answers
			 *  `false`. Both are always shown: a confirm rendered as a single button hides
			 *  half the answer. */
			readonly affirm: string;
			readonly deny: string;
			/** Which one the shape would have taken on a bare Enter. Rendered as emphasis,
			 *  never as a pre-submitted answer. */
			readonly default: boolean;
	  }
	| { readonly control: "select"; readonly choices: readonly AttendSelectChoice[] }
	| {
			readonly control: "text";
			readonly default: string | null;
			readonly placeholder: string | null;
	  }
	| {
			readonly control: "secret";
			/** Always true. Present as a field so the page cannot draw a secret without
			 *  reading the flag that says to mask it. */
			readonly masked: true;
			/** How many trailing characters the shape allows to be visible. The page shows
			 *  none regardless — a phone screen is read over shoulders — but the value is
			 *  carried so a surface that wants it does not have to re-derive it. */
			readonly visibleTail: number;
	  }
	| { readonly control: "unsupported"; readonly type: string };

export interface AttendPromptView {
	readonly id: string;
	/** The question, verbatim from the shape. */
	readonly question: string;
	/** `refarm auth enrol on tuono` — who asked and where, for recognising it at a glance. */
	readonly asker: string;
	/** P5's deadline as a phrase, or null when the asker declared none. */
	readonly deadline: string | null;
	/** True once the asker's own deadline has passed. The page keeps showing the prompt
	 *  (the node is the authority on whether it is still answerable) but stops inviting an
	 *  answer it expects to be refused. */
	readonly expired: boolean;
	/**
	 * P4 — the sentence the operator must be able to read BEFORE typing. Null for a prompt
	 * whose answer does not travel as a secret. Never phrased as reassurance: it states
	 * that the value crosses the network and offers the alternative.
	 */
	readonly travelNotice: string | null;
	readonly control: AttendControl;
}

/** How long the ASKER is still willing to wait (P5). Null when it declared no deadline. */
export function describeAttendDeadline(pending: PendingPrompt, now: number): string | null {
	if (pending.expiresAt === null) return null;
	const remaining = pending.expiresAt - now;
	if (remaining <= 0) return "the asker's deadline has passed";
	const seconds = Math.round(remaining / 1000);
	if (seconds < 90) return `${seconds}s left`;
	return `${Math.round(seconds / 60)} min left`;
}

/** Has the asker's own deadline passed? */
export function attendPromptExpired(pending: PendingPrompt, now: number): boolean {
	return pending.expiresAt !== null && pending.expiresAt <= now;
}

/** Who asked, and where. */
export function describeAttendAsker(pending: PendingPrompt): string {
	const where = pending.asker.host ? ` on ${pending.asker.host}` : "";
	return `${pending.asker.command}${where}`;
}

/**
 * P4's warning, in the words the other surfaces use.
 *
 * The kit says it in Portuguese at a terminal; this says it in the page's English. Both
 * say the same two things, and the second one is the part that matters: the operator is
 * offered the alternative of walking to the desk, before they type, not after.
 */
export const ATTEND_TRAVEL_NOTICE =
	"This answer CROSSES THE NETWORK to the node — authenticated, inside the tailnet, but " +
	"crossing. If you would rather it did not, answer at the terminal that asked.";

/** The control for one prompt. */
export function attendControlFor(prompt: OperatorPrompt): AttendControl {
	switch (prompt.type) {
		case "confirm":
			return {
				control: "confirm",
				affirm: "Yes",
				deny: "No",
				// The block's own rule: an omitted default is `true`.
				default: prompt.default ?? true,
			};
		case "select": {
			const fallback = prompt.default;
			return {
				control: "select",
				choices: prompt.options.map((option) => ({
					value: option.value,
					label: option.label,
					description: option.description ?? null,
					selected: fallback !== undefined && option.value === fallback,
				})),
			};
		}
		case "text":
			return {
				control: "text",
				default: prompt.default ?? null,
				placeholder: prompt.placeholder ?? null,
			};
		case "secret":
			return { control: "secret", masked: true, visibleTail: prompt.visibleTail ?? 0 };
		default:
			return { control: "unsupported", type: (prompt as { type: string }).type };
	}
}

/** The whole view model for one pending prompt. */
export function attendPromptView(pending: PendingPrompt, now: number): AttendPromptView {
	return {
		id: pending.id,
		question: pending.prompt.question,
		asker: describeAttendAsker(pending),
		deadline: describeAttendDeadline(pending, now),
		expired: attendPromptExpired(pending, now),
		// Recomputed from the KIND, not read from the payload — see `attendAnswerTravels`.
		travelNotice: attendAnswerTravels(pending.prompt) ? ATTEND_TRAVEL_NOTICE : null,
		control: attendControlFor(pending.prompt),
	};
}
