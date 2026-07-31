import {
	checkPendingPromptAnswer,
	checkPendingPromptListWire,
	parsePendingPromptList,
	promptAnswerTravels,
	toPendingPrompt,
	PENDING_PROMPT_WIRE,
	type OperatorPrompt,
} from "@refarm.dev/prompt-contract-v1";
import { describe, expect, it } from "vitest";

import {
	ATTEND_WIRE,
	attendAnswerPath,
	attendAnswerTravels,
	checkAttendAnswer,
	checkAttendListWire,
	checkAttendWire,
	describeAttendingDevice,
	readDeclaredAttendWire,
	readPendingPromptList,
} from "./wire.js";

/** One prompt of every kind, plus the awkward variants. Shared by the agreement test
 *  below, which is what keeps this reader from drifting away from the block's. */
const PROMPTS: OperatorPrompt[] = [
	{ type: "confirm", question: "Apply?" },
	{ type: "confirm", question: "Apply?", default: false },
	{
		type: "select",
		question: "Which lane?",
		options: [
			{ value: "a", label: "Lane A" },
			{ value: "b", label: "Lane B", description: "the slow one" },
		],
	},
	{
		type: "select",
		question: "Which lane?",
		options: [{ value: "a", label: "Lane A" }],
		default: "a",
	},
	{ type: "text", question: "Name?" },
	{ type: "text", question: "Name?", default: "farm", placeholder: "a short label" },
	{ type: "secret", question: "Token?" },
	{ type: "secret", question: "Token?", visibleTail: 4 },
];

function published(prompt: OperatorPrompt, index: number) {
	return toPendingPrompt(prompt, {
		id: `p-${index}`,
		asker: { command: "refarm auth enrol", host: "tuono", pid: 1234 },
		askedAt: 1_800_000_000_000,
		timeoutMs: index % 2 === 0 ? 60_000 : null,
	});
}

describe("reading `GET /prompts` in a browser", () => {
	it("round-trips everything the block publishes", () => {
		const body = { wire: "pending-prompt.v1", prompts: PROMPTS.map(published) };
		expect(readPendingPromptList(body)).toEqual(PROMPTS.map(published));
	});

	it("drops a malformed entry instead of blanking the page", () => {
		const body = {
			prompts: [
				published(PROMPTS[0]!, 0),
				{ wire: "pending-prompt.v1", id: "bad", prompt: { type: "nonsense", question: "?" } },
				{ nothing: "useful" },
				published(PROMPTS[6]!, 6),
			],
		};
		const read = readPendingPromptList(body);
		expect(read.map((entry) => entry.id)).toEqual(["p-0", "p-6"]);
	});

	it("ignores a payload that is not a list at all", () => {
		for (const body of [undefined, null, {}, { prompts: "none" }, 7]) {
			expect(readPendingPromptList(body)).toEqual([]);
		}
	});

	it("recomputes P4 from the KIND, never from the payload", () => {
		// A node (or anything between) claiming a secret does not travel must not be able
		// to strip the warning off it — the warning is the whole of P4.
		const lying = {
			...published(PROMPTS[6]!, 6),
			answerTravels: false,
		};
		const [read] = readPendingPromptList({ prompts: [lying] });
		expect(read?.answerTravels).toBe(true);

		// And the reverse: a confirm cannot be dressed up as travelling.
		const overclaiming = { ...published(PROMPTS[0]!, 0), answerTravels: true };
		const [plain] = readPendingPromptList({ prompts: [overclaiming] });
		expect(plain?.answerTravels).toBe(false);
	});

	it("percent-encodes an id into the answer path", () => {
		expect(attendAnswerPath("p-1")).toBe("/prompts/p-1/answer");
		expect(attendAnswerPath("p/1")).toBe("/prompts/p%2F1/answer");
	});

	it("shows what a node that has moved on would otherwise do to this page", () => {
		// The defect, made visible: with a wire the reader does not recognise, EVERY entry
		// is dropped and the page paints "Nothing pending" over a farm full of questions.
		// That is why the envelope check has to run before the reader, not after it.
		const moved = {
			wire: "pending-prompt.v2",
			prompts: PROMPTS.map(published).map((entry) => ({ ...entry, wire: "pending-prompt.v2" })),
		};
		expect(readPendingPromptList(moved)).toEqual([]);
		expect(checkAttendListWire(moved).verdict).toBe("incompatible");
	});

	it("names the reserved identities without letting a device impersonate one", () => {
		expect(describeAttendingDevice(" terminal")).toBe("the terminal that asked");
		expect(describeAttendingDevice(" node-local")).toBe("the node itself");
		expect(describeAttendingDevice("my-phone")).toBe("my-phone");
		expect(describeAttendingDevice(null)).toBe("another surface");
		expect(describeAttendingDevice("")).toBe("another surface");
	});
});

/**
 * THE drift guard.
 *
 * `wire.ts` re-implements what `@refarm.dev/prompt-contract-v1` already does, because the
 * block's entry point statically imports `node:readline` and therefore cannot be loaded
 * by a browser (the file's own header explains the alternatives and why they are worse).
 * A copy is only acceptable while something fails when it stops being a copy — this is
 * that something. It runs BOTH implementations over one table and demands agreement.
 */
