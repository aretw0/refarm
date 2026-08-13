import path from "node:path";
import { describe, expect, it } from "vitest";

import {
	classifyEntry,
	formatInventory,
	sovereignLocations,
	summariseInventory,
	type InventoryEntry,
} from "./sovereign-inventory.js";

/**
 * The inventory's job is to answer "what must a backup contain", so these pin the two ways it
 * could lie: calling something recoverable that is not (a backup that silently skips it), and
 * calling a scratch file data (a backup of debris that hides the real list).
 */
const entry = (overrides: Partial<InventoryEntry> & { file: string }): InventoryEntry => ({
	bytes: 1,
	recoverability: "unknown",
	source: "none",
	reason: "",
	declared: false,
	...overrides,
});

describe("classifyEntry", () => {
	it("classifies the silo by its WORST part, not its average", () => {
		// The tokens inside DO come back from a login. The model route beside them does not, and
		// ISS-121 is the case where exactly that was destroyed with nothing able to say what it had
		// been. A file that is partly recoverable is not a recoverable file.
		const verdict = classifyEntry("/home/op/.silo/identity.json", "default");
		expect(verdict.recoverability).toBe("irrecoverable");
		expect(verdict.declared).toBe(true);
		expect(verdict.reason).toContain("model route");
	});

	it("names the node's own database from its DECLARED namespace", () => {
		const verdict = classifyEntry("/home/op/.local/share/refarm/default.db", "default");
		expect(verdict).toMatchObject({ recoverability: "irrecoverable", declared: true });
	});

	it("separates an undeclared namespace from the node's own, without calling it disposable", () => {
		// Measured on the operator's node: 67 files in the data directory, of which two carry his
		// declared namespace. The other 65 are scratch and test leftovers — but this module cannot
		// prove that, so it reports "nothing declared refers to it" and stops there. Deleting on a
		// guess is how an inventory loses the thing it exists to protect.
		const verdict = classifyEntry("/home/op/.local/share/refarm/repro.db", "default");
		expect(verdict.declared).toBe(false);
		expect(verdict.recoverability).toBe("irrecoverable");
		expect(verdict.reason).toContain("not the declared one");
	});

	it("treats a node with NO declared namespace as declaring nothing", () => {
		// Not "everything matches". An unresolved namespace must not silently promote every file in
		// the directory to this node's data.
		expect(classifyEntry("/home/op/.local/share/refarm/default.db", null).declared).toBe(false);
	});

	it("recognises the operator's hand-made backups as the only copy they are", () => {
		// Six of these exist on his node, named for what he feared losing. They are undeclared —
		// nothing points at them — and irrecoverable, which is precisely why they were made.
		const verdict = classifyEntry("/home/op/.refarm/config.json.bak-antes-do-batismo", "default");
		expect(verdict).toMatchObject({ recoverability: "irrecoverable", declared: false });
	});

	it("calls a managed cache recoverable, and says what rebuilds it", () => {
		const verdict = classifyEntry("/home/op/.refarm/model-rates.v1.json", "default");
		expect(verdict).toMatchObject({ recoverability: "recoverable", source: "rebuild" });
	});

	it("leaves an unrecognised file UNCLASSIFIED rather than assuming it is safe", () => {
		// The load-bearing default. Rounding an unclassified file to `recoverable` produces a backup
		// that skips it, silently — the exact failure this whole item exists to prevent.
		const verdict = classifyEntry("/home/op/.refarm/something-new.json", "default");
		expect(verdict.recoverability).toBe("unknown");
		expect(verdict.reason).toContain("not the same as safe");
	});
});

describe("sovereignLocations", () => {
	it("includes the data directory that `refarm context` omits", () => {
		// The gap that started this: `context` promises "the whole resolved sovereign state" and
		// never mentions ~/.local/share/refarm, where the Rust host writes {namespace}.db.
		const locations = sovereignLocations("/home/op/.refarm", "/home/op/.silo", "/home/op");
		expect(locations.dataDir).toBe(path.join("/home/op", ".local", "share", "refarm"));
	});
});

