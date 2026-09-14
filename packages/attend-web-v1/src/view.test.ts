import { toPendingPrompt, type OperatorPrompt } from "@refarm.dev/prompt-contract-v1";
import { describe, expect, it } from "vitest";

import { ATTEND_TRAVEL_NOTICE, attendControlFor, attendPromptView } from "./view.js";

const NOW = 1_800_000_000_000;

function pending(prompt: OperatorPrompt, timeoutMs: number | null = null) {
	return toPendingPrompt(prompt, {
		id: "p-1",
		asker: { command: "refarm auth enrol", host: "tuono" },
		askedAt: NOW,
		timeoutMs,
	});
}

describe("each prompt kind, rendered as data", () => {
	it("confirm offers BOTH answers and marks the shape's default", () => {
		expect(attendControlFor({ type: "confirm", question: "Apply?" })).toEqual({
			control: "confirm",
			affirm: "Yes",
			deny: "No",
			// An omitted default is `true` — the block's rule, not this file's invention.
			default: true,
		});
		expect(attendControlFor({ type: "confirm", question: "Apply?", default: false })).toMatchObject({
			control: "confirm",
			default: false,
		});
	});

	it("select offers exactly the options the shape carries, and nothing else", () => {
		const control = attendControlFor({
			type: "select",
			question: "Which lane?",
			options: [
				{ value: "a", label: "Lane A" },
				{ value: "b", label: "Lane B", description: "the slow one" },
			],
			default: "b",
		});
		expect(control).toEqual({
			control: "select",
			choices: [
				{ value: "a", label: "Lane A", description: null, selected: false },
				{ value: "b", label: "Lane B", description: "the slow one", selected: true },
			],
		});
	});

	it("select marks nothing when the default names an option that is not offered", () => {
		const control = attendControlFor({
			type: "select",
			question: "?",
			options: [{ value: "a", label: "A" }],
			default: "gone",
		});
		expect(control).toMatchObject({ control: "select" });
		if (control.control !== "select") return;
		expect(control.choices.some((choice) => choice.selected)).toBe(false);
	});

	it("text carries its default and placeholder, or explicit nulls", () => {
		expect(attendControlFor({ type: "text", question: "Name?" })).toEqual({
			control: "text",
			default: null,
			placeholder: null,
		});
		expect(
			attendControlFor({ type: "text", question: "Name?", default: "farm", placeholder: "short" }),
		).toEqual({ control: "text", default: "farm", placeholder: "short" });
	});

	it("secret is masked, and says so as a field the page must read", () => {
		expect(attendControlFor({ type: "secret", question: "Token?" })).toEqual({
			control: "secret",
			masked: true,
			visibleTail: 0,
		});
		expect(attendControlFor({ type: "secret", question: "Token?", visibleTail: 4 })).toMatchObject({
			masked: true,
			visibleTail: 4,
		});
	});

	it("a kind this surface has not learned yet is `unsupported`, not a blank card", () => {
		const control = attendControlFor({ type: "future-kind", question: "?" } as unknown as OperatorPrompt);
		expect(control).toEqual({ control: "unsupported", type: "future-kind" });
	});
});

describe("P4 — a secret says it travels BEFORE the operator types", () => {
	it("a secret prompt carries the notice", () => {
		const view = attendPromptView(pending({ type: "secret", question: "Token?" }), NOW);
		expect(view.travelNotice).toBe(ATTEND_TRAVEL_NOTICE);
		// The two things the notice must contain: that it crosses, and the alternative.
		expect(view.travelNotice).toContain("CROSSES THE NETWORK");
		expect(view.travelNotice).toContain("answer at the terminal");
	});

	it("no other kind carries it", () => {
		for (const prompt of [
			{ type: "confirm", question: "?" },
			{ type: "select", question: "?", options: [{ value: "a", label: "A" }] },
			{ type: "text", question: "?" },
		] as OperatorPrompt[]) {
			expect(attendPromptView(pending(prompt), NOW).travelNotice).toBeNull();
		}
	});

	it("the notice comes from the KIND, so a payload cannot strip it", () => {
		const lying = { ...pending({ type: "secret", question: "Token?" }), answerTravels: false };
		expect(attendPromptView(lying, NOW).travelNotice).toBe(ATTEND_TRAVEL_NOTICE);
	});
});

describe("P5 — the asker's deadline is shown, and its passing is visible", () => {
	it("states what is left, coarsely, and null when no deadline was declared", () => {
		expect(attendPromptView(pending({ type: "text", question: "?" }, 45_000), NOW).deadline).toBe("45s left");
		expect(attendPromptView(pending({ type: "text", question: "?" }, 600_000), NOW).deadline).toBe("10 min left");
		expect(attendPromptView(pending({ type: "text", question: "?" }, null), NOW).deadline).toBeNull();
	});

	it("marks a passed deadline as expired and says so", () => {
		const view = attendPromptView(pending({ type: "text", question: "?" }, 10_000), NOW + 10_001);
		expect(view.expired).toBe(true);
		expect(view.deadline).toBe("the asker's deadline has passed");
	});

	it("a prompt with no deadline is never expired", () => {
		const view = attendPromptView(pending({ type: "text", question: "?" }, null), NOW + 10 ** 9);
		expect(view.expired).toBe(false);
	});
});

describe("the view model names the asker so a question is recognisable at a glance", () => {
	it("carries the command and the host", () => {
		const view = attendPromptView(pending({ type: "text", question: "Name?" }), NOW);
		expect(view.asker).toBe("refarm auth enrol on tuono");
		expect(view.question).toBe("Name?");
		expect(view.id).toBe("p-1");
	});

	it("omits the host when the asker declared none", () => {
		const withoutHost = toPendingPrompt({ type: "text", question: "?" }, {
			id: "p-2",
			asker: { command: "refarm workspace run" },
			askedAt: NOW,
		});
		expect(attendPromptView(withoutHost, NOW).asker).toBe("refarm workspace run");
	});
});
