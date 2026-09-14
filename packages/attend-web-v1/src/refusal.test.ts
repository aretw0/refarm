import { describe, expect, it } from "vitest";

import {
	classifyAttendAnswerResponse,
	classifyAttendListResponse,
	describeAttendRefusal,
	describeAttendWireNotice,
	refusalIsSettlement,
	refusalIsTerminal,
	refusalNeedsNewCredential,
	unreachableRefusal,
} from "./refusal.js";
import { ATTEND_WIRE, checkAttendListWire, describeAttendingDevice } from "./wire.js";

const describe_ = (device: string | null) => describeAttendingDevice(device);

describe("401, 409 and unreachable are three different things", () => {
	it("401 says the credential is done, and ONLY that says re-handshake", () => {
		const outcome = classifyAttendAnswerResponse(401, { error: "unauthorized" });
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.refusal.reason).toBe("credential-expired");
		expect(refusalNeedsNewCredential(outcome.refusal)).toBe(true);
		expect(refusalIsSettlement(outcome.refusal)).toBe(false);
		expect(describeAttendRefusal(outcome.refusal, describe_)).toContain("expired");
	});

	it("403 is the same verdict as 401 — the gate refuses to say which", () => {
		const forbidden = classifyAttendListResponse(403, {});
		expect(forbidden.ok).toBe(false);
		if (forbidden.ok) return;
		expect(forbidden.refusal).toEqual({ reason: "credential-expired", status: 403 });
	});

	it("409 names the device that won, and is NOT treated as a failure", () => {
		const outcome = classifyAttendAnswerResponse(409, {
			error: "already-settled",
			outcome: "answered",
			device: "my-phone",
		});
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.refusal).toEqual({
			reason: "settled-elsewhere",
			settled: { device: "my-phone", outcome: "answered", reason: null },
		});
		expect(refusalIsSettlement(outcome.refusal)).toBe(true);
		expect(refusalNeedsNewCredential(outcome.refusal)).toBe(false);
		// P2: the operator must be told WHICH device, not merely that they lost.
		expect(describeAttendRefusal(outcome.refusal, describe_)).toContain("my-phone");
	});

	it("409 translates the block's reserved identities into something a person reads", () => {
		const terminal = classifyAttendAnswerResponse(409, { outcome: "answered", device: " terminal" });
		expect(terminal.ok).toBe(false);
		if (terminal.ok) return;
		expect(describeAttendRefusal(terminal.refusal, describe_)).toContain("the terminal that asked");

		const local = classifyAttendAnswerResponse(409, { outcome: "answered", device: " node-local" });
		expect(local.ok).toBe(false);
		if (local.ok) return;
		expect(describeAttendRefusal(local.refusal, describe_)).toContain("the node itself");
	});

	it("409 with outcome=abandoned says nobody answered, and why", () => {
		for (const [reason, phrase] of [
			["expired", "deadline passed"],
			["cancelled", "cancelled at the terminal"],
			["withdrawn", "withdrew"],
		] as const) {
			const outcome = classifyAttendAnswerResponse(409, { outcome: "abandoned", device: " terminal", reason });
			expect(outcome.ok).toBe(false);
			if (outcome.ok) return;
			const line = describeAttendRefusal(outcome.refusal, describe_);
			expect(line).toContain("without an answer");
			expect(line).toContain(phrase);
		}
	});

	it("a thrown fetch is `unreachable`, keeps its message, and never asks for a new credential", () => {
		const refusal = unreachableRefusal(new TypeError("Failed to fetch"));
		expect(refusal).toEqual({ reason: "unreachable", detail: "Failed to fetch" });
		expect(refusalNeedsNewCredential(refusal)).toBe(false);
		expect(refusalIsSettlement(refusal)).toBe(false);
		// The sentence must say it is the network, so nobody goes hunting for a credential
		// problem that is not there.
		expect(describeAttendRefusal(refusal, describe_)).toContain("network");
	});

	it("the three produce three different sentences", () => {
		const sentences = new Set(
			[
				{ reason: "credential-expired", status: 401 } as const,
				{
					reason: "settled-elsewhere" as const,
					settled: { device: "my-phone", outcome: "answered", reason: null },
				},
				{ reason: "unreachable", detail: "connect ECONNREFUSED" } as const,
			].map((refusal) => describeAttendRefusal(refusal, describe_)),
		);
		expect(sentences.size).toBe(3);
	});

	it("404 is the asker being gone (P1), not an error", () => {
		const outcome = classifyAttendAnswerResponse(404, { error: "unknown-prompt" });
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.refusal).toEqual({ reason: "asker-gone" });
		expect(refusalIsSettlement(outcome.refusal)).toBe(true);
		expect(describeAttendRefusal(outcome.refusal, describe_)).toContain("gone");
	});

	it("400 carries the shape's detail, and 500 states the status rather than guessing", () => {
		const invalid = classifyAttendAnswerResponse(400, {
			error: "invalid-answer",
			detail: "select expects one of the offered option values",
		});
		expect(invalid.ok).toBe(false);
		if (invalid.ok) return;
		expect(invalid.refusal).toEqual({
			reason: "invalid-answer",
			detail: "select expects one of the offered option values",
		});

		const unknown = classifyAttendAnswerResponse(500, {});
		expect(unknown.ok).toBe(false);
		if (unknown.ok) return;
		expect(unknown.refusal).toEqual({ reason: "http", status: 500 });
		expect(describeAttendRefusal(unknown.refusal, describe_)).toContain("500");
	});

	it("200 is this surface's own answer winning, with the device the gate recorded", () => {
		expect(classifyAttendAnswerResponse(200, { outcome: "answered", device: "laptop-browser" })).toEqual({
			ok: true,
			device: "laptop-browser",
		});
	});

	it("a body that is not an object never crashes the classifier", () => {
		for (const body of [undefined, null, "an html error page", 42, []]) {
			expect(() => classifyAttendAnswerResponse(409, body)).not.toThrow();
			expect(() => classifyAttendListResponse(500, body)).not.toThrow();
		}
		const outcome = classifyAttendAnswerResponse(409, "<html>502</html>");
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.refusal.reason).toBe("settled-elsewhere");
		// No device claimed where none was given — "another surface", never a guess.
		expect(describeAttendRefusal(outcome.refusal, describe_)).toContain("another surface");
	});
});