describe("summariseInventory", () => {
	const entries: InventoryEntry[] = [
		entry({ file: "/n/.silo/identity.json", recoverability: "irrecoverable", declared: true }),
		entry({ file: "/n/d/default.db", recoverability: "irrecoverable", declared: true }),
		entry({ file: "/n/d/repro.db", recoverability: "irrecoverable", declared: false }),
		entry({ file: "/n/.refarm/model-rates.v1.json", recoverability: "recoverable" }),
		entry({ file: "/n/.refarm/mystery.json", recoverability: "unknown" }),
	];

	it("reports counts, so a growing pile of unclassified files cannot look like progress", () => {
		expect(summariseInventory(entries)).toMatchObject({
			total: 5,
			irrecoverable: 3,
			recoverable: 1,
			unknown: 1,
			undeclaredIrrecoverable: 1,
		});
	});

	it("the backup list is what is irrecoverable AND declared", () => {
		// Undeclared irrecoverable files are counted but not listed for backup: backing up 65 scratch
		// databases would bury the two files that actually stand the node up again.
		expect(summariseInventory(entries).mustBackUp).toEqual(["/n/.silo/identity.json", "/n/d/default.db"]);
	});

	it("finds the same namespace in two places — the defect it found on the real node", () => {
		// Measured 2026-08-12: `default.db` existed in ~/.refarm/data/refarm/ (294KB, open by the
		// node) and in ~/.local/share/refarm/ (49KB, a week stale). The stale one is the path the
		// Rust source documents, so a backup guided by the documentation would have saved the wrong
		// database and reported success.
		const dupes = summariseInventory([
			entry({ file: "/n/.refarm/data/refarm/default.db", recoverability: "irrecoverable", declared: true }),
			entry({ file: "/n/.local/share/refarm/default.db", recoverability: "irrecoverable", declared: true }),
			entry({ file: "/n/.local/share/refarm/repro.db", recoverability: "irrecoverable" }),
		]).duplicateNamespaces;
		expect(dupes).toEqual([
			{
				namespace: "default",
				files: ["/n/.local/share/refarm/default.db", "/n/.refarm/data/refarm/default.db"],
			},
		]);
	});

	it("a namespace in ONE place is not ambiguous", () => {
		const dupes = summariseInventory([
			entry({ file: "/n/.refarm/data/refarm/default.db", recoverability: "irrecoverable" }),
		]).duplicateNamespaces;
		expect(dupes).toEqual([]);
	});

	it("an empty node summarises as empty rather than as complete", () => {
		expect(summariseInventory([])).toMatchObject({ total: 0, irrecoverable: 0, mustBackUp: [] });
	});
});

describe("formatInventory", () => {
	it("names the places it looked, because that is the report's credibility", () => {
		const locations = sovereignLocations("/home/op/.refarm", "/home/op/.silo", "/home/op");
		const entries = [entry({ file: "/n/x", recoverability: "unknown" })];
		const text = formatInventory(locations, entries, summariseInventory(entries));
		expect(text).toContain("/home/op/.refarm");
		expect(text).toContain("/home/op/.silo");
		expect(text).toContain(path.join("/home/op", ".local", "share", "refarm"));
	});

	it("says plainly that unclassified is not safe", () => {
		const locations = sovereignLocations("/a", "/b", "/c");
		const entries = [entry({ file: "/n/x", recoverability: "unknown" })];
		const text = formatInventory(locations, entries, summariseInventory(entries));
		expect(text).toMatch(/UNCLASSIFIED, which is not the same as safe/u);
	});

	it("refuses to call undeclared entries disposable", () => {
		const locations = sovereignLocations("/a", "/b", "/c");
		const entries = [entry({ file: "/n/x.db", recoverability: "irrecoverable", declared: false })];
		const text = formatInventory(locations, entries, summariseInventory(entries));
		expect(text).toContain("Undeclared is not the same as disposable");
	});
});
