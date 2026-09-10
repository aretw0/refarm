import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	CONTACTS_LOCATION_LOCAL,
	CONTACTS_LOCATION_PROJECT,
	loadContacts,
	readContacts,
	resolveContactsDir,
	saveContacts,
} from "./index.js";

let dir;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "refarm-contacts-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("resolveContactsDir", () => {
	it("puts a local store under the base the caller names", () => {
		expect(resolveContactsDir({ location: CONTACTS_LOCATION_LOCAL, localBase: "/n" })).toBe(
			"/n/contacts",
		);
	});

	it("puts a project store under the project base", () => {
		expect(resolveContactsDir({ location: CONTACTS_LOCATION_PROJECT, projectBase: "/p" })).toBe(
			"/p/contacts",
		);
	});

	it("takes an explicit path as given", () => {
		expect(resolveContactsDir({ location: "/somewhere/else" })).toBe("/somewhere/else");
	});

	it("refuses to guess a base", () => {
		// The original resolved one consumer's home. Topology carries real chat ids; WHERE it
		// lives is a decision about what gets synced, and that belongs to the caller.
		expect(() => resolveContactsDir({ location: CONTACTS_LOCATION_LOCAL })).toThrow(/localBase/);
	});
});

describe("readContacts", () => {
	it("reads an absent store as absent, not as empty", () => {
		const read = readContacts("telegram", dir);
		expect(read.state).toBe("absent");
		expect(read.contacts).toEqual([]);
	});

	it("distinguishes an unreadable store from an absent one", () => {
		writeFileSync(join(dir, "telegram.json"), "{ not json");
		const read = readContacts("telegram", dir);
		expect(read.state).toBe("unreadable");
		expect(read.reason).toBeTruthy();
	});
});

describe("saveContacts", () => {
	it("keeps what is already there and merges by id", () => {
		saveContacts("telegram", [{ platform: "telegram", id: "1", name: "Ana" }], dir);
		const merged = saveContacts(
			"telegram",
			[
				{ platform: "telegram", id: "2", name: "Bruno" },
				{ platform: "telegram", id: "1", handle: "@ana" },
			],
			dir,
		);
		expect(merged.map((contact) => contact.id).sort()).toEqual(["1", "2"]);
		// The merge is per-field, not a replacement: the name survives the handle arriving later.
		expect(merged.find((contact) => contact.id === "1")).toMatchObject({
			name: "Ana",
			handle: "@ana",
		});
	});

	// THE BUG THIS PROMOTION FIXES, and it is data loss. The original merged onto whatever the
	// loader returned, and the loader returned [] for a corrupt file — so one bad byte turned
	// "every destination this bot can reach" into "the handful discovered just now", written over
	// the top, silently.
	it("refuses to overwrite an unreadable store rather than dropping every destination", () => {
		writeFileSync(join(dir, "telegram.json"), "{ corrupted");
		expect(() =>
			saveContacts("telegram", [{ platform: "telegram", id: "9" }], dir),
		).toThrow(/unreadable contacts store/);
		// And it did not write: the corrupt file is still there to be recovered or inspected.
		expect(readFileSync(join(dir, "telegram.json"), "utf8")).toBe("{ corrupted");
	});

	it("sorts with the caller's locale, not one of its own", () => {
		const merged = saveContacts(
			"telegram",
			[
				{ platform: "telegram", id: "1", name: "Zeta" },
				{ platform: "telegram", id: "2", name: "Ácido" },
			],
			dir,
			{ locale: "pt" },
		);
		// Portuguese collation puts Á before Z; a byte sort would not.
		expect(merged[0]?.name).toBe("Ácido");
	});

	it("stamps the write with an injectable clock", () => {
		saveContacts("telegram", [{ platform: "telegram", id: "1" }], dir, {
			now: () => "2026-01-01T00:00:00.000Z",
		});
		const written = JSON.parse(readFileSync(join(dir, "telegram.json"), "utf8"));
		expect(written.updatedAt).toBe("2026-01-01T00:00:00.000Z");
		expect(written.platform).toBe("telegram");
	});
});

describe("loadContacts", () => {
	it("returns the list for readers that only want it", () => {
		saveContacts("telegram", [{ platform: "telegram", id: "1" }], dir);
		expect(loadContacts("telegram", dir)).toHaveLength(1);
	});

	it("returns empty for an unreadable store — which is why writers must not use it", () => {
		writeFileSync(join(dir, "telegram.json"), "{ bad");
		expect(loadContacts("telegram", dir)).toEqual([]);
	});
});
