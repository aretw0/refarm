import { describe, expect, it, vi } from "vitest";

import {
	isExpired,
	renewCopilotIfExpired,
	renewExpiredCopilotCredentials,
} from "./copilot-renew.js";

const NOW = 1_800_000_000_000;

/** The declared identity, as the config resolves it. Fixed here so a test asserts what was SENT
 *  rather than what this module would have invented — the distinction ISS-141 cost a cycle on. */
const IDENTITY = { Accept: "application/json", "Copilot-Integration-Id": "vscode-chat" } as const;

const stored = (over: Record<string, unknown> = {}) => ({
	access: "tid=old;exp=1;proxy-ep=proxy.business.githubcopilot.com",
	refresh: "ghu_durable",
	expires: NOW - 1,
	baseUrl: "https://api.business.githubcopilot.com",
	baseUrlSource: "from-token",
	...over,
});

const EXCHANGE_BODY = {
	token: "tid=new32chars;exp=99;proxy-ep=proxy.business.githubcopilot.com",
	expires_at: Math.floor(NOW / 1000) + 3600,
};

const okFetch = (body: unknown = EXCHANGE_BODY) =>
	(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("isExpired", () => {
	it("says ABSENT is not expired, so a credential with no clock is never re-exchanged", () => {
		// Renewing on a missing field would re-exchange on every runtime start for every provider
		// whose credential carries no expiry at all.
		expect(isExpired({ access: "x" }, NOW)).toBe(false);
		expect(isExpired(null, NOW)).toBe(false);
	});

	it("compares against the stored moment, which already carries its renewal margin", () => {
		expect(isExpired({ expires: NOW - 1 }, NOW)).toBe(true);
		expect(isExpired({ expires: NOW + 1 }, NOW)).toBe(false);
	});
});

describe("renewCopilotIfExpired", () => {
	it("leaves a LIVE credential untouched, and does not reach the network", async () => {
		const fetchSpy = vi.fn();
		const saveSpy = vi.fn();
		const live = stored({ expires: NOW + 60_000 });
		const result = await renewCopilotIfExpired("id", live, {
			fetch: fetchSpy as unknown as typeof fetch,
			identityHeaders: IDENTITY,
			save: saveSpy,
			now: () => NOW,
		});
		expect(result).toBe(live);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(saveSpy).not.toHaveBeenCalled();
	});

	it("re-exchanges the DURABLE token and keeps it as the refresh material", async () => {
		// Storing the freshly minted short-lived token as `refresh` would make the NEXT renewal
		// fail — a failure that only appears once the first renewal has already succeeded.
		const saved: Record<string, unknown>[] = [];
		const result = (await renewCopilotIfExpired("id", stored(), {
			fetch: okFetch(),
			identityHeaders: IDENTITY,
			save: async (_id, credential) => void saved.push(credential),
			now: () => NOW,
		})) as { access: string; refresh: string; expires: number; baseUrl: string };

		expect(result.access).toContain("tid=new32chars");
		expect(result.refresh).toBe("ghu_durable");
		expect(result.expires).toBeGreaterThan(NOW);
		expect(saved).toHaveLength(1);
	});

	it("moves the ENDPOINT with the token, because each exchange announces where that seat talks", async () => {
		const result = (await renewCopilotIfExpired(
			"id",
			stored({ baseUrl: "https://api.individual.githubcopilot.com" }),
			{ fetch: okFetch(), identityHeaders: IDENTITY, save: async () => {}, now: () => NOW },
		)) as { baseUrl: string };
		// The exchanged token advertises the BUSINESS proxy, so the renewal must follow it rather
		// than keep a live token pointed at a stale host.
		expect(result.baseUrl).toBe("https://api.business.githubcopilot.com");
	});

	it("presents the durable token as a BEARER at the exchange url", async () => {
		let seen: { url: string; auth: string | null } | undefined;
		await renewCopilotIfExpired("id", stored(), {
			fetch: (async (url: string, init: RequestInit) => {
				seen = { url: String(url), auth: new Headers(init.headers).get("authorization") };
				return new Response(JSON.stringify(EXCHANGE_BODY), { status: 200 });
			}) as unknown as typeof fetch,
			identityHeaders: IDENTITY,
			save: async () => {},
			now: () => NOW,
		});
		expect(seen?.url).toContain("copilot_internal/v2/token");
		expect(seen?.auth).toBe("Bearer ghu_durable");
	});

	it("KEEPS the old credential when the exchange fails, rather than removing one", async () => {
		// A failed renewal must not remove a credential that might still be accepted; the request
		// that follows is what says what the provider thinks of it.
		const old = stored();
		const saveSpy = vi.fn();
		const result = await renewCopilotIfExpired("id", old, {
			fetch: (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch,
			identityHeaders: IDENTITY,
			save: saveSpy,
			now: () => NOW,
		});
		expect(result).toBe(old);
		expect(saveSpy).not.toHaveBeenCalled();
	});

	it("does not try when the stored blob carries no durable token", async () => {
		const fetchSpy = vi.fn();
		const blob = stored({ refresh: "tid=not-a-user-token" });
		const result = await renewCopilotIfExpired("id", blob, {
			fetch: fetchSpy as unknown as typeof fetch,
			identityHeaders: IDENTITY,
			save: async () => {},
			now: () => NOW,
		});
		expect(result).toBe(blob);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe("renewExpiredCopilotCredentials", () => {
	it("touches only github-copilot accounts", async () => {
		const fetchSpy = vi.fn(
			async () => new Response(JSON.stringify(EXCHANGE_BODY), { status: 200 }),
		);
		const codex = { access: "codex", refresh: "r", expires: NOW - 1 };
		const next = await renewExpiredCopilotCredentials(
			[
				{ credentialId: "codex", provider: "openai-codex" },
				{ credentialId: "copilot", provider: "github-copilot" },
			],
			new Map<string, unknown>([
				["codex", codex],
				["copilot", stored()],
			]),
			{
				fetch: fetchSpy as unknown as typeof fetch,
				identityHeaders: IDENTITY,
				save: async () => {},
				now: () => NOW,
			},
		);
		expect(next.get("codex")).toBe(codex);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});
