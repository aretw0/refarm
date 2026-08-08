import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	budgetObservationsPageFromBody,
	currentRateTableFrom,
	DEFAULT_PERIOD_SPEC,
	groupObservations,
	outcomeMark,
	parsePeriodSpec,
	printGroupedObservationsHuman,
	printObservationsHuman,
	printUsageByPeriodHuman,
	summariseObservations,
	USAGE_CANNOT_ANSWER,
	usageByPeriod,
} from "./budget.js";

describe("summariseObservations", () => {
	it("counts the runs the node cut, so a hit ceiling is visible", () => {
		const summary = summariseObservations([
			{ "refarm.outcome": "done", "refarm.budget.bound_by": "declared" },
			{ "refarm.outcome": "timed-out", "refarm.budget.bound_by": "node" },
			{ "refarm.outcome": "timed-out", "refarm.budget.bound_by": "node" },
		]);
		expect(summary).toEqual({
			total: 3,
			timedOut: 2,
			boundByNode: 2,
			boundByWorkspace: 0,
			// None of these three nodes carry `refarm.cost.rate_table_version`, and no
			// `currentRateTable` baseline was given — every one is unstamped, and none
			// can be judged stale against a baseline nobody supplied.
			stalePricing: 0,
			unstampedPricing: 3,
			priceUnknown: 0,
			// None of these three carry `host.id` either — pre-node-identity fixtures, so
			// all three are unidentified records, not nodes.
			nodesRepresented: [],
			unnamedNode: 0,
			unidentifiedRecords: 3,
		});
	});

	it("reports zeroes rather than throwing on an empty record", () => {
		expect(summariseObservations([])).toEqual({
			total: 0,
			timedOut: 0,
			boundByNode: 0,
			boundByWorkspace: 0,
			stalePricing: 0,
			unstampedPricing: 0,
			priceUnknown: 0,
			nodesRepresented: [],
			unnamedNode: 0,
			unidentifiedRecords: 0,
		});
	});

	it("counts observations priced by a rate table that is no longer current", () => {
		// Tokens do not drift; prices do. An observation stamped with a
		// superseded rate table still holds true token counts, so its cost is
		// recomputable — but only if the reader can find it.
		const summary = summariseObservations(
			[
				{ "refarm.cost.rate_table_version": "2026-08-03" },
				{ "refarm.cost.rate_table_version": "2026-01-01" },
				{},
			],
			"2026-08-03",
		);
		expect(summary.stalePricing).toBe(1);
		expect(summary.unstampedPricing).toBe(1);
	});

	it("counts a genuine 'no rate on file' apart from a cheap or unstamped run (F5)", () => {
		const summary = summariseObservations([
			// Priced normally.
			{ "refarm.cost.price_known": true },
			// F5's case: estimated_usd is 0.0, but the price was never known.
			{ "refarm.cost.price_known": false },
			// A record written before F5 shipped carries neither key — not
			// counted either way, per D6 (absent is not the same as false).
			{},
		]);
		expect(summary.priceUnknown).toBe(1);
	});

	// ── The collision contract — this is the point of the reducer ──────────────────

	it("gives two nodes the same declared name and distinct ids two separate entries", () => {
		// This is the whole reason nodesRepresented keys on host.id: no coordinator can
		// forbid two offline nodes from choosing the same name, so the reader must not be
		// the thing that silently merges them into one machine's worth of work.
		const summary = summariseObservations([
			{ "host.id": "node-a", "host.name": "sede" },
			{ "host.id": "node-b", "host.name": "sede" },
		]);
		expect(summary.nodesRepresented).toHaveLength(2);
		expect(summary.nodesRepresented.map((n) => n.id).sort()).toEqual(["node-a", "node-b"]);
		expect(summary.nodesRepresented.every((n) => n.name === "sede")).toBe(true);
		expect(summary.nodesRepresented.every((n) => n.observations === 1)).toBe(true);
	});

	it("collapses many observations from one node, by id, into a single entry", () => {
		const summary = summariseObservations([
			{ "host.id": "node-a", "host.name": "sede" },
			{ "host.id": "node-a", "host.name": "sede" },
			{ "host.id": "node-a", "host.name": "sede" },
		]);
		expect(summary.nodesRepresented).toEqual([{ id: "node-a", name: "sede", observations: 3 }]);
	});

	it("counts an observation with an id and no name as a real node, labelled unnamed", () => {
		const summary = summariseObservations([{ "host.id": "node-a" }]);
		expect(summary.nodesRepresented).toEqual([{ id: "node-a", name: null, observations: 1 }]);
		expect(summary.unnamedNode).toBe(1);
		expect(summary.unidentifiedRecords).toBe(0);
	});

	it("gives two DIFFERENT unnamed nodes two entries, not one shared nameless bucket", () => {
		const summary = summariseObservations([{ "host.id": "node-a" }, { "host.id": "node-b" }]);
		expect(summary.nodesRepresented).toHaveLength(2);
		expect(summary.nodesRepresented.every((n) => n.name === null)).toBe(true);
		expect(summary.unnamedNode).toBe(2);
	});

	it("treats an empty declared name on an identified node the same as no name (D6)", () => {
		const summary = summariseObservations([{ "host.id": "node-a", "host.name": "" }]);
		expect(summary.nodesRepresented).toEqual([{ id: "node-a", name: null, observations: 1 }]);
		expect(summary.unnamedNode).toBe(1);
	});

	it("does not trust a non-string host.id or host.name as real values", () => {
		const summary = summariseObservations([{ "host.id": 42, "host.name": 7 }]);
		expect(summary.nodesRepresented).toEqual([]);
		expect(summary.unidentifiedRecords).toBe(1);
		expect(summary.unnamedNode).toBe(0);
	});

	it("keeps a record with no host.id at all out of nodesRepresented, but still countable", () => {
		// Every record written before node identity shipped is this case. It must not be
		// merged with any identified node — there is nothing stable to key it on — and it
		// must not vanish either (D6: absent is not zero).
		const summary = summariseObservations([
			{ "host.id": "node-a", "host.name": "sede" },
			{}, // no host.id, no host.name — pre-identity record
			{}, // a second one, from a possibly different machine — must not collapse into node-a
		]);
		expect(summary.nodesRepresented).toEqual([{ id: "node-a", name: "sede", observations: 1 }]);
		expect(summary.unidentifiedRecords).toBe(2);
	});

	it("keeps the newest non-null name when the same node renamed itself mid-batch", () => {
		// host.name is read live and is documented as mutable — a rename must not corrupt
		// the count, and the entry stays exactly one node throughout.
		const summary = summariseObservations([
			{ "host.id": "node-a", "host.name": "old-name" },
			{ "host.id": "node-a", "host.name": "new-name" },
		]);
		expect(summary.nodesRepresented).toEqual([{ id: "node-a", name: "new-name", observations: 2 }]);
	});

	it("sorts nodesRepresented by name, then by id, for a predictable listing", () => {
		const summary = summariseObservations([
			{ "host.id": "node-z", "host.name": "beta" },
			{ "host.id": "node-a", "host.name": "alpha" },
			{ "host.id": "node-b" }, // unnamed sorts before any declared name
		]);
		expect(summary.nodesRepresented.map((n) => n.id)).toEqual(["node-b", "node-a", "node-z"]);
	});
});