describe("the browser reader agrees with the block, case for case", () => {
	it("parses the same list the block parses", () => {
		const body = { wire: "pending-prompt.v1", prompts: PROMPTS.map(published) };
		expect(readPendingPromptList(body)).toEqual(parsePendingPromptList(body));
	});

	it("agrees on which malformed entries survive", () => {
		const body = {
			prompts: [
				published(PROMPTS[2]!, 2),
				{ wire: "wrong.v1", id: "x", prompt: { type: "text", question: "?" }, asker: { command: "c" }, askedAt: 1 },
				{ wire: "pending-prompt.v1", id: "", prompt: { type: "text", question: "?" }, asker: { command: "c" }, askedAt: 1 },
				{ wire: "pending-prompt.v1", id: "y", prompt: { type: "select", question: "?", options: [] }, asker: { command: "c" }, askedAt: 1 },
				{ wire: "pending-prompt.v1", id: "z", prompt: { type: "text", question: "?" }, asker: {}, askedAt: 1 },
				{ wire: "pending-prompt.v1", id: "w", prompt: { type: "text", question: "?" }, asker: { command: "c" }, askedAt: "soon" },
			],
		};
		expect(readPendingPromptList(body)).toEqual(parsePendingPromptList(body));
	});

	it("agrees on P4 for every kind", () => {
		for (const prompt of PROMPTS) {
			expect(attendAnswerTravels(prompt)).toBe(promptAnswerTravels(prompt));
		}
	});

	it("agrees on every answer the shape accepts and refuses", () => {
		const values: unknown[] = [true, false, "yes", "n", "1", "no", "a", "b", "zzz", "", 42, null, {}];
		for (const prompt of PROMPTS) {
			for (const value of values) {
				expect({ prompt, value, check: checkAttendAnswer(prompt, value) }).toEqual({
					prompt,
					value,
					check: checkPendingPromptAnswer(prompt, value),
				});
			}
		}
	});

	it("never quotes the submitted value in a refusal — a secret must not reach a DOM node", () => {
		const secret = PROMPTS[6]!;
		const refusal = checkAttendAnswer(secret, 12345);
		expect(refusal.ok).toBe(false);
		if (refusal.ok) return;
		expect(refusal.reason).not.toContain("12345");
	});

	it("speaks the SAME version the block declares", () => {
		// The one constant that must never drift: the page's literal and the block's
		// exported constant are the same string, or this whole check is checking nothing.
		expect(ATTEND_WIRE).toBe(PENDING_PROMPT_WIRE);
	});

	it("returns the same wire verdict for every envelope worth disagreeing about", () => {
		const bodies: unknown[] = [
			{ pollIntervalMs: 2000, prompts: [], wire: "pending-prompt.v1" },
			{ pollIntervalMs: 2000, prompts: [], wire: "pending-prompt.v2" },
			{ pollIntervalMs: 2000, prompts: [], wire: "pending-prompt.v0" },
			{ pollIntervalMs: 2000, prompts: [], wire: "pending-prompt.v1 " },
			{ pollIntervalMs: 2000, prompts: [], wire: "" },
			{ pollIntervalMs: 2000, prompts: [], wire: null },
			{ pollIntervalMs: 2000, prompts: [], wire: 1 },
			{ pollIntervalMs: 2000, prompts: [] },
			{},
			null,
			undefined,
			7,
			"pending-prompt.v1",
			[{ wire: "pending-prompt.v1" }],
		];
		for (const body of bodies) {
			expect({ body, check: checkAttendListWire(body) }).toEqual({
				body,
				check: checkPendingPromptListWire(body),
			});
		}
	});
});

describe("the declared wire version, in a browser", () => {
	/** What `GET /prompts` returns from the node today, pinned as a literal. This is the
	 *  shape the operator's surfaces are talking to right now, and it must keep passing. */
	const LIVE_ENVELOPE = { pollIntervalMs: 2000, prompts: [], wire: "pending-prompt.v1" };

	it("says compatible for the envelope the node serves today", () => {
		expect(checkAttendListWire(LIVE_ENVELOPE)).toEqual({
			verdict: "compatible",
			declared: "pending-prompt.v1",
			expected: ATTEND_WIRE,
		});
	});

	it("says incompatible for a version this page does not speak", () => {
		const check = checkAttendListWire({ ...LIVE_ENVELOPE, wire: "pending-prompt.v2" });
		expect(check.verdict).toBe("incompatible");
		expect(check.declared).toBe("pending-prompt.v2");
		expect(check.expected).toBe(ATTEND_WIRE);
	});

	it("says unknown — never compatible — when the node declared nothing", () => {
		for (const body of [
			{ pollIntervalMs: 2000, prompts: [] },
			{ ...LIVE_ENVELOPE, wire: "" },
			{ ...LIVE_ENVELOPE, wire: 2 },
			{ ...LIVE_ENVELOPE, wire: null },
			null,
			undefined,
			"not an object",
			[LIVE_ENVELOPE],
		]) {
			const check = checkAttendListWire(body);
			expect(check.verdict).toBe("unknown");
			expect(check.verdict).not.toBe("compatible");
			expect(check.declared).toBeNull();
		}
	});

	it("compares by exact match — a near-miss refuses rather than guessing", () => {
		for (const near of [
			"pending-prompt.v1 ",
			"Pending-Prompt.v1",
			"pending-prompt.v10",
			"pending-prompt",
		]) {
			expect(checkAttendWire(near).verdict).toBe("incompatible");
		}
		expect(checkAttendWire(ATTEND_WIRE).verdict).toBe("compatible");
	});

	it("reads the declared version off an envelope, or null", () => {
		expect(readDeclaredAttendWire(LIVE_ENVELOPE)).toBe("pending-prompt.v1");
		expect(readDeclaredAttendWire({ prompts: [] })).toBeNull();
	});
});
