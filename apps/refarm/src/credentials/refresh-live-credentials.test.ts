import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { liveCredentialsPath } from "./live-credential-file.js";
import { refreshLiveCredentials } from "./refresh-live-credentials.js";

let home: string;
beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-refresh-"));
	fs.writeFileSync(path.join(home, "config.json"), "{}");
});
afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
});

const NOW = 1_787_000_000_000;
const account = (alias: string) => ({
	credentialId: `model-account:${alias.toUpperCase()}`,
	provider: "github-copilot",
	alias,
	identity: { status: "verified" as const, subject: alias },
	secretRef: `model/${alias}`,
	health: "healthy" as const,
	revision: "sha256:r",
});

const deps = (over: Record<string, unknown> = {}) => ({
	home,
	accounts: [account("corp")],
	credentials: new Map<string, unknown>([
		["model-account:CORP", { access: "tid=stale", refresh: "ghu_x", expires: NOW - 1 }],
	]),
	buildMap: (accounts: readonly { credentialId: string }[], creds: ReadonlyMap<string, unknown>) =>
		JSON.stringify(
			Object.fromEntries(
				accounts.map((a) => [a.credentialId, { access: (creds.get(a.credentialId) as { access: string }).access }]),
			),
		),
	clientId: "Ov23-own",
	userAgent: "refarm/0.1.0",
	fetch: vi.fn(async () =>
		new Response(JSON.stringify({ token: "tid=renewed", expires_at: Math.floor(NOW / 1000) + 3600 }), {
			status: 200,
		}),
	) as unknown as typeof globalThis.fetch,
	save: vi.fn(async () => {}),
	now: () => NOW,
	...over,
});

describe("refreshLiveCredentials", () => {
	it("does NOTHING and touches no network when every credential is live", async () => {
		// This runs on a dispatch path. A node whose credentials are fine must pay a map lookup,
		// not a round trip to the provider.
		const fetchSpy = vi.fn();
		const result = await refreshLiveCredentials(
			deps({
				credentials: new Map([["model-account:CORP", { access: "tid=live", expires: NOW + 60_000 }]]),
				fetch: fetchSpy as unknown as typeof globalThis.fetch,
			}),
		);
		expect(result).toEqual({ kind: "none-stale" });
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(fs.existsSync(liveCredentialsPath(home))).toBe(false);
	});

	it("renews an expired credential and rewrites the file the RUNNING host re-reads", async () => {
		// The whole point: no restart. The host prefers this file and reads it per dispatch, so a
		// live runtime picks the renewed token up on its next call.
		const result = await refreshLiveCredentials(deps());
		expect(result).toMatchObject({ kind: "refreshed", accounts: ["corp"] });
		expect(JSON.parse(fs.readFileSync(liveCredentialsPath(home), "utf-8"))).toEqual({
			"model-account:CORP": { access: "tid=renewed" },
		});
	});

	it("says it could not renew rather than writing a file that changes nothing", async () => {
		// A refused exchange leaves the credential as it was. Writing the same map and reporting
		// success would turn a provider refusal into a silent no-op.
		const result = await refreshLiveCredentials(
			deps({
				fetch: vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof globalThis.fetch,
			}),
		);
		expect(result.kind).toBe("could-not-renew");
		expect(fs.existsSync(liveCredentialsPath(home))).toBe(false);
	});

	it("never throws out of the dispatch path", async () => {
		// A dispatch must not die because a renewal did. The provider gets the request and says
		// what it thinks of the credential.
		const result = await refreshLiveCredentials(
			deps({
				fetch: (() => {
					throw new Error("offline");
				}) as unknown as typeof globalThis.fetch,
			}),
		);
		expect(result.kind).toBe("could-not-renew");
	});
});

/**
 * ISS-081: THE SEAT THAT LAPSES WITH NOTHING WATCHING IT.
 *
 * Measured on the operator's node 2026-08-23. Three seats, three stored expiries:
 *
 *     corporativo (github-copilot)  2026-08-24T23:30:28Z   renewed itself, watched live
 *     pessoal     (github-copilot)  2026-08-24T23:30:28Z   renewed itself, watched live
 *     openai-codex                  2026-08-27T17:06:18Z   nothing will touch it
 *
 * `refreshLiveCredentials` filters `provider === "github-copilot"` before asking whether anything
 * expired, and its comment states the premise out loud — "only for the provider whose tokens
 * actually expire". The codex blob carries `expires`, so the premise is false and the command
 * whose help reads "Renew what has lapsed" answers "Nothing had lapsed — no provider was asked."
 *
 * `refreshCodexToken` is implemented, correct, registered on `openaiCodexOAuthProvider`, and has
 * no caller anywhere in the repository.
 */
