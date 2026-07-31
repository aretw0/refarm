/**
 * Reading `GET /prompts` in a browser.
 *
 * ── WHY THIS IS NOT `parsePendingPromptList` ──────────────────────────────────────
 *
 * The obvious move is to import the reader that already exists in
 * `@refarm.dev/prompt-contract-v1`. It cannot be done, and the reason is mechanical
 * rather than aesthetic: that block's entry point opens with
 * `import readline from "node:readline"`, statically, because it also carries the
 * terminal channel. A browser fails such a module at RESOLUTION time, before a line of
 * it runs — `node:readline` is not a specifier any browser can resolve — so serving that
 * `dist/index.js` to a page produces a blank screen and a console error, whatever the
 * page then does with it.
 *
 * The two ways out that were considered and rejected:
 *
 *   - an import map aliasing `node:readline` to a stub. It works, and it means the next
 *     reader of this page has to understand why a readline shim is being shipped to a
 *     phone browser to make a terminal library load. That is a worse thing to maintain
 *     than the fifty lines below.
 *   - splitting the block's wire half into its own file. That changes the shape of
 *     `dist/`, and `packages/farm-client/scripts/vendor.mjs` carries `dist/index.js` into
 *     the kit as ONE self-contained file. A second file would either be missing from the
 *     kit or would have to join the cold-bootstrap manifest — which is the one thing this
 *     slice must not disturb.
 *
 * ── WHAT KEEPS THE COPY HONEST ────────────────────────────────────────────────────
 *
 * Two things, and neither is a promise in a comment:
 *
 *   1. every type here is `import type`d FROM the block. A change to `PendingPrompt` or
 *      `OperatorPrompt` is a type error in this file, not a surprise at runtime. The
 *      imports erase at compile time, so the emitted `.js` still imports nothing.
 *   2. `wire.agreement.test.ts` runs BOTH implementations over one table of cases and
 *      fails when they disagree. That is the same defence `vendor.test.mjs` gives the
 *      kit's vendored copy: drift is a red test rather than an incident.
 *
 * PURE — no fetch, no clock, no DOM.
 */

import type {
	OperatorPrompt,
	PendingPrompt,
	SelectOption,
	TextPrompt,
} from "@refarm.dev/prompt-contract-v1";

/** The route that lists what is waiting. */
export const ATTEND_PROMPTS_PATH = "/prompts";

/**
 * The wire version THIS page speaks — the block's `PENDING_PROMPT_WIRE`.
 *
 * A literal for the same mechanical reason the reader below is a copy: the block's
 * runtime cannot be loaded in a browser, so a value cannot be imported from it, only a
 * type. The agreement test in `wire.test.ts` asserts this equals the block's constant, so
 * the two cannot drift apart without a red test.
 */
export const ATTEND_WIRE = "pending-prompt.v1" as const;

/** The route that answers ONE question. */
export function attendAnswerPath(promptId: string): string {
	return `/prompts/${encodeURIComponent(promptId)}/answer`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function readSelectOptions(value: unknown): SelectOption[] | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	const options: SelectOption[] = [];
	for (const raw of value) {
		if (!isRecord(raw)) return null;
		const optionValue = asString(raw.value);
		const label = asString(raw.label);
		if (optionValue === null || label === null) return null;
		const description = asString(raw.description);
		options.push(
			description === null
				? { value: optionValue, label }
				: { value: optionValue, label, description },
		);
	}
	return options;
}

/** Validate one prompt off the wire, or null. Never throws: one malformed entry must not
 *  blank a page that is showing four good ones. */
export function readOperatorPrompt(value: unknown): OperatorPrompt | null {
	if (!isRecord(value)) return null;
	const question = asString(value.question);
	if (question === null) return null;
	switch (value.type) {
		case "confirm":
			return typeof value.default === "boolean"
				? { type: "confirm", question, default: value.default }
				: { type: "confirm", question };
		case "select": {
			const options = readSelectOptions(value.options);
			if (options === null) return null;
			const fallback = asString(value.default);
			const valid = fallback !== null && options.some((option) => option.value === fallback);
			return valid
				? { type: "select", question, options, default: fallback }
				: { type: "select", question, options };
		}
		case "text": {
			const prompt: TextPrompt = { type: "text", question };
			const fallback = asString(value.default);
			if (fallback !== null) prompt.default = fallback;
			const placeholder = asString(value.placeholder);
			if (placeholder !== null) prompt.placeholder = placeholder;
			return prompt;
		}
		case "secret":
			return typeof value.visibleTail === "number" && Number.isFinite(value.visibleTail)
				? { type: "secret", question, visibleTail: value.visibleTail }
				: { type: "secret", question };
		default:
			return null;
	}
}

/**
 * P4, recomputed and never trusted.
 *
 * The wire carries `answerTravels`, and this deliberately ignores it. A peer that
 * under-reported the flag would strip the "this answer crosses the network" warning off a
 * secret prompt, and the warning is the whole of P4. The KIND decides, and the kind is
 * right here in the payload.
 */
export function attendAnswerTravels(prompt: OperatorPrompt): boolean {
	return prompt.type === "secret";
}

// ── The version the node declares, CHECKED ────────────────────────────────────────
//
// A page cached in a browser is the same frozen client the vendored kit is: it holds the
// JavaScript that was current when the tab was opened, and it keeps polling a node that
// may have moved on. Without this, a moved node produces the worst possible screen —
// "Nothing pending", forever, on a farm full of questions, because `readPendingPrompt`
// below drops every entry whose `wire` it does not recognise. Silent, confident, wrong.
//
// A COPY of the block's `checkPendingPromptWire`, for the reason at the top of this file,
// and covered by the same agreement test. Exact match, not a compatibility rule: the
// discriminator is one opaque token that moves only for a breaking change, so every
// difference in it is breaking, and a rule would have to invent a versioning scheme the
// wire does not have.

