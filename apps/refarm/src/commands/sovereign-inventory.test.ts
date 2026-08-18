import path from "node:path";
import { describe, expect, it } from "vitest";

import {
	classifyEntry,
	dedupeInventory,
	formatInventory,
	sovereignLocations,
	summariseInventory,
	type InventoryEntry,
} from "./sovereign-inventory.js";
import { classifyByLayout } from "./sovereign-layout.js";

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
		// The wording lives in the declared layout now; what must not move is that the file is never
		// treated as recoverable just because a login rebuilds the tokens inside it.
		expect(verdict.reason).toContain("secrets never travel");
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
		expect(verdict.reason).toContain("not declared by this node");
		expect(verdict.reason).toContain("not deleted either");
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
		expect(verdict.reason).toContain("no layout entry covers this path");
	});
});

describe("sovereignLocations", () => {
	it("includes the data directory that `refarm context` omits", () => {
		// The gap that started this: `context` promises "the whole resolved sovereign state" and
		// never mentions the node's graph, where the Rust host writes {namespace}.db.
		const locations = sovereignLocations("/home/op/.refarm", "/home/op/.silo", "/home/op");
		expect(locations.dataDir).toBe(path.join("/home/op/.refarm", "data", "refarm"));
	});

	it("names the node's DECLARED graph, and the legacy location as a separate place", () => {
		// THE RULE, written 2026-08-16. `dataDir` used to BE ~/.local/share/refarm, on the belief
		// that this is where the Rust host writes. It was where the host wrote whenever
		// XDG_DATA_HOME happened to be unset — which is the leak c3f625e4 closed, and which left a
		// second `default.db` on the operator's node holding 18 nodes that existed nowhere else.
		//
		// Now the two are DIFFERENT PLACES with different meanings: `dataDir` is this node's graph,
		// and `legacyDataDir` is where an orphan from before the fix may still sit. Keeping the
		// legacy path in the inventory matters — dropping it would hide exactly the file that
		// proved the leak — but calling it the node's data is what made a backup ambiguous.
		const locations = sovereignLocations("/home/op/.refarm", "/home/op/.silo", "/home/op");
		expect(locations.dataDir).toBe(path.join("/home/op/.refarm", "data", "refarm"));
		expect(locations.legacyDataDir).toBe(path.join("/home/op", ".local", "share", "refarm"));
	});

	it("honours a graph the caller resolved, because the sandbox declares its own", () => {
		// `scripts/refarm-sandbox.mjs` points XDG_DATA_HOME at a SIBLING of its REFARM_HOME. A
		// derivation that assumed `<sovereignHome>/data` would report the wrong graph for the one
		// node in this repository that deliberately diverges.
		const locations = sovereignLocations(
			"/sbx/refarm",
			"/sbx/silo",
			"/sbx",
			"/sbx/share/refarm",
		);
		expect(locations.dataDir).toBe("/sbx/share/refarm");
		expect(locations.legacyDataDir).toBe(path.join("/sbx", ".local", "share", "refarm"));
	});
});

describe("dedupeInventory", () => {
	it("counts a file once however many locations reached it", () => {
		// FOUND LIVE 2026-08-16, not by a unit test. Once `dataDir` became the node's DECLARED
		// graph, it sat INSIDE `stateHome` — which already reaches it through its subdirectory
		// walk — so `refarm backup plan` listed `~/.refarm/data/refarm/default.db` TWICE and
		// reported 21 carried files where there were 19. A bundle that carries the same database
		// twice is not merely noisy: it is a count nobody can reconcile against the disk.
		//
		// The overlap is structural, not accidental: the node's graph lives under the node. So the
		// rule is about identity rather than about which walk found it first.
		const entries = [
			entry({ file: "/n/.refarm/data/refarm/default.db", recoverability: "irrecoverable" }),
			entry({ file: "/n/.refarm/data/refarm/default.db", recoverability: "irrecoverable" }),
			entry({ file: "/n/.local/share/refarm/default.db", recoverability: "irrecoverable" }),
		];

		expect(dedupeInventory(entries).map((e) => e.file)).toEqual([
			"/n/.refarm/data/refarm/default.db",
			"/n/.local/share/refarm/default.db",
		]);
	});

	it("keeps same-named databases in different directories apart", () => {
		// The whole point of the duplicate-namespace report: two `default.db` in two places are
		// two files. Deduping by basename would erase exactly the finding this module exists for.
		const entries = [
			entry({ file: "/a/default.db", recoverability: "irrecoverable" }),
			entry({ file: "/b/default.db", recoverability: "irrecoverable" }),
		];
		expect(dedupeInventory(entries)).toHaveLength(2);
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

/**
 * ISS-123's last undecided entry on the operator's real node.
 *
 * `backup plan` reported exactly one `undecidable` file — `.refarm/session.lock` — and
 * `hasUndecided` is driven by that list alone, so this single classification is what stands
 * between his node and a bundle it can trust.
 */
describe("SOVEREIGN_LAYOUT — runtime locks", () => {
	it("classifies a lock as rebuilt, never as data to carry", () => {
		// A lock names a LIVE process. Restored onto another machine it points at a pid that does
		// not exist there, and a stale lock is worse than an absent one: it can make the restored
		// node refuse to start, or believe a session is already held.
		const verdict = classifyByLayout(".refarm/session.lock", []);
		expect(verdict.nature).toBe("cache");
		expect(verdict.rebuiltBy).toBeDefined();
		expect(verdict.reason).toMatch(/lock|process/iu);
	});

	it("covers every lock the node writes, not one filename", () => {
		// A rule keyed on `session.lock` would leave the next lock undecidable, which is how this
		// entry came to exist in the first place.
		for (const relative of [".refarm/session.lock", ".refarm/runtime.lock", ".refarm/data/x.lock"]) {
			expect(classifyByLayout(relative, []).nature, relative).toBe("cache");
		}
	});

	it("does not let the lock rule swallow a secret that happens to end in .lock", () => {
		// Secrets are matched first, always. This asserts the ORDER holds rather than trusting it.
		expect(classifyByLayout(".silo/identity.json", []).nature).toBe("secret");
	});
});
