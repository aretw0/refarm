import { describe, expect, it } from "vitest";

import {
	ATTEND_CREDENTIAL_KEY,
	ATTEND_EXPIRY_MARGIN_MS,
	attendCredentialExpired,
	attendCredentialFromGrant,
	attendCredentialRemainingMs,
	clearAttendCredential,
	createMemoryAttendStorage,
	describeAttendExpiry,
	loadAttendCredential,
	parseAttendCredential,
	saveAttendCredential,
	type AttendStorage,
} from "./credential.js";

const NOW = 1_800_000_000_000;
const credential = { token: "s3cret-bearer", scope: ["prompt:answer"], expiresAt: NOW + 600_000 };

describe("the scoped credential in the browser", () => {
	it("round-trips through storage", () => {
		const storage = createMemoryAttendStorage();
		saveAttendCredential(storage, credential);
		expect(loadAttendCredential(storage, NOW)).toEqual(credential);
	});

	it("shows its expiry, coarsely", () => {
		expect(describeAttendExpiry({ ...credential, expiresAt: NOW + 45_000 }, NOW)).toBe("expires in 45s");
		expect(describeAttendExpiry({ ...credential, expiresAt: NOW + 600_000 }, NOW)).toBe("expires in 10 min");
		expect(describeAttendExpiry({ ...credential, expiresAt: NOW + 4 * 3_600_000 }, NOW)).toBe("expires in 4 h");
		expect(describeAttendExpiry({ ...credential, expiresAt: NOW - 1 }, NOW)).toBe("expired");
	});

	it("never hands back an expired credential — it deletes it and answers null", () => {
		const storage = createMemoryAttendStorage();
		saveAttendCredential(storage, { ...credential, expiresAt: NOW - 1 });
		expect(loadAttendCredential(storage, NOW)).toBeNull();
		// Deleted, not merely hidden: a bearer whose only remaining use is to be refused
		// must not stay on the device.
		expect(storage.getItem(ATTEND_CREDENTIAL_KEY)).toBeNull();
	});

	it("treats the last half-minute as already gone, so an expiry cannot land mid-form", () => {
		const storage = createMemoryAttendStorage();
		const nearly = { ...credential, expiresAt: NOW + ATTEND_EXPIRY_MARGIN_MS - 1 };
		saveAttendCredential(storage, nearly);
		expect(attendCredentialExpired(nearly, NOW)).toBe(true);
		expect(loadAttendCredential(storage, NOW)).toBeNull();
		// Without the margin it is still alive — the margin is the whole difference.
		expect(attendCredentialExpired(nearly, NOW, 0)).toBe(false);
	});

	it("refuses a half-written or foreign record rather than sending an undefined bearer", () => {
		for (const bad of [
			{},
			{ token: "", scope: ["prompt:answer"], expiresAt: NOW },
			{ token: "t", expiresAt: NOW },
			{ token: "t", scope: [], expiresAt: NOW },
			{ token: "t", scope: ["prompt:answer"], expiresAt: "soon" },
			"a string",
			null,
		]) {
			expect(parseAttendCredential(bad)).toBeNull();
		}

		const storage = createMemoryAttendStorage();
		storage.setItem(ATTEND_CREDENTIAL_KEY, "{not json");
		expect(loadAttendCredential(storage, NOW)).toBeNull();
		expect(storage.getItem(ATTEND_CREDENTIAL_KEY)).toBeNull();
	});

	it("survives a storage that throws — a page that cannot persist still works", () => {
		const hostile: AttendStorage = {
			getItem: () => {
				throw new Error("SecurityError");
			},
			setItem: () => {
				throw new Error("QuotaExceededError");
			},
			removeItem: () => {
				throw new Error("SecurityError");
			},
		};
		expect(() => saveAttendCredential(hostile, credential)).not.toThrow();
		expect(() => clearAttendCredential(hostile)).not.toThrow();
		expect(loadAttendCredential(hostile, NOW)).toBeNull();
	});

	it("takes the node's clamped lifetime as the deadline, not the page's wish", () => {
		const granted = attendCredentialFromGrant(
			{ token: "t", scope: ["prompt:answer"], lifetimeMs: 60_000 },
			NOW,
		);
		expect(granted.expiresAt).toBe(NOW + 60_000);
		expect(attendCredentialRemainingMs(granted, NOW + 20_000)).toBe(40_000);
		expect(attendCredentialRemainingMs(granted, NOW + 999_999)).toBe(0);
	});

	it("stores the scope so the page can show it rather than assert it", () => {
		const granted = attendCredentialFromGrant(
			{ token: "t", scope: ["prompt:answer"], lifetimeMs: 1 },
			NOW,
		);
		expect(granted.scope).toEqual(["prompt:answer"]);
	});
});