export type AttendWireVerdict = "compatible" | "incompatible" | "unknown";

export interface AttendWireCheck {
	readonly verdict: AttendWireVerdict;
	/** What the node declared, or `null` when it declared nothing at all. */
	readonly declared: string | null;
	/** What this page speaks. */
	readonly expected: string;
}

/** The `wire` a `GET /prompts` envelope declared, or null. An empty string is nothing
 *  declared, not a version to compare against. */
export function readDeclaredAttendWire(body: unknown): string | null {
	if (!isRecord(body)) return null;
	const declared = body.wire;
	return typeof declared === "string" && declared !== "" ? declared : null;
}

/**
 * Three answers, never two.
 *
 * `unknown` — the node declared nothing — is ADMITTED, and it is said. In this topology
 * a peer that declares nothing is a peer OLDER than the declaration, and every node that
 * has the field sends it; refusing here would refuse precisely the older peers, and the
 * older peer is always the operator's own frozen surface. A safety mechanism whose first
 * act is to lock someone out of a device that works today has made nothing safer. But it
 * does not become `compatible`: the verdict survives to the page, which shows it, so
 * nobody believes a version was checked when none was offered.
 */
export function checkAttendWire(
	declared: string | null,
	expected: string = ATTEND_WIRE,
): AttendWireCheck {
	if (declared === null) return { verdict: "unknown", declared: null, expected };
	return { verdict: declared === expected ? "compatible" : "incompatible", declared, expected };
}

/** The verdict on a `GET /prompts` envelope, in one call. */
export function checkAttendListWire(body: unknown, expected: string = ATTEND_WIRE): AttendWireCheck {
	return checkAttendWire(readDeclaredAttendWire(body), expected);
}

/** Validate one pending prompt off the wire, or null. */
export function readPendingPrompt(value: unknown): PendingPrompt | null {
	if (!isRecord(value)) return null;
	if (value.wire !== ATTEND_WIRE) return null;
	const id = asString(value.id);
	if (id === null || id === "") return null;
	const prompt = readOperatorPrompt(value.prompt);
	if (prompt === null) return null;
	if (!isRecord(value.asker)) return null;
	const command = asString(value.asker.command);
	if (command === null) return null;
	if (typeof value.askedAt !== "number" || !Number.isFinite(value.askedAt)) return null;
	const expiresAt =
		typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
			? value.expiresAt
			: null;
	if (value.expiresAt !== null && expiresAt === null) return null;
	const asker: PendingPrompt["asker"] = { command };
	if (typeof value.asker.pid === "number" && Number.isFinite(value.asker.pid)) {
		asker.pid = value.asker.pid;
	}
	const host = asString(value.asker.host);
	if (host !== null) asker.host = host;
	return {
		wire: ATTEND_WIRE,
		id,
		prompt,
		answerTravels: attendAnswerTravels(prompt),
		asker,
		askedAt: value.askedAt,
		expiresAt,
	};
}

/** Every prompt in a `GET /prompts` payload, dropping entries that do not validate. */
export function readPendingPromptList(body: unknown): PendingPrompt[] {
	const raw = isRecord(body) && Array.isArray(body.prompts) ? body.prompts : [];
	const prompts: PendingPrompt[] = [];
	for (const entry of raw) {
		const prompt = readPendingPrompt(entry);
		if (prompt !== null) prompts.push(prompt);
	}
	return prompts;
}

// ── The shape's own constraints, enforced before anything is sent ──────────────────

export type AttendAnswerCheck =
	| { readonly ok: true; readonly value: boolean | string }
	| { readonly ok: false; readonly reason: string };

const CONFIRM_TRUE = new Set(["true", "yes", "y", "1"]);
const CONFIRM_FALSE = new Set(["false", "no", "n", "0"]);

/**
 * Is this a legal answer to this prompt?
 *
 * Checked in the page as well as at the node, so a select cannot even be SUBMITTED with a
 * value that was never offered — the operator is told by the control they are looking at
 * rather than by a round trip.
 *
 * A rejection never quotes the submitted value: for a secret prompt that would put the
 * secret into a DOM node, which is the one place it must not go.
 */
export function checkAttendAnswer(prompt: OperatorPrompt, value: unknown): AttendAnswerCheck {
	if (prompt.type === "confirm") {
		if (typeof value === "boolean") return { ok: true, value };
		if (typeof value === "string") {
			const normalized = value.trim().toLowerCase();
			if (CONFIRM_TRUE.has(normalized)) return { ok: true, value: true };
			if (CONFIRM_FALSE.has(normalized)) return { ok: true, value: false };
		}
		return { ok: false, reason: "confirm expects a boolean" };
	}
	if (typeof value !== "string") return { ok: false, reason: `${prompt.type} expects a string` };
	if (prompt.type === "select") {
		return prompt.options.some((option) => option.value === value)
			? { ok: true, value }
			: { ok: false, reason: "select expects one of the offered option values" };
	}
	return { ok: true, value };
}

// ── Who answered ──────────────────────────────────────────────────────────────────

/** The block's reserved identities begin with a space so a validated device label can
 *  never collide with them. Here they become something a person reads. */
export function describeAttendingDevice(device: string | null | undefined): string {
	if (device === " terminal") return "the terminal that asked";
	if (device === " node-local") return "the node itself";
	return device && device.trim() !== "" ? device : "another surface";
}
