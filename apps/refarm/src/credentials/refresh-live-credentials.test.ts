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
