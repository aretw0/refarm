import { describe, expect, it, vi } from "vitest";

import {
	ensureAuthenticatedSession,
	fixtureLogin,
	isSessionValid,
	type WebSourceSessionEvidence,
} from "./index.js";

const NOW = Date.parse("2026-07-01T12:00:00.000Z");
const now = () => NOW;

const authed: WebSourceSessionEvidence = {
	kind: "authenticated",
	authenticated: true,
	principal: "analyst",
	expiresAt: "2026-07-01T13:00:00.000Z", // still valid at NOW
	credentialRef: "silo://analyst/alm",
};

describe("isSessionValid", () => {
	it("accepts an authenticated, unexpired session", () => {
		expect(isSessionValid(authed, NOW)).toBe(true);
	});
	it("rejects a missing / unauthenticated session", () => {
		expect(isSessionValid(undefined, NOW)).toBe(false);
		expect(isSessionValid({ ...authed, authenticated: false }, NOW)).toBe(false);
	});
	it("rejects an expired session", () => {
		expect(isSessionValid({ ...authed, expiresAt: "2026-07-01T11:00:00.000Z" }, NOW)).toBe(false);
	});
	it("accepts a session with no expiry as non-expiring", () => {
		const { expiresAt, ...noExpiry } = authed;
		void expiresAt;
		expect(isSessionValid(noExpiry, NOW)).toBe(true);
	});
});

describe("ensureAuthenticatedSession — the login-garantido gate", () => {
	it("reuses a valid existing session WITHOUT logging in", async () => {
		const login = vi.fn(fixtureLogin());
		const result = await ensureAuthenticatedSession({
			target: { identity: "efd" },
			existing: authed,
			login,
			now,
		});
		expect(result.loggedIn).toBe(false);
		expect(result.session).toBe(authed);
		expect(login).not.toHaveBeenCalled();
	});

	it("runs the login when there is no session", async () => {
		const login = vi.fn(fixtureLogin({ principal: "analyst" }));
		const result = await ensureAuthenticatedSession({
			target: { identity: "efd", credentialRef: "silo://analyst/alm" },
			login,
			now,
		});
		expect(result.loggedIn).toBe(true);
		expect(result.session.authenticated).toBe(true);
		expect(result.session.credentialRef).toBe("silo://analyst/alm");
		expect(login).toHaveBeenCalledOnce();
	});

	it("re-logs-in when the existing session is expired", async () => {
		const login = vi.fn(fixtureLogin());
		const result = await ensureAuthenticatedSession({
			target: { identity: "efd" },
			existing: { ...authed, expiresAt: "2026-07-01T11:00:00.000Z" },
			login,
			now,
		});
		expect(result.loggedIn).toBe(true);
		expect(login).toHaveBeenCalledOnce();
	});

	it("propagates a login failure (cancelled / bad credentials)", async () => {
		const login = vi.fn(async () => {
			throw new Error("LOGIN_CANCELLED");
		});
		await expect(
			ensureAuthenticatedSession({ target: { identity: "efd" }, login, now }),
		).rejects.toThrow(/LOGIN_CANCELLED/);
	});

	it("fixtureLogin defaults the credentialRef from the target", async () => {
		const session = await fixtureLogin()({ identity: "my-system" });
		expect(session.kind).toBe("fixture");
		expect(session.authenticated).toBe(true);
		expect(session.credentialRef).toBe("silo://fixture/my-system");
	});
});