describe("renewal covers every provider whose token expires, not one of them", () => {
	const codexSeat = {
		credentialId: "model-account:CODEX",
		provider: "openai-codex",
		alias: "account-2",
		identity: { status: "verified" as const, subject: "codex" },
		secretRef: "model/codex",
		health: "healthy" as const,
		revision: "sha256:r",
	};

	const codexTokenResponse = () =>
		vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						access_token: "new-access",
						refresh_token: "rotated-refresh",
						expires_in: 3600,
					}),
					{ status: 200 },
				),
		) as unknown as typeof globalThis.fetch;

	const codexDeps = (over: Record<string, unknown> = {}) =>
		deps({
			accounts: [codexSeat],
			credentials: new Map<string, unknown>([
				["model-account:CODEX", { access: "old", refresh: "old-refresh", expires: NOW - 1 }],
			]),
			fetch: codexTokenResponse(),
			...over,
		});

	it("an expired codex seat is renewed, where the lane reported nothing had lapsed", async () => {
		const result = await refreshLiveCredentials(codexDeps());

		expect(result.kind).toBe("refreshed");
	});

	it("PERSISTS THE ROTATED REFRESH TOKEN — keeping the old one bricks the seat", async () => {
		// OpenAI's refresh grant returns a NEW refresh_token and may invalidate the one presented.
		// A renewal that saves the access token and drops the rotation leaves this node holding a
		// credential the provider has already retired, and the next renewal fails with no way back
		// but a manual re-authentication. This is the assertion that makes the feature safe to ship.
		const save = vi.fn(async () => {});

		await refreshLiveCredentials(codexDeps({ save }));

		expect(save).toHaveBeenCalledWith(
			"model-account:CODEX",
			expect.objectContaining({ refresh: "rotated-refresh", access: "new-access" }),
		);
	});

	it("a live codex seat is left alone, and no network call is made", async () => {
		const fetchSpy = vi.fn();
		const result = await refreshLiveCredentials(
			codexDeps({
				credentials: new Map([
					["model-account:CODEX", { access: "live", refresh: "r", expires: NOW + 60_000 }],
				]),
				fetch: fetchSpy as unknown as typeof globalThis.fetch,
			}),
		);

		expect(result).toEqual({ kind: "none-stale" });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("a refusal from the provider keeps the stored credential rather than dropping it", async () => {
		// The rule copilot-renew already follows: a failed renewal must not remove a credential that
		// might still be accepted. The dispatch proceeds and the provider says what it thinks.
		const save = vi.fn(async () => {});
		const result = await refreshLiveCredentials(
			codexDeps({
				save,
				fetch: vi.fn(async () => new Response("nope", { status: 400 })) as unknown as typeof globalThis.fetch,
			}),
		);

		expect(result.kind).toBe("could-not-renew");
		expect(save).not.toHaveBeenCalled();
	});
});

/**
 * NOTHING ASSERTED THE RENEWED EXPIRY, on either provider. A renewal that writes a wrong `expires`
 * is worse than none: too early and the node re-exchanges on every dispatch, too late and it hands
 * the host a token the provider has already retired while `model doctor` reports it valid.
 */
describe("the renewed credential carries a computed expiry, from the injected clock", () => {
	it("codex expiry is now + expires_in, read from the clock the caller injected", async () => {
		const save = vi.fn(async () => {});
		await refreshLiveCredentials(
			deps({
				accounts: [
					{
						credentialId: "model-account:CODEX",
						provider: "openai-codex",
						alias: "account-2",
						identity: { status: "verified" as const, subject: "codex" },
						secretRef: "model/codex",
						health: "healthy" as const,
						revision: "sha256:r",
					},
				],
				credentials: new Map<string, unknown>([
					["model-account:CODEX", { access: "old", refresh: "old-refresh", expires: NOW - 1 }],
				]),
				fetch: vi.fn(
					async () =>
						new Response(
							JSON.stringify({
								access_token: "a",
								refresh_token: "r",
								expires_in: 3600,
							}),
							{ status: 200 },
						),
				) as unknown as typeof globalThis.fetch,
				save,
				now: () => NOW,
			}),
		);

		expect(save).toHaveBeenCalledWith(
			"model-account:CODEX",
			expect.objectContaining({ expires: NOW + 3_600_000 }),
		);
	});
});