describe("a node that has moved to another wire version", () => {
	const LIVE = { pollIntervalMs: 2000, prompts: [], wire: ATTEND_WIRE };

	it("a 200 declaring THIS version is admitted, and carries the verdict through", () => {
		const classified = classifyAttendListResponse(200, LIVE);
		expect(classified.ok).toBe(true);
		if (!classified.ok) return;
		expect(classified.wire.verdict).toBe("compatible");
		expect(classified.body).toBe(LIVE);
	});

	it("a 200 declaring a version this page cannot speak is REFUSED, not read", () => {
		const classified = classifyAttendListResponse(200, { ...LIVE, wire: "pending-prompt.v2" });
		expect(classified.ok).toBe(false);
		if (classified.ok) return;
		expect(classified.refusal).toEqual({
			reason: "wire-incompatible",
			declared: "pending-prompt.v2",
			expected: ATTEND_WIRE,
		});
	});

	it("the refusal names what is old, what is new, and the one thing that fixes it", () => {
		const classified = classifyAttendListResponse(200, { ...LIVE, wire: "pending-prompt.v2" });
		expect(classified.ok).toBe(false);
		if (classified.ok) return;
		const sentence = describeAttendRefusal(classified.refusal, describe_);
		// What this page speaks, and what the node speaks.
		expect(sentence).toContain(ATTEND_WIRE);
		expect(sentence).toContain("pending-prompt.v2");
		// The one action, spelled out — a browser's `farm-update` is a hard reload.
		expect(sentence).toContain("Reload the page");
		// And the way out that never depends on the reload working.
		expect(sentence).toContain("answer at the terminal that asked");
	});

	it("is the ONE refusal that must not be retried, and never asks for a new credential", () => {
		const refusal = {
			reason: "wire-incompatible",
			declared: "pending-prompt.v2",
			expected: ATTEND_WIRE,
		} as const;
		expect(refusalIsTerminal(refusal)).toBe(true);
		expect(refusalNeedsNewCredential(refusal)).toBe(false);
		expect(refusalIsSettlement(refusal)).toBe(false);
		// Every other refusal is worth another go.
		for (const other of [
			{ reason: "credential-expired", status: 401 } as const,
			{ reason: "unreachable", detail: "Failed to fetch" } as const,
			{ reason: "http", status: 502 } as const,
			{ reason: "asker-gone" } as const,
		]) {
			expect(refusalIsTerminal(other)).toBe(false);
		}
	});

	it("a 200 that declares NOTHING is admitted — and the page is told so", () => {
		// The operator's frozen surfaces are exactly this case. Refusing here would take a
		// working device off the air; saying nothing would claim a check that never ran.
		const classified = classifyAttendListResponse(200, { pollIntervalMs: 2000, prompts: [] });
		expect(classified.ok).toBe(true);
		if (!classified.ok) return;
		expect(classified.wire.verdict).toBe("unknown");
		expect(classified.wire.verdict).not.toBe("compatible");

		const notice = describeAttendWireNotice(classified.wire);
		expect(notice).toContain("did not declare a wire version");
		expect(notice).toContain(ATTEND_WIRE);
		// A notice, not a refusal: nothing to reload, nothing broken.
		expect(notice).not.toContain("Reload the page");
	});

	it("a matching version produces no banner at all — an always-on banner is unread", () => {
		expect(describeAttendWireNotice(checkAttendListWire(LIVE))).toBeNull();
	});
});