describe("currentRateTableFrom", () => {
	it("derives the current version from the newest observation's own stamp", () => {
		const current = currentRateTableFrom([
			{ "refarm.cost.rate_table_version": "2026-01-01", timestamp_ns: 100 },
			{ "refarm.cost.rate_table_version": "2026-08-03.1", timestamp_ns: 300 },
			{ "refarm.cost.rate_table_version": "2026-06-01", timestamp_ns: 200 },
		]);
		expect(current).toBe("2026-08-03.1");
	});

	it("returns undefined when nothing carries both a stamp and a timestamp", () => {
		expect(currentRateTableFrom([])).toBeUndefined();
		expect(currentRateTableFrom([{ "refarm.cost.rate_table_version": "2026-08-03.1" }])).toBeUndefined();
		expect(currentRateTableFrom([{ timestamp_ns: 100 }])).toBeUndefined();
	});
});

describe("groupObservations", () => {
	// ── The unattributed bucket is a row, never a dilution ────────────────────

	it("keeps unattributed records in their own bucket, never folded into a workspace total", () => {
		const grouped = groupObservations(
			[
				{ "refarm.workspace.id": "refarm" },
				{ "refarm.workspace.id": "refarm" },
				{ "refarm.workspace.id": "rcdc5" },
				{}, // no refarm.workspace.id
				{}, // no refarm.workspace.id
			],
			{ by: "workspace" },
		);
		expect(grouped.total).toBe(5);
		expect(grouped.groups).toHaveLength(2);
		const byKey = Object.fromEntries(grouped.groups.map((g) => [g.key, g.observations]));
		expect(byKey).toEqual({ refarm: 2, rcdc5: 1 });
		expect(grouped.unattributed.observations).toBe(2);
		// The bug this test exists to catch: summing the two GROUPS alone must never be
		// read as "the total" record count — 3 attributed + 2 unattributed is 5, not 3.
		const groupTotal = grouped.groups.reduce((sum, g) => sum + g.observations, 0);
		expect(groupTotal).toBe(3);
		expect(groupTotal).not.toBe(grouped.total);
	});

	it("reports a zero unattributed bucket (still present, not omitted) when every record is attributed", () => {
		const grouped = groupObservations([{ "refarm.workspace.id": "refarm" }], { by: "workspace" });
		expect(grouped.unattributed.observations).toBe(0);
	});

	// ── The dollar axis: POSITIVE inclusion only ──────────────────────────────
	// (Task 1 review, Criticals 1 & 2: "everything not explicitly excluded is
	// billable" inverted the discipline the rest of the file follows. The fix
	// is structural — a member contributes to `usd` only when it POSITIVELY
	// establishes `pricing_mode === "api" && price_known === true`. Every one
	// of these tests would have failed against the prior exclusion-based
	// branch, which fell through to "billable, usd: 0" for `"local"` and for
	// an entirely absent `pricing_mode`.)

	it("reports usd: null, not 0, when every member of a group is subscription-priced", () => {
		const grouped = groupObservations(
			[
				{
					"refarm.workspace.id": "refarm",
					"refarm.pricing_mode": "subscription",
					"refarm.cost.estimated_usd": 0,
				},
				{
					"refarm.workspace.id": "refarm",
					"refarm.pricing_mode": "subscription",
					"refarm.cost.estimated_usd": 0,
				},
			],
			{ by: "workspace" },
		);
		const group = grouped.groups[0]!;
		expect(group.usd).toBeNull();
		expect(group.structuralZeroMembers).toBe(2);
	});

	it("reports usd: null, not 0, when every member is local-priced (Ollama) — Critical 1", () => {
		// packages/agent/src/utils.rs's price_is_known/estimate_billable_usd treat
		// "subscription" and "local" IDENTICALLY: both short-circuit to a real $0.00
		// before any rate lookup runs. A workspace that ran entirely on Ollama must
		// report the SAME null, not a confident $0.0000 that only "subscription" used
		// to earn.
		const grouped = groupObservations(
			[
				{ "refarm.workspace.id": "homelab", "refarm.pricing_mode": "local", "refarm.cost.estimated_usd": 0 },
				{ "refarm.workspace.id": "homelab", "refarm.pricing_mode": "local", "refarm.cost.estimated_usd": 0 },
			],
			{ by: "workspace" },
		);
		const group = grouped.groups[0]!;
		expect(group.usd).toBeNull();
		expect(group.structuralZeroMembers).toBe(2);
		expect(group.priceUnknown).toBe(0);
		expect(group.noUsageRecord).toBe(0);
	});

	it("reports usd: null, not 0, when refarm.pricing_mode is entirely absent — Critical 2", () => {
		// find_usage_record_for (packages/tractor/src/sidecar/dispatch.rs) returns None
		// for a terminal effort with no UsageRecord at all (e.g. failed before any model
		// call) — put_usage then never sets pricing_mode/price_known/estimated_usd.
		// This member must land in its own noUsageRecord bucket, not fall through to
		// "billable, usd: 0".
		const grouped = groupObservations(
			[
				{ "refarm.workspace.id": "refarm", "refarm.outcome": "failed" }, // no pricing_mode at all
			],
			{ by: "workspace" },
		);
		const group = grouped.groups[0]!;
		expect(group.usd).toBeNull();
		expect(group.noUsageRecord).toBe(1);
		expect(group.structuralZeroMembers).toBe(0);
		expect(group.priceUnknown).toBe(0);
	});

	it("reports usd: null, not 0, for a pricing_mode string this reducer has never seen", () => {
		// "a fourth pricing mode added in Rust tomorrow lands on the safe side by
		// construction" — the positive-inclusion check requires === "api" exactly, so
		// an unrecognised string cannot manufacture a zero either.
		const grouped = groupObservations(
			[{ "refarm.workspace.id": "refarm", "refarm.pricing_mode": "quantum-credits" }],
			{ by: "workspace" },
		);
		const group = grouped.groups[0]!;
		expect(group.usd).toBeNull();
		expect(group.priceUnknown).toBe(1);
		expect(group.structuralZeroMembers).toBe(0);
		expect(group.noUsageRecord).toBe(0);
	});

	it("sums only the positively-priced api members of a mixed group and reports how many were excluded", () => {
		const grouped = groupObservations(
			[
				{
					"refarm.workspace.id": "rcdc5",
					"refarm.pricing_mode": "subscription",
					"refarm.cost.estimated_usd": 0,
				},
				{
					"refarm.workspace.id": "rcdc5",
					"refarm.pricing_mode": "subscription",
					"refarm.cost.estimated_usd": 0,
				},
				{
					"refarm.workspace.id": "rcdc5",
					"refarm.pricing_mode": "api",
					"refarm.cost.estimated_usd": 1.25,
					"refarm.cost.price_known": true,
				},
			],
			{ by: "workspace" },
		);
		const group = grouped.groups[0]!;
		expect(group.usd).toBe(1.25);
		expect(group.structuralZeroMembers).toBe(2);
	});

	it("excludes an api member with price_known !== true from usd — false and absent BOTH count as unknown, not billable", () => {
		// price_known: false is F5's "no rate on file". An api-mode member with no
		// price_known field at all (a record predating that field) is the SAME fact
		// from this reader's position: neither positively establishes a price, so
		// neither may contribute a zero to `usd`.
		const grouped = groupObservations(
			[
				{
					"refarm.workspace.id": "rcdc5",
					"refarm.pricing_mode": "api",
					"refarm.cost.estimated_usd": 2,
					"refarm.cost.price_known": true,
				},
				{ "refarm.workspace.id": "rcdc5", "refarm.pricing_mode": "api", "refarm.cost.price_known": false },
				{ "refarm.workspace.id": "rcdc5", "refarm.pricing_mode": "api", "refarm.cost.estimated_usd": 9 },
			],
			{ by: "workspace" },
		);
		const group = grouped.groups[0]!;
		expect(group.usd).toBe(2);
		expect(group.priceUnknown).toBe(2);
		expect(group.structuralZeroMembers).toBe(0);
		expect(group.noUsageRecord).toBe(0);
	});

	// ── Token totals — the primary quantity ───────────────────────────────────

	it("sums token totals — input, output, cache_creation, cache_read, reasoning — across a group", () => {
		const grouped = groupObservations(
			[
				{
					"refarm.workspace.id": "refarm",
					"gen_ai.usage.input_tokens": 10,
					"gen_ai.usage.output_tokens": 20,
					"gen_ai.usage.cache_creation.input_tokens": 3,
					"gen_ai.usage.cache_read.input_tokens": 4,
					"gen_ai.usage.reasoning.output_tokens": 5,
				},
				{
					"refarm.workspace.id": "refarm",
					"gen_ai.usage.input_tokens": 1,
					"gen_ai.usage.output_tokens": 2,
				},
			],
			{ by: "workspace" },
		);
		expect(grouped.groups[0]!.tokens).toEqual({
			input: 11,
			output: 22,
			cacheCreation: 3,
			cacheRead: 4,
			reasoning: 5,
		});
	});

	// ── by: host / spawner ─────────────────────────────────────────────────────

	it("groups by host.id, not host.name, so two nodes sharing a declared name stay two rows", () => {
		const grouped = groupObservations(
			[
				{ "host.id": "node-a", "host.name": "sede" },
				{ "host.id": "node-b", "host.name": "sede" },
			],
			{ by: "host" },
		);
		expect(grouped.groups).toHaveLength(2);
		expect(grouped.groups.map((g) => g.key).sort()).toEqual(["node-a", "node-b"]);
		expect(grouped.groups.every((g) => g.label === "sede")).toBe(true);
	});

	it("groups by refarm.budget.spawner", () => {
		const grouped = groupObservations(
			[
				{ "refarm.budget.spawner": "refarm-ask" },
				{ "refarm.budget.spawner": "refarm-ask" },
				{ "refarm.budget.spawner": "capability-dispatch" },
			],
			{ by: "spawner" },
		);
		expect(grouped.groups.map((g) => ({ key: g.key, observations: g.observations }))).toEqual([
			{ key: "refarm-ask", observations: 2 },
			{ key: "capability-dispatch", observations: 1 },
		]);
	});

	it("sorts groups by observation count descending, ties broken by key ascending", () => {
		const grouped = groupObservations(
			[{ "refarm.workspace.id": "b" }, { "refarm.workspace.id": "a" }],
			{ by: "workspace" },
		);
		expect(grouped.groups.map((g) => g.key)).toEqual(["a", "b"]);
	});

	it("reports zero groups and a null-usd, zero unattributed bucket on an empty record, never throwing", () => {
		const grouped = groupObservations([], { by: "workspace" });
		expect(grouped.total).toBe(0);
		expect(grouped.groups).toEqual([]);
		expect(grouped.unattributed).toEqual({
			observations: 0,
			tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0 },
			usd: null,
			structuralZeroMembers: 0,
			priceUnknown: 0,
			noUsageRecord: 0,
		});
	});
});

