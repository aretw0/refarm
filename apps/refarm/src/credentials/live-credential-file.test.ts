import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LIVE_CREDENTIALS_FILE, liveCredentialsPath, writeLiveCredentials } from "./live-credential-file.js";

let home: string;
beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-live-cred-"));
});
afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
});

describe("writeLiveCredentials", () => {
	it("writes the map where the host will re-read it", () => {
		const written = writeLiveCredentials(home, '{"model-account:A":{"access":"tid=x"}}');
		expect(written).toBe(liveCredentialsPath(home));
		expect(JSON.parse(fs.readFileSync(written!, "utf-8"))).toEqual({
			"model-account:A": { access: "tid=x" },
		});
	});

	it("refuses to write an EMPTY map, which would blank a working node", () => {
		// The host falls back to its inline copy when the file is missing. Writing `{}` would
		// instead hand it a map with no seats in it — worse than never having written one.
		expect(writeLiveCredentials(home, "{}")).toBeNull();
		expect(writeLiveCredentials(home, "   ")).toBeNull();
		expect(fs.existsSync(liveCredentialsPath(home))).toBe(false);
	});

	it("is readable only by the operator, because it IS the credential", () => {
		const written = writeLiveCredentials(home, '{"a":{"access":"t"}}')!;
		expect(fs.statSync(written).mode & 0o777).toBe(0o600);
	});

	it("leaves no partial file behind for the host to read mid-write", () => {
		// The host reads this on a dispatch path. A half-written map read at the wrong instant
		// would blank a seat that is perfectly good, so the write lands by rename.
		writeLiveCredentials(home, '{"a":{"access":"t"}}');
		expect(fs.readdirSync(home)).toEqual([LIVE_CREDENTIALS_FILE]);
	});

	it("is named so the sovereign layout already treats it as a secret", () => {
		// `.token` is in SOVEREIGN_LAYOUT's secret suffixes, so this is never carried into a
		// bundle and the manifest names it as something to re-obtain. Inherited, not restated.
		expect(LIVE_CREDENTIALS_FILE.endsWith(".token")).toBe(true);
	});
});
