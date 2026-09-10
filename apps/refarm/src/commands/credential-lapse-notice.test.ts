import { describe, expect, it, vi } from "vitest";

import {
	credentialLapseMessage,
	publishCredentialLapse,
} from "./credential-lapse-notice.js";

const channel = {
	declaration: { name: "telegram", unattended: false },
	adapter: { id: "telegram", capability: "answer", unattended: true },
} as never;

describe("credentialLapseMessage", () => {
	it("names what happened and the one command that fixes it", () => {
		const message = credentialLapseMessage("the provider refused the refresh token.");
		expect(message).toContain("could not renew");
		expect(message).toContain("sow");
		// The reason travels: "a credential lapsed" alone sends the operator looking.
		expect(message).toContain("the provider refused the refresh token.");
	});
});

describe("publishCredentialLapse", () => {
	it("sends nothing and refuses nothing when no channel is declared", async () => {
		const send = vi.fn();
		const notice = await publishCredentialLapse("x", {
			loadDelivery: () => ({ channels: [], issues: [] }) as never,
			send: send as never,
		});
		expect(notice).toEqual({ delivered: [], refused: [] });
		expect(send).not.toHaveBeenCalled();
	});

	it("publishes it as a NOTICE, never as a question", async () => {
		// PARAMETER DECLARED so the mock's call tuple carries its type. An untyped
		// `vi.fn(async () => ...)` records calls as `[]`, and every argument assertion becomes a
		// cast tsc refuses. vitest never sees it — the package BUILD does. Fourth time this week.
		const send = vi.fn(
			async (_input: { request: { needsDecision: boolean } }) =>
				[{ adapter: "telegram", status: "delivered" }] as never,
		);
		await publishCredentialLapse("x", {
			loadDelivery: () => ({ channels: [channel], issues: [] }) as never,
			attending: () => true,
			send: send as never,
		});
		const request = send.mock.calls[0]?.[0].request;
		expect(request).toBeDefined();
		// Nothing is settled by an answer: the node already tried what it could do alone, and what
		// remains needs a browser. An announce-only transport may carry it.
		expect(request?.needsDecision).toBe(false);
	});

	// THE CASE THAT MATTERS ON THIS NODE. The declared channel is attended-only and no window is
	// armed, so the notice cannot land — and a notice that evaporates is the same defect one
	// layer up from the one this fixes.
	it("reports why nothing could carry it, instead of evaporating", async () => {
		const notice = await publishCredentialLapse("the provider refused.", {
			loadDelivery: () => ({ channels: [channel], issues: [] }) as never,
			attending: () => false,
			send: async () => [] as never,
		});
		expect(notice.delivered).toEqual([]);
		expect(notice.refused).toHaveLength(1);
		expect(notice.refused[0]?.channel).toBe("telegram");
		expect(notice.refused[0]?.reason).toContain("attending");
	});

	it("names the adapters that carried it", async () => {
		const notice = await publishCredentialLapse("x", {
			loadDelivery: () => ({ channels: [channel], issues: [] }) as never,
			attending: () => true,
			send: async () =>
				[
					{ adapter: "telegram", status: "delivered" },
					{ adapter: "pigeon", status: "could-not-attempt" },
				] as never,
		});
		expect(notice.delivered).toEqual(["telegram"]);
	});
});