describe("printGroupedObservationsHuman — the subscription axis renders as —, never $0.00", () => {
	let stdout: string[];

	beforeEach(() => {
		stdout = [];
		vi.spyOn(console, "log").mockImplementation((...args) => void stdout.push(args.join(" ")));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("prints — for a group whose members are all subscription-priced, never $0.00", () => {
		const grouped = groupObservations(
			[{ "refarm.workspace.id": "refarm", "refarm.pricing_mode": "subscription" }],
			{ by: "workspace" },
		);
		printGroupedObservationsHuman(grouped, { stored: 1, truncated: false });
		const text = stdout.join("\n");
		expect(text).toContain("—");
		expect(text).not.toContain("$0.00");
	});

	it("always prints the (unattributed) row, even when its count is zero", () => {
		const grouped = groupObservations([{ "refarm.workspace.id": "refarm" }], { by: "workspace" });
		printGroupedObservationsHuman(grouped, { stored: 1, truncated: false });
		const text = stdout.join("\n");
		expect(text).toContain("(unattributed)");
	});

	// ── Critical 3: the human surface must carry the same completeness signal ──
	// as printObservationsHuman — it used to be JSON-only for the grouped commands.

	it("prints the truncation notice (naming both counts) when the page reports truncated: true", () => {
		const grouped = groupObservations([{ "refarm.workspace.id": "refarm" }], { by: "workspace" });
		printGroupedObservationsHuman(grouped, { stored: 42, truncated: true });
		const text = stdout.join("\n");
		expect(text).toContain("42");
		expect(text.toLowerCase()).toContain("stored");
	});

	it("prints an unknown-completeness notice when the page omits stored/truncated", () => {
		const grouped = groupObservations([{ "refarm.workspace.id": "refarm" }], { by: "workspace" });
		printGroupedObservationsHuman(grouped, { stored: undefined, truncated: undefined });
		const text = stdout.join("\n");
		expect(text.toLowerCase()).toContain("unknown");
	});

	it("prints nothing about storage when the page reports truncated: false", () => {
		const grouped = groupObservations([{ "refarm.workspace.id": "refarm" }], { by: "workspace" });
		printGroupedObservationsHuman(grouped, { stored: 1, truncated: false });
		const text = stdout.join("\n");
		expect(text.toLowerCase()).not.toContain("stored");
	});

	// ── Minor: a real group key literally named "(unattributed)" must not collide ──
	// visually with the sentinel bucket row.

	it("disambiguates a real workspace literally named '(unattributed)' from the sentinel bucket", () => {
		const grouped = groupObservations(
			[
				{ "refarm.workspace.id": "(unattributed)" },
				{}, // a genuinely unattributed record too, so both rows are present
			],
			{ by: "workspace" },
		);
		printGroupedObservationsHuman(grouped, { stored: 2, truncated: false });
		const lines = stdout.join("\n").split("\n").filter((l) => l.includes("(unattributed)"));
		// Two DISTINCT lines must mention "(unattributed)" — the real workspace's row and
		// the sentinel bucket's row — never one line standing in for both.
		expect(lines.length).toBeGreaterThanOrEqual(2);
		expect(new Set(lines).size).toBe(lines.length);
	});
});

describe("printObservationsHuman — truncation notice", () => {
	// `summary.total` already means "how many observations this call returned" (the array
	// length `summariseObservations` counted) — that meaning is pinned by the header line
	// below (`(${summary.total} shown)`). The server's new fact, "how many
	// BudgetObservation nodes actually exist", is a DIFFERENT number and must never be
	// read through that same field name, so the page-level info travels in its own
	// `{ stored, truncated }` argument instead of being folded into `ObservationSummary`.
	let stdout: string[];

	beforeEach(() => {
		stdout = [];
		vi.spyOn(console, "log").mockImplementation((...args) => void stdout.push(args.join(" ")));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("prints a notice naming both counts when the payload says truncated: true", () => {
		const observations = [{ "refarm.outcome": "done" }];
		const summary = summariseObservations(observations);

		printObservationsHuman(observations, summary, { stored: 42, truncated: true });

		const text = stdout.join("\n");
		expect(text).toContain("42");
		expect(text.toLowerCase()).toContain("stored");
	});

	it("never prints 'of undefined' when truncated: true arrives without stored", () => {
		// Task 2's own contract (`BudgetObservationsPage`'s doc) allows `stored` and
		// `truncated` to be absent INDEPENDENTLY — a body can report truncation without
		// also reporting the true count. `page.stored` must not be interpolated blind.
		const observations = [{ "refarm.outcome": "done" }];
		const summary = summariseObservations(observations);

		printObservationsHuman(observations, summary, { stored: undefined, truncated: true });

		const text = stdout.join("\n");
		expect(text.toLowerCase()).not.toContain("undefined");
	});

	it("prints nothing about storage when the payload says truncated: false", () => {
		const observations = [{ "refarm.outcome": "done" }];
		const summary = summariseObservations(observations);

		printObservationsHuman(observations, summary, { stored: 1, truncated: false });

		const text = stdout.join("\n");
		expect(text.toLowerCase()).not.toContain("stored");
	});

	// The live path today: the operator's own node is running a sidecar built before
	// `stored`/`truncated` shipped, so `GET /nodes` omits both keys right now. A fallback
	// that rounds that gap to "complete" (`truncated: false`) would print a confident
	// answer nobody gave — this must render as its own third state instead.
	it("prints an unknown-completeness notice when the payload omits stored/truncated — NEVER the truncation warning or silence", () => {
		const observations = [{ "refarm.outcome": "done" }];
		const summary = summariseObservations(observations);

		printObservationsHuman(observations, summary, { stored: undefined, truncated: undefined });

		const text = stdout.join("\n");
		expect(text.toLowerCase()).toContain("unknown");
		// Must not read as either "the record is definitely complete" (silence) or "the
		// record is definitely truncated" (the --limit warning) — an unstated fact must not
		// be dressed up as either resolved state.
		expect(text.toLowerCase()).not.toContain("raise --limit");
	});
});

describe("budgetObservationsPageFromBody — absent means absent", () => {
	it("carries stored/truncated through when the sidecar reports them", () => {
		const page = budgetObservationsPageFromBody({ nodes: [{ a: 1 }], stored: 42, truncated: true });
		expect(page).toEqual({ observations: [{ a: 1 }], stored: 42, truncated: true });
	});

	it("leaves stored/truncated undefined — NOT defaulted — when the sidecar omits them", () => {
		// This is the exact shape an older sidecar build returns today: `{ nodes, total }`,
		// no `stored`, no `truncated`. `observations.length`/`false` would be a guess
		// dressed up as a fact.
		const page = budgetObservationsPageFromBody({ nodes: [{ a: 1 }, { b: 2 }], total: 2 } as never);
		expect(page.observations).toEqual([{ a: 1 }, { b: 2 }]);
		expect(page.stored).toBeUndefined();
		expect(page.truncated).toBeUndefined();
	});

	it("leaves stored/truncated undefined when the fields are present but the wrong type", () => {
		const page = budgetObservationsPageFromBody({
			nodes: [],
			stored: "42" as unknown as number,
			truncated: "true" as unknown as boolean,
		});
		expect(page.stored).toBeUndefined();
		expect(page.truncated).toBeUndefined();
	});
});

describe("parsePeriodSpec — the design decision: rolling window is the default, calendar month is reachable", () => {
	// "Now" pinned to a literal instant — 2026-08-08T12:00:00Z, computed once by hand
	// (Date.UTC(2026,7,8,12)) — never Date.now(). Every expectation below is computed from
	// THIS fixed number, not from whenever the test happens to run, so it cannot rot.
	const NOW_MS = 1786190400000; // 2026-08-08T12:00:00Z

	it("DEFAULT_PERIOD_SPEC is a 30-day rolling window, not a calendar month", () => {
		// The design decision itself, pinned: the default answer to "what have I used
		// this period" is a rolling window — see the file's own doc for why (the
		// operator's real billing anchor date is not on the record, and a calendar
		// month silently assumes that anchor is the 1st, which is true for almost
		// nobody).
		expect(DEFAULT_PERIOD_SPEC).toBe("30d");
	});

	it("resolves a rolling '30d' window ending exactly at the given instant", () => {
		const period = parsePeriodSpec("30d", NOW_MS);
		expect(period.kind).toBe("rolling-days");
		expect(period.endMs).toBe(NOW_MS);
		expect(period.startMs).toBe(NOW_MS - 30 * 86_400_000);
		expect(period.spec).toBe("30d");
	});

	it("resolves a rolling '1d' window — the narrow window the empty-result live case uses", () => {
		const period = parsePeriodSpec("1d", NOW_MS);
		expect(period.kind).toBe("rolling-days");
		expect(period.endMs).toBe(NOW_MS);
		expect(period.startMs).toBe(NOW_MS - 1 * 86_400_000);
	});

	it("resolves 'month' to the current UTC calendar month, half-open [1st, next 1st)", () => {
		const period = parsePeriodSpec("month", NOW_MS); // NOW_MS falls in August 2026
		expect(period.kind).toBe("calendar-month");
		expect(period.startMs).toBe(1785542400000); // 2026-08-01T00:00:00Z
		expect(period.endMs).toBe(1788220800000); // 2026-09-01T00:00:00Z
	});

	it("resolves an explicit 'YYYY-MM' to that calendar month regardless of 'now' — the reachable alternate", () => {
		const period = parsePeriodSpec("2026-01", NOW_MS); // now is August; asking about January
		expect(period.kind).toBe("calendar-month");
		expect(period.startMs).toBe(1767225600000); // 2026-01-01T00:00:00Z
		expect(period.endMs).toBe(1769904000000); // 2026-02-01T00:00:00Z
	});

	it("rejects a spec that is none of '<N>d', 'month', or 'YYYY-MM'", () => {
		expect(() => parsePeriodSpec("thisweek", NOW_MS)).toThrow();
		expect(() => parsePeriodSpec("30", NOW_MS)).toThrow();
		expect(() => parsePeriodSpec("0d", NOW_MS)).toThrow();
		expect(() => parsePeriodSpec("-5d", NOW_MS)).toThrow();
		expect(() => parsePeriodSpec("2026-13", NOW_MS)).toThrow();
	});
});

describe("usageByPeriod — three states, never two: in period / out of period / no usable timestamp", () => {
	// A literal half-open window: 2026-08-04T00:00:00Z through 2026-08-06T00:00:00Z
	// (exclusive). Computed once by hand (Date.UTC), never from Date.now().
	const WINDOW = {
		kind: "rolling-days" as const,
		startMs: 1785801600000, // 2026-08-04T00:00:00Z
		endMs: 1785974400000, // 2026-08-06T00:00:00Z (exclusive)
		spec: "test-window",
		label: "test window",
	};

	it("buckets a record inside the window into inPeriod", () => {
		const usage = usageByPeriod([{ timestamp_ns: 1785888000000000000 }], { period: WINDOW }); // 08-05T00:00Z
		expect(usage.inPeriod.observations).toBe(1);
		expect(usage.outOfPeriod.observations).toBe(0);
		expect(usage.unknownTimestamp.observations).toBe(0);
	});

	it("includes the exact start instant (inclusive start) but excludes the exact end instant (exclusive end)", () => {
		const usage = usageByPeriod(
			[
				{ timestamp_ns: 1785801600000000000 }, // exactly startMs — IN
				{ timestamp_ns: 1785974400000000000 }, // exactly endMs — OUT (next window's first instant)
			],
			{ period: WINDOW },
		);
		expect(usage.inPeriod.observations).toBe(1);
		expect(usage.outOfPeriod.observations).toBe(1);
	});

	it("buckets a record before the window into outOfPeriod, not dropped", () => {
		const usage = usageByPeriod([{ timestamp_ns: 1785758400000000000 }], { period: WINDOW }); // 08-03T12:00Z
		expect(usage.outOfPeriod.observations).toBe(1);
		expect(usage.inPeriod.observations).toBe(0);
	});

	it("buckets a record after the window into outOfPeriod, not dropped", () => {
		const usage = usageByPeriod([{ timestamp_ns: 1786060800000000000 }], { period: WINDOW }); // 08-07T00:00Z
		expect(usage.outOfPeriod.observations).toBe(1);
	});

	// ── The three-states discipline this task exists to enforce ───────────────────

	it("puts a record with no timestamp_ns at all into unknownTimestamp — not dropped, not counted as this period", () => {
		const usage = usageByPeriod([{}], { period: WINDOW });
		expect(usage.unknownTimestamp.observations).toBe(1);
		expect(usage.inPeriod.observations).toBe(0);
		expect(usage.outOfPeriod.observations).toBe(0);
		expect(usage.total).toBe(1);
	});

	it("puts a record with an unparseable timestamp_ns into unknownTimestamp, same as a missing one", () => {
		const usage = usageByPeriod([{ timestamp_ns: "not-a-number" }], { period: WINDOW });
		expect(usage.unknownTimestamp.observations).toBe(1);
		expect(usage.inPeriod.observations).toBe(0);
	});

	it("every bucket's observation count sums to total — no member is double-counted or silently lost", () => {
		const usage = usageByPeriod(
			[
				{ timestamp_ns: 1785888000000000000 }, // inside
				{ timestamp_ns: 1785758400000000000 }, // before
				{}, // no timestamp
			],
			{ period: WINDOW },
		);
		expect(usage.total).toBe(3);
		const bucketSum =
			usage.inPeriod.observations + usage.outOfPeriod.observations + usage.unknownTimestamp.observations;
		expect(bucketSum).toBe(usage.total);
	});

	it("sums tokens per bucket independently — an out-of-period record's tokens never bleed into inPeriod", () => {
		const usage = usageByPeriod(
			[
				{
					timestamp_ns: 1785888000000000000, // inside
					"gen_ai.usage.input_tokens": 10,
					"gen_ai.usage.output_tokens": 20,
				},
				{
					timestamp_ns: 1785758400000000000, // before — out of period
					"gen_ai.usage.input_tokens": 100,
					"gen_ai.usage.output_tokens": 200,
				},
			],
			{ period: WINDOW },
		);
		expect(usage.inPeriod.tokens.input).toBe(10);
		expect(usage.inPeriod.tokens.output).toBe(20);
		expect(usage.outOfPeriod.tokens.input).toBe(100);
		expect(usage.outOfPeriod.tokens.output).toBe(200);
	});

	it("reports zero everywhere on an empty record, without throwing", () => {
		const usage = usageByPeriod([], { period: WINDOW });
		expect(usage.total).toBe(0);
		expect(usage.inPeriod.observations).toBe(0);
		expect(usage.outOfPeriod.observations).toBe(0);
		expect(usage.unknownTimestamp.observations).toBe(0);
		expect(usage.inPeriod.noUsageRecord).toBe(0);
		expect(usage.outOfPeriod.noUsageRecord).toBe(0);
		expect(usage.unknownTimestamp.noUsageRecord).toBe(0);
	});

	// ── noUsageRecord: same field name, same meaning as GroupTotals.noUsageRecord ──
	// (code review, follow-up to Task 1's fix, fc53a9c3) — a terminal effort with no
	// UsageRecord at all (find_usage_record_for returns None) has NO refarm.pricing_mode
	// field whatsoever, and put_usage returns before writing ANY gen_ai.usage.* field
	// either. Without this count, a bucket of five such records reports output: 0 —
	// indistinguishable from five records that ran and genuinely produced nothing.

	it("counts a member with no refarm.pricing_mode as noUsageRecord — the 'nothing was recorded' case", () => {
		const usage = usageByPeriod(
			[{ timestamp_ns: 1785888000000000000 }], // inside WINDOW, no refarm.pricing_mode at all
			{ period: WINDOW },
		);
		expect(usage.inPeriod.noUsageRecord).toBe(1);
	});

	it("does NOT count a member that carries refarm.pricing_mode as noUsageRecord, even subscription — its tokens are real", () => {
		const usage = usageByPeriod(
			[
				{
					timestamp_ns: 1785888000000000000,
					"refarm.pricing_mode": "subscription",
					"gen_ai.usage.output_tokens": 5,
				},
			],
			{ period: WINDOW },
		);
		expect(usage.inPeriod.noUsageRecord).toBe(0);
		expect(usage.inPeriod.tokens.output).toBe(5);
	});

	it("tracks noUsageRecord independently per bucket — an in-period gap does not inflate out-of-period's count", () => {
		const usage = usageByPeriod(
			[
				{ timestamp_ns: 1785888000000000000 }, // inside, no pricing_mode
				{ timestamp_ns: 1785758400000000000 }, // before (out of period), no pricing_mode
			],
			{ period: WINDOW },
		);
		expect(usage.inPeriod.noUsageRecord).toBe(1);
		expect(usage.outOfPeriod.noUsageRecord).toBe(1);
	});

	it("the exact defect this fix closes: a bucket of failed-before-model-call efforts reports output:0 AND names how many of that 0 is unmeasured", () => {
		// Five efforts that failed before ever calling a model — no UsageRecord, so no
		// refarm.pricing_mode and no gen_ai.usage.* fields at all on any of them.
		const failedBeforeModelCall = Array.from({ length: 5 }, () => ({
			timestamp_ns: 1785888000000000000,
		}));
		const usage = usageByPeriod(failedBeforeModelCall, { period: WINDOW });
		expect(usage.inPeriod.tokens.output).toBe(0);
		// Before this fix, this was the ONLY fact available — indistinguishable from five
		// real, successful, zero-output runs. Now the reader can tell:
		expect(usage.inPeriod.noUsageRecord).toBe(5);
		expect(usage.inPeriod.observations).toBe(5);
	});

	// ── The exact scenario Step 4's live verification proves against the real graph ──

	it("mirrors the live record: a 30-day rolling window (as of 2026-08-08) holds all of a 08/03-08/05 batch; a 1-day window holds none of it", () => {
		const NOW_MS = 1786190400000; // 2026-08-08T12:00:00Z, pinned literal — not Date.now()
		const liveLikeNodes = [
			{ timestamp_ns: 1785792060000000000 }, // 2026-08-03T21:21:00Z
			{ timestamp_ns: 1785837600000000000 }, // 2026-08-04T10:00:00Z
			{ timestamp_ns: 1785950940000000000 }, // 2026-08-05T17:29:00Z
		];

		const period30 = parsePeriodSpec("30d", NOW_MS);
		const usage30 = usageByPeriod(liveLikeNodes, { period: period30 });
		expect(usage30.inPeriod.observations).toBe(liveLikeNodes.length);
		expect(usage30.outOfPeriod.observations).toBe(0);

		const period1 = parsePeriodSpec("1d", NOW_MS);
		const usage1 = usageByPeriod(liveLikeNodes, { period: period1 });
		expect(usage1.inPeriod.observations).toBe(0);
		expect(usage1.outOfPeriod.observations).toBe(liveLikeNodes.length);
	});
});

describe("printUsageByPeriodHuman — states what it cannot answer, unconditionally", () => {
	let stdout: string[];

	beforeEach(() => {
		stdout = [];
		vi.spyOn(console, "log").mockImplementation((...args) => void stdout.push(args.join(" ")));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("always prints the cannot-answer note, even on an empty record", () => {
		const usage = usageByPeriod([], {
			period: { kind: "rolling-days", startMs: 0, endMs: 1, spec: "30d", label: "last 30 days" },
		});
		printUsageByPeriodHuman(usage, { stored: 0, truncated: false });
		const text = stdout.join("\n");
		expect(text).toContain(USAGE_CANNOT_ANSWER);
	});

	it("prints all three bucket labels on a non-empty record", () => {
		const usage = usageByPeriod([{ timestamp_ns: 500 }, {}], {
			period: { kind: "rolling-days", startMs: 0, endMs: 1000, spec: "30d", label: "last 30 days" },
		});
		printUsageByPeriodHuman(usage, { stored: 2, truncated: false });
		const text = stdout.join("\n").toLowerCase();
		expect(text).toContain("in period");
		expect(text).toContain("out of period");
		expect(text).toContain("no timestamp");
	});

	it("still prints the cannot-answer note when the record is non-empty — not only on the empty path", () => {
		const usage = usageByPeriod([{ timestamp_ns: 500 }], {
			period: { kind: "rolling-days", startMs: 0, endMs: 1000, spec: "30d", label: "last 30 days" },
		});
		printUsageByPeriodHuman(usage, { stored: 1, truncated: false });
		expect(stdout.join("\n")).toContain(USAGE_CANNOT_ANSWER);
	});

	// ── Same gap Task 1's Critical 3 closed for the grouped commands: the human
	// surface must carry the SAME completeness signal --json always carried. This
	// command never wired printPageCompletenessNotice in at all until now.

	it("prints the truncation notice (naming both counts) when the page reports truncated: true", () => {
		const usage = usageByPeriod([{ timestamp_ns: 500 }], {
			period: { kind: "rolling-days", startMs: 0, endMs: 1000, spec: "30d", label: "last 30 days" },
		});
		printUsageByPeriodHuman(usage, { stored: 42, truncated: true });
		const text = stdout.join("\n");
		expect(text).toContain("42");
		expect(text.toLowerCase()).toContain("stored");
	});

	it("prints an unknown-completeness notice when the page omits stored/truncated", () => {
		const usage = usageByPeriod([{ timestamp_ns: 500 }], {
			period: { kind: "rolling-days", startMs: 0, endMs: 1000, spec: "30d", label: "last 30 days" },
		});
		printUsageByPeriodHuman(usage, { stored: undefined, truncated: undefined });
		expect(stdout.join("\n").toLowerCase()).toContain("unknown");
	});

	it("prints nothing about storage when the page reports truncated: false", () => {
		const usage = usageByPeriod([{ timestamp_ns: 500 }], {
			period: { kind: "rolling-days", startMs: 0, endMs: 1000, spec: "30d", label: "last 30 days" },
		});
		printUsageByPeriodHuman(usage, { stored: 1, truncated: false });
		expect(stdout.join("\n").toLowerCase()).not.toContain("stored");
	});

	// ── noUsageRecord must reach the human surface too, not only the JSON/type layer ──

	it("flags a bucket's no-usage-record count so 0 tokens can be told apart from 'nothing recorded'", () => {
		const usage = usageByPeriod(
			[{ timestamp_ns: 500 }, { timestamp_ns: 500 }], // both inside, neither carries refarm.pricing_mode
			{ period: { kind: "rolling-days", startMs: 0, endMs: 1000, spec: "30d", label: "last 30 days" } },
		);
		printUsageByPeriodHuman(usage, { stored: 2, truncated: false });
		const text = stdout.join("\n");
		expect(text).toContain("no-usage-record:2");
	});
});

describe("outcomeMark", () => {
	it("renders a distinct mark for every outcome the record can carry, including delivered and partial (F2)", () => {
		const marks = new Set(
			["done", "delivered", "partial", "timed-out", "failed", "cancelled"].map(outcomeMark),
		);
		expect(marks.size).toBe(6);
		// An outcome the vocabulary does not (yet) name still renders, via the
		// fallback — it must never throw.
		expect(() => outcomeMark("some-future-outcome")).not.toThrow();
	});
});
