import {
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import { fetchSidecarJson, readCompleteness } from "@refarm.dev/sidecar-client";
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";
import { refarmCommand } from "../brand.js";
import { reportSidecarError } from "./sidecar-error.js";
import { sidecarUrl } from "./sidecar-url.js";

/**
 * `refarm budget observations` — read back the `BudgetObservation` record Task 10
 * writes for every terminal effort: which ceiling governed the run, which axis
 * bound it, and what the run actually spent. The operator is this record's FIRST
 * consumer, and this command is the check that the join (budget resolution ⋈
 * usage ⋈ outcome, all flattened onto one node under OTel names) actually
 * joins — against the real graph, not a fixture.
 *
 * READS ONLY. Nothing here writes a node, retries an effort, or declares a
 * budget — that surface is `refarm dispatch --budget-deadline-ms` /
 * `--budget-max-tokens` / `--budget-max-usd` (`dispatch-capability.ts`), a
 * separate command. This command's only job is making the record legible
 * once it exists.
 *
 * THE READ PATH — and a defect found while wiring it: the usual way a CLI
 * command reaches a generically-typed stored node is
 * `@refarm.dev/sidecar-client`'s `createSidecarGraphClient` (see
 * `utils/tractor-store.ts`, used by `commands/health.ts`). Its `getNode` and
 * `queryNodes` both require every returned node to carry `@context`
 * (`asSidecarGraphNode`'s `hasContext` check). The Rust sidecar's `GET /nodes`
 * and `GET /nodes/:id` handlers (`packages/tractor/src/sidecar/mod.rs`,
 * `node_value_from_row`) never set `@context` on ANY node type — confirmed live
 * against a running daemon for `Session` nodes, not only `BudgetObservation`.
 * Going through that client throws "sidecar graph response includes malformed
 * node" (or "…missing node") the moment a query returns a real row; it happens
 * to look fine only while the record is empty. This command instead calls the
 * lower-level primitive that client is built from — `fetchSidecarJson` against
 * `GET /nodes?type=…`, the same primitive `commands/dispatch-submit.ts` already
 * uses for its own sidecar reads (`commands/tasks.ts` reads via the sibling
 * `fetchSidecarWithTimeout` instead, not this one) — and takes
 * `body.nodes` untyped, which is exactly the shape `summariseObservations`
 * expects. The `@context` gap in the shared client is a real, separate defect;
 * it is reported here (see the Task 11 report), not fixed, because fixing it
 * touches `packages/sidecar-client`, outside this task's file list and outside
 * the `apps/refarm/src` scope this change stages.
 */

const BUDGET_OBSERVATION_NODE_TYPE = "BudgetObservation";
const BUDGET_OBSERVATIONS_JSON_COMMAND = refarmCommand(["budget", "observations", "--json"]);
const DEFAULT_LIMIT = 100;

/** Shared across the empty-record case for both `observations` and the grouped
 *  by-* subcommands, so the two surfaces say the identical true thing rather than
 *  two independently-maintained paraphrases of it. */
const NO_OBSERVATIONS_MESSAGE =
	"No BudgetObservation records yet. One is written for every terminal effort " +
	"(done, delivered, partial, failed, timed-out, or cancelled) — dispatch a workload " +
	'through the runtime (for example, refarm ask "…") and let it finish, then run this again.';

export type ObservationNode = Record<string, unknown>;

/**
 * One distinct machine, per the record — keyed on `host.id` (opaque, per-installation,
 * never shared between two real nodes), never on `host.name`. Name collision cannot be
 * PREVENTED in a coordinator-less mesh (two nodes started offline can always choose the
 * same name), so it is made HARMLESS here instead: two nodes named `sede` with different
 * ids are two `RepresentedNode` entries, not one that silently absorbed the second
 * machine's work into the first's count.
 */
export interface RepresentedNode {
	/** `host.id` — the identity this entry is keyed on. */
	id: string;
	/** `host.name`, the declared, human-chosen, MUTABLE label — `null` when this node has
	 *  an id but has not declared a name. That is still a real, distinct node (it has its
	 *  own entry, keyed on its own id) — not folded into a shared nameless bucket with
	 *  every other unnamed node, the way a `Set<string>` keyed on the label used to. */
	name: string | null;
	/** How many observations in this batch this node produced. */
	observations: number;
}

export type ObservationSummary = {
	total: number;
	timedOut: number;
	boundByNode: number;
	boundByWorkspace: number;
	/** Observations priced by a rate table that has since been superseded. */
	stalePricing: number;
	/** Observations written before the rate table was stamped at all. */
	unstampedPricing: number;
	/** Observations whose `estimated_usd` is a genuine "no rate on file" —
	 *  not zero because the run was cheap, but because nothing could price it
	 *  (F5). Distinct from `unstampedPricing`: a record can carry a rate table
	 *  stamp and still be `price_known: false` (the table was consulted and
	 *  came back empty for that model). */
	priceUnknown: number;
	/** Distinct IDENTIFIED nodes (`host.id` present) seen across these observations, one
	 *  entry per id — not per declared name, because two real machines can legitimately
	 *  share a name (see `RepresentedNode`'s doc). Sorted by (name, id) so identically
	 *  labelled nodes sort predictably next to each other rather than colliding in the
	 *  list. An observation with no `host.id` at all contributes to `unidentifiedRecords`
	 *  instead — see that field's doc for why it cannot be merged in here. An empty array
	 *  is informative on its own: not "no nodes exist", but "nothing observed since node
	 *  identity shipped, or every observation since predates it". */
	nodesRepresented: RepresentedNode[];
	/** Observations from an IDENTIFIED node (`host.id` present) that has not declared a
	 *  name — not a name that happens to be `""` (D6: absent is not zero, applied to WHO
	 *  ran this, not just what it spent). Counted per OBSERVATION, same as before this
	 *  field existed; `nodesRepresented` is where each such node gets its own entry
	 *  (`name: null`). Distinct from `unidentifiedRecords`: this node IS identified, it
	 *  simply has not been named. */
	unnamedNode: number;
	/** Observations with NO `host.id` at all — every record written before node identity
	 *  shipped. These are counted here rather than folded into `nodesRepresented`: there is
	 *  no stable identity to key them on, so merging them would either fabricate one shared
	 *  "phantom node" out of possibly many real machines, or silently drop them from the
	 *  count. "A node that has not been named" (`unnamedNode`) and "a record that predates
	 *  node identity" (this field) are different facts, and D6 says they must not collapse
	 *  into the same number. */
	unidentifiedRecords: number;
};

/** Pure reducer over the record. Kept separate from the command so the counting
 *  rule is testable without a running node. */
export function summariseObservations(
	nodes: readonly ObservationNode[],
	currentRateTable?: string,
): ObservationSummary {
	let timedOut = 0;
	let boundByNode = 0;
	let boundByWorkspace = 0;
	let stalePricing = 0;
	let unstampedPricing = 0;
	let priceUnknown = 0;
	let unnamedNode = 0;
	let unidentifiedRecords = 0;
	const nodesById = new Map<string, { name: string | null; observations: number }>();
	for (const node of nodes) {
		if (node["refarm.outcome"] === "timed-out") timedOut += 1;
		const boundBy = node["refarm.budget.bound_by"];
		if (boundBy === "node") boundByNode += 1;
		if (boundBy === "workspace") boundByWorkspace += 1;
		const stamped = node["refarm.cost.rate_table_version"];
		if (stamped === undefined) unstampedPricing += 1;
		else if (currentRateTable !== undefined && stamped !== currentRateTable) {
			stalePricing += 1;
		}
		if (node["refarm.cost.price_known"] === false) priceUnknown += 1;

		const rawId = node["host.id"];
		const id = typeof rawId === "string" && rawId.length > 0 ? rawId : undefined;
		const rawName = node["host.name"];
		const name = typeof rawName === "string" && rawName.length > 0 ? rawName : null;

		// No `host.id` at all: this record predates node identity. It cannot be keyed on
		// anything stable, so it must not be merged into `nodesRepresented` — see that
		// field's doc — but it must still be counted (D6).
		if (id === undefined) {
			unidentifiedRecords += 1;
			continue;
		}

		if (name === null) unnamedNode += 1;
		const existing = nodesById.get(id);
		if (existing) {
			existing.observations += 1;
			// The declared name is mutable and read live (node_identity.rs's
			// `declared_node_name`), so a node can rename itself between two
			// observations in the same batch — keep the newest non-null name seen
			// rather than freezing whichever observation happened to arrive first.
			if (name !== null) existing.name = name;
		} else {
			nodesById.set(id, { name, observations: 1 });
		}
	}
	const nodesRepresented: RepresentedNode[] = [...nodesById.entries()]
		.map(([id, entry]) => ({ id, name: entry.name, observations: entry.observations }))
		.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "") || a.id.localeCompare(b.id));
	return {
		total: nodes.length,
		timedOut,
		boundByNode,
		boundByWorkspace,
		stalePricing,
		unstampedPricing,
		priceUnknown,
		nodesRepresented,
		unnamedNode,
		unidentifiedRecords,
	};
}

/** Which identity axis `groupObservations` buckets on, and the exact field on
 *  `ObservationNode` each one reads. `"host"` keys on `host.id` (opaque, stable) —
 *  never `host.name` — for the same collision reason `nodesRepresented` does
 *  (see `RepresentedNode`'s doc): two real machines can legitimately declare the
 *  same name, and merging them into one bucket would silently absorb one node's
 *  spend into another's report. */
export type GroupByAxis = "workspace" | "host" | "spawner";

const GROUP_KEY_FIELD: Record<GroupByAxis, string> = {
	workspace: "refarm.workspace.id",
	host: "host.id",
	spawner: "refarm.budget.spawner",
};

/** Requests and tokens are the primary quantity (Global Constraints) — every
 *  group carries these regardless of whether its dollar axis applies. Absent
 *  counters on a member contribute 0 to the sum: this is a TOTAL, not a
 *  per-record unknown-tracking field for most members — but see
 *  `GroupTotals.noUsageRecord` for the one case where a 0 here is not a real
 *  zero but a missing record entirely.
 *
 *  PROVIDER SEMANTICS DIFFER, undocumented until now: for Anthropic,
 *  `input` EXCLUDES both cache buckets — total input processed is the sum of
 *  all three fields — while for OpenAI-family providers, `input` (their
 *  `prompt_tokens`) ALREADY INCLUDES `cacheRead`, and `reasoning` is a SUBSET
 *  of `output`, not additional to it (`InputAccounting::Disjoint` vs
 *  `::Subset`, `packages/agent/src/utils.rs`; `ingest_anthropic_usage` vs
 *  `ingest_openai_usage`, `packages/agent/src/provider_runtime/
 *  usage_totals.rs`). Nothing in this file combines these five fields into a
 *  derived total today, so nothing here is wrong — but a group whose members
 *  span both provider families means a different thing by `input` per member,
 *  and a future reader who sums `input + cacheRead` to get "total processed"
 *  would double-count every OpenAI-family member. */
export interface GroupTokenTotals {
	input: number;
	output: number;
	cacheCreation: number;
	cacheRead: number;
	reasoning: number;
}

export interface GroupTotals {
	observations: number;
	tokens: GroupTokenTotals;
	/**
	 * Sum of `refarm.cost.estimated_usd` across members that POSITIVELY
	 * establish a real, known price: `refarm.pricing_mode === "api"` (the ONLY
	 * mode `estimate_billable_usd`, `packages/agent/src/utils.rs`, ever prices —
	 * every other mode short-circuits to a real `0.0` before any rate lookup
	 * runs) AND `refarm.cost.price_known === true`.
	 *
	 * `null` — never `0` — when no member qualifies. The check is INVERTED on
	 * purpose (include only what is positively billable, rather than exclude
	 * what is recognisably not) so that `"subscription"`, `"local"`, a
	 * `pricing_mode` this reducer has never seen, and a `pricing_mode` that is
	 * entirely ABSENT all land on the safe, unbilled side by construction — a
	 * fifth pricing mode invented in Rust tomorrow does not need this file
	 * updated to stay honest. (Review finding, 2026-08-08: the prior exclusion-
	 * based branch treated `"local"` — Ollama, first-class in this repo — and an
	 * entirely absent `pricing_mode` — a terminal effort with no `UsageRecord`
	 * at all, see `noUsageRecord` below — as billable, both reporting a
	 * confident `usd: 0` where `null` was required.)
	 */
	usd: number | null;
	/** Members whose `refarm.pricing_mode` is `"subscription"` OR `"local"` —
	 *  structurally, deliberately zero-cost BY DESIGN, not merely unpriced.
	 *  `price_is_known`/`estimate_billable_usd` (`packages/agent/src/utils.rs`)
	 *  treat these two modes IDENTICALLY: both short-circuit to a real `$0.00`
	 *  before `rate_for_model` ever runs. Present (and countable) even when
	 *  `usd` is a real number, so a mixed group's partial sum stays legible as
	 *  partial. Distinct from `priceUnknown`: this member's cost IS zero, on
	 *  purpose, not unknown. */
	structuralZeroMembers: number;
	/** Members with a PRESENT `refarm.pricing_mode` that still could not
	 *  positively establish a price: an `"api"` member whose
	 *  `refarm.cost.price_known !== true` (F5's genuine "no rate on file", or a
	 *  record predating that field), or a `pricing_mode` string this reducer
	 *  does not recognise as `"subscription"`/`"local"`/`"api"` (a mode added in
	 *  Rust after this file was last updated). Both are the SAME fact from this
	 *  reader's position — "a usage record exists, but this axis cannot say
	 *  what it cost" — extending `summariseObservations`' own `priceUnknown`
	 *  field per group rather than paralleling it. Distinct from
	 *  `noUsageRecord`: here, tokens are real and trustworthy; only the dollar
	 *  reading is unknown. */
	priceUnknown: number;
	/** Members with NO `refarm.pricing_mode` at all — a terminal effort
	 *  (`done`/`delivered`/`partial`/`failed`/`timed-out`/`cancelled`) for which
	 *  `find_usage_record_for` (`packages/tractor/src/sidecar/dispatch.rs`)
	 *  found no `UsageRecord`, so `put_usage` (`observation.rs`) returned before
	 *  setting `pricing_mode`, `price_known`, OR `estimated_usd` — e.g. an
	 *  effort that failed before ever calling a model. This is NOT the same gap
	 *  as `priceUnknown`: there, a usage record exists and tokens are real; here,
	 *  NONE of `tokens` above was recorded for these members either — their
	 *  contribution to every `GroupTokenTotals` field is a real "nothing was
	 *  written," not a real "zero tokens used." Counted so a reader can tell the
	 *  two apart rather than reading an undercounted token total as complete. */
	noUsageRecord: number;
}

export interface ObservationGroup extends GroupTotals {
	/** The grouping key's raw value — a workspace id, a `host.id`, or a spawner
	 *  string. Never `null`/`"(unattributed)"` here; the unattributed bucket is
	 *  its own field on `GroupedObservations`, not a row mixed into this array
	 *  (Global Constraints: unattributed is a row, never a dilution — and here it
	 *  is not even IN the array a careless `.reduce` might sum over). */
	key: string;
	/** The declared, mutable, human label for this key — currently only populated
	 *  for `by: "host"` (`host.name`, same identity-vs-label split as
	 *  `RepresentedNode`). `null` for `workspace`/`spawner` groups, whose key IS
	 *  already the human string, and for a `host` group whose members never
	 *  declared a name. */
	label: string | null;
}

export interface GroupedObservations {
	by: GroupByAxis;
	/** `nodes.length` — every member, attributed or not. Mirrors
	 *  `ObservationSummary.total`'s meaning exactly so the two commands' JSON
	 *  never disagree about what "total" means. */
	total: number;
	/** One entry per distinct key value seen, sorted by observation count
	 *  descending (ties broken by key ascending) so the heaviest group leads. */
	groups: ObservationGroup[];
	/** Every member with NO value for this axis's key field — its own bucket,
	 *  always present (even at `observations: 0`), never folded into `groups` or
	 *  dropped. A `by-workspace` run against the operator's real record puts 21
	 *  of 29 observations here, because attribution shipped after most of the
	 *  record was written; reading `groups` alone as "the record" would silently
	 *  understate every workspace by that same 21.
	 *
	 *  For `by: "host"`, this is the SAME quantity `summariseObservations` calls
	 *  `unidentifiedRecords` (no `host.id` at all) — one generic bucket name
	 *  shared across all three axes here, by design, rather than a fourth vocabulary
	 *  for the identical fact `ObservationSummary` already names. */
	unattributed: GroupTotals;
}

/** The only two pricing modes that are structurally, deliberately zero-cost —
 *  see `structuralZeroMembers`'s doc on `GroupTotals` for the Rust citation.
 *  A `Set`, not a third `=== "local"` comparison bolted beside the existing
 *  `=== "subscription"` one, so this stays the ONE place that names them. */
const STRUCTURALLY_ZERO_PRICING_MODES = new Set(["subscription", "local"]);

interface MutableGroupBucket {
	observations: number;
	tokens: GroupTokenTotals;
	usdSum: number;
	/** At least one member contributed a real, known-priced dollar figure to
	 *  `usdSum`. Distinguishes "usd is a real 0.0" from "usd does not apply" —
	 *  the same distinction `usd: number | null` makes at the type level. */
	hasBillableMember: boolean;
	structuralZeroMembers: number;
	priceUnknown: number;
	noUsageRecord: number;
	label: string | null;
}

function newGroupBucket(): MutableGroupBucket {
	return {
		observations: 0,
		tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0 },
		usdSum: 0,
		hasBillableMember: false,
		structuralZeroMembers: 0,
		priceUnknown: 0,
		noUsageRecord: 0,
		label: null,
	};
}

function numericField(node: ObservationNode, field: string): number {
	const raw = node[field];
	return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/** Sums the five `gen_ai.usage.*` fields into `tokens`, in place — the ONE place both
 *  the dollar-axis reducer (`absorbIntoGroupBucket`) and the period-axis reducer
 *  (`absorbIntoPeriodBucket`) accumulate tokens, so the two surfaces can never drift
 *  into summing (or missing) a field differently. Extracted from what used to be two
 *  near-identical five-line blocks (code review, follow-up to fc53a9c3) — the same
 *  "two functions counting the same thing under different code" shape the review
 *  called out for the unknown-tracking fields below, here for the accumulation
 *  itself. Absent counters on a member contribute 0, same discipline as
 *  `GroupTokenTotals`'s own doc — this is a TOTAL, not a per-record unknown-tracking
 *  field; `noUsageRecord` below is where that distinction actually lives. */
function accumulateTokens(tokens: GroupTokenTotals, node: ObservationNode): void {
	tokens.input += numericField(node, "gen_ai.usage.input_tokens");
	tokens.output += numericField(node, "gen_ai.usage.output_tokens");
	tokens.cacheCreation += numericField(node, "gen_ai.usage.cache_creation.input_tokens");
	tokens.cacheRead += numericField(node, "gen_ai.usage.cache_read.input_tokens");
	tokens.reasoning += numericField(node, "gen_ai.usage.reasoning.output_tokens");
}

/** Whether `refarm.pricing_mode` is present on this record AT ALL — the ONE
 *  underlying fact both the dollar axis and the token/period axis need from the
 *  SAME Rust condition: `find_usage_record_for` (`packages/tractor/src/sidecar/
 *  dispatch.rs`) returned `None` for this terminal effort, so `put_usage`
 *  (`observation.rs`) returned before writing `pricing_mode`, `price_known`,
 *  `estimated_usd`, OR any `gen_ai.usage.*` field — nothing, not a manufactured
 *  zero. Named ONCE so the dollar-axis reducer and the period-axis reducer cannot
 *  count "no UsageRecord at all" under two different tests that quietly drift
 *  apart (the exact defect class code review flagged: the same unknown counted
 *  under different names/logic in two functions in this file). */
function hasUsageRecord(node: ObservationNode): boolean {
	return node["refarm.pricing_mode"] !== undefined;
}

function absorbIntoGroupBucket(bucket: MutableGroupBucket, node: ObservationNode, by: GroupByAxis): void {
	bucket.observations += 1;
	accumulateTokens(bucket.tokens, node);

	if (by === "host") {
		// Same "keep the newest non-null name seen" rule as `summariseObservations`'
		// `nodesRepresented` — host.name is read live and documented mutable.
		const rawName = node["host.name"];
		const name = typeof rawName === "string" && rawName.length > 0 ? rawName : null;
		if (name !== null) bucket.label = name;
	}

	const pricingMode = node["refarm.pricing_mode"];

	// THREE STATES for the dollar axis, checked in this order, POSITIVE-inclusion
	// first: nothing falls through to "billable" by default.
	//
	// 1. No `pricing_mode` at all → no `UsageRecord` was ever written for this
	//    terminal effort (see `noUsageRecord`'s doc, and `hasUsageRecord`'s doc for
	//    why this exact check is shared with the period-axis reducer below) —
	//    checked FIRST because an absent value must never be tested against a
	//    `Set`/`===` and silently read as "not a recognised mode, so try to price
	//    it anyway".
	if (!hasUsageRecord(node)) {
		bucket.noUsageRecord += 1;
		return;
	}
	// 2. The ONLY positive path to a real dollar figure: mode is exactly "api"
	//    AND the price is POSITIVELY known (`=== true`, not merely `!== false` —
	//    an absent `price_known` on a stray "api" record must not default to
	//    billable either).
	if (pricingMode === "api" && node["refarm.cost.price_known"] === true) {
		bucket.usdSum += numericField(node, "refarm.cost.estimated_usd");
		bucket.hasBillableMember = true;
		return;
	}
	// 3. A recognised, deliberate zero ("subscription"/"local") vs. everything
	//    else that has a `pricing_mode` but still isn't billable (an unpriced
	//    "api" member, or a mode string this file has never seen — the "fourth
	//    mode added in Rust tomorrow" case, which lands HERE, safely excluded,
	//    without this file needing to know its name).
	if (typeof pricingMode === "string" && STRUCTURALLY_ZERO_PRICING_MODES.has(pricingMode)) {
		bucket.structuralZeroMembers += 1;
		return;
	}
	bucket.priceUnknown += 1;
}

function finalizeGroupBucket(bucket: MutableGroupBucket): GroupTotals {
	return {
		observations: bucket.observations,
		tokens: bucket.tokens,
		usd: bucket.hasBillableMember ? bucket.usdSum : null,
		structuralZeroMembers: bucket.structuralZeroMembers,
		priceUnknown: bucket.priceUnknown,
		noUsageRecord: bucket.noUsageRecord,
	};
}

/**
 * Pure grouping reducer over the same record `summariseObservations` reads —
 * extends its vocabulary (`priceUnknown`, the `total`/unattributed-vs-dropped
 * discipline) rather than paralleling it. Answers "what did this workspace/node/
 * spawner cost", in requests and tokens first, dollars second and only when the
 * dollar axis genuinely applies (Global Constraints).
 */
export function groupObservations(
	nodes: readonly ObservationNode[],
	options: { by: GroupByAxis },
): GroupedObservations {
	const { by } = options;
	const keyField = GROUP_KEY_FIELD[by];
	const buckets = new Map<string, MutableGroupBucket>();
	const unattributed = newGroupBucket();

	for (const node of nodes) {
		const raw = node[keyField];
		const key = typeof raw === "string" && raw.length > 0 ? raw : undefined;
		if (key === undefined) {
			absorbIntoGroupBucket(unattributed, node, by);
			continue;
		}
		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = newGroupBucket();
			buckets.set(key, bucket);
		}
		absorbIntoGroupBucket(bucket, node, by);
	}

	const groups: ObservationGroup[] = [...buckets.entries()]
		.map(([key, bucket]) => ({ key, label: bucket.label, ...finalizeGroupBucket(bucket) }))
		.sort((a, b) => b.observations - a.observations || a.key.localeCompare(b.key));

	return {
		by,
		total: nodes.length,
		groups,
		unattributed: finalizeGroupBucket(unattributed),
	};
}

/**
 * The current rate table version, derived from the record itself rather than
 * hand-typed (F7). `RATE_TABLE_VERSION` (`packages/agent/src/utils.rs`) lives
 * in the WASM guest, unreachable from this TS surface without new plumbing —
 * but every observation already carries the version that priced it
 * (`refarm.cost.rate_table_version`) alongside a `timestamp_ns`. The newest
 * observation necessarily priced against whatever version its agent build
 * shipped, so its stamp names "current" without a second, driftable copy of
 * the string. Returns `undefined` when no observation carries both a stamp
 * and a timestamp (nothing to derive from yet) — staleness then stays
 * undetermined, exactly as an explicit `--current-rate-table` omission
 * already behaves. PURE.
 */
export function currentRateTableFrom(nodes: readonly ObservationNode[]): string | undefined {
	let newestTs = -Infinity;
	let newestVersion: string | undefined;
	for (const node of nodes) {
		const version = node["refarm.cost.rate_table_version"];
		if (typeof version !== "string") continue;
		const rawTs = node.timestamp_ns;
		const ts = typeof rawTs === "number" ? rawTs : Number(rawTs);
		if (!Number.isFinite(ts)) continue;
		if (ts > newestTs) {
			newestTs = ts;
			newestVersion = version;
		}
	}
	return newestVersion;
}

function parseLimitOption(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new InvalidArgumentError("--limit must be a positive integer.");
	}
	return parsed;
}

/** Zero IS valid here, unlike `--limit` — "start at the beginning" is the default and must be
 *  expressible, so this is a separate parser rather than a reuse that would reject it. */
function parseOffsetOption(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new InvalidArgumentError("--offset must be a non-negative integer.");
	}
	return parsed;
}

/**
 * The sidecar's `/nodes` page-level facts, deliberately NOT folded into `ObservationSummary`.
 * `summary.total` already means "how many observations this call returned" (`nodes.length`
 * inside `summariseObservations`); `stored` here means something else entirely — how many
 * `BudgetObservation` nodes exist in storage, independent of `--limit` or the server's own
 * 100-row cap. Naming both "total" would put two different facts under one word in the same
 * command's output — the collision this shape exists to avoid.
 *
 * THREE STATES, not two, same discipline as `runtime-freshness-doctor.ts`'s
 * fresh/stale/unknown: `stored`/`truncated` are `undefined` together when the sidecar did
 * not report them at all — a real, live case, not a hypothetical one. A sidecar built
 * before this field shipped omits both keys from `GET /nodes`'s JSON, and a caller talking
 * to that node has NO basis to say the record is complete. Defaulting `truncated` to
 * `false` in that gap would assert "nothing was truncated" precisely when nobody said so —
 * the exact silent-false-clean shape this whole task exists to remove, reintroduced one
 * layer up. `undefined` here must propagate as `undefined`, never rounded to a boolean.
 */
export interface BudgetObservationsPage {
	observations: ObservationNode[];
	/** How many `BudgetObservation` nodes exist right now — the true count, not a page size.
	 *  `undefined` when the sidecar did not say (see the interface doc) — NOT defaulted to
	 *  `observations.length`, which would silently claim the page is the whole record. */
	stored: number | undefined;
	/** Whether this page left rows out. `true`/`false` only when the sidecar's response said
	 *  so; `undefined` when it didn't. The database is the only side that can see what was
	 *  NOT returned, so this is never computed on the client from `stored` and the page size
	 *  — an `undefined` `stored` must produce an `undefined` `truncated`, not a guess. */
	truncated: boolean | undefined;
	/** Which row this page starts at — echoed by the sidecar, defaulted to 0 for an older build
	 *  that does not page. Unlike `stored`/`truncated` this one IS safe to default, because the
	 *  caller chose it: 0 is what a request that sent no offset asked for. */
	offset: number;
}

/**
 * Pure translation from the sidecar's raw `/nodes` JSON body to `BudgetObservationsPage`.
 * Split out from `fetchBudgetObservations` so the omitted-fields case is directly testable
 * with a literal payload, no network — and it is not a hypothetical case: any sidecar
 * built before `stored`/`truncated` shipped omits both keys, and that is the LIVE path for
 * a node still running an older build.
 */
export function budgetObservationsPageFromBody(body: {
	nodes?: unknown[];
	stored?: number;
	truncated?: boolean;
	offset?: number;
}): BudgetObservationsPage {
	const observations = Array.isArray(body.nodes) ? (body.nodes as ObservationNode[]) : [];
	return {
		observations,
		// Absent means absent: no fallback to `observations.length` / `false`. See
		// `BudgetObservationsPage`'s doc for why a guess here is worse than saying "unknown".
		stored: typeof body.stored === "number" ? body.stored : undefined,
		truncated: typeof body.truncated === "boolean" ? body.truncated : undefined,
		// Defaulted, and it is the one field here that may be: an absent `offset` means the
		// request did not ask to skip anything, which is 0. It is not a measurement the node
		// withheld — it is the caller's own parameter coming back.
		offset: typeof body.offset === "number" ? body.offset : 0,
	};
}

async function fetchBudgetObservations(
	limit: number,
	offset = 0,
): Promise<BudgetObservationsPage> {
	const paging = offset > 0 ? `&offset=${offset}` : "";
	const body = await fetchSidecarJson<{
		nodes?: unknown[];
		stored?: number;
		truncated?: boolean;
		offset?: number;
	}>(
		sidecarUrl(
			`/nodes?type=${encodeURIComponent(BUDGET_OBSERVATION_NODE_TYPE)}&limit=${limit}${paging}`,
		),
	);
	return budgetObservationsPageFromBody(body);
}

/**
 * Where the operator goes next — and, for `total === 0`, WHY that is not an
 * all-clear. This repository has already been bitten once by a gate reporting
 * success for work it never ran; a summariser that reads "0/0, nothing to
 * report" without saying so reproduces the exact same shape of lie. So an empty
 * record says plainly that nothing has been observed yet and names what would
 * fill it: every terminal effort (done, delivered, partial, failed, timed-out,
 * cancelled) writes one row, governed by whichever level — node, workspace,
 * declared, or default — resolved for it. No `nextCommand` is offered for the empty case:
 * the thing that would fill the record is dispatching and finishing a real
 * workload (e.g. `refarm ask "…"`), which spends real budget and must not be
 * something a `--json` consumer follows automatically.
 */
function observationsNextAction(summary: ObservationSummary): string | null {
	if (summary.total === 0) {
		return NO_OBSERVATIONS_MESSAGE;
	}
	if (summary.stalePricing > 0) {
		return (
			`${summary.stalePricing} observation(s) were priced by a rate table that has ` +
			"since been superseded — their token counts are still true, so the cost is " +
			"recomputable from the stamped rate_table_version."
		);
	}
	return null;
}

export function outcomeMark(outcome: string): string {
	switch (outcome) {
		case "done":
			return chalk.green("●");
		// `delivered` closes a router-dispatched (non-`respond`) effort honestly —
		// the verb result lands as an out-of-band node, not a completed task
		// result — and `partial` closes one whose task only partly completed.
		// Both are terminal (`is_terminal_effort_status`, sidecar/mod.rs) and both
		// land in `refarm.outcome` on a real node today; rendering them via the
		// `·` fallback below used to hide a real outcome as "unrecognised".
		case "delivered":
			return chalk.green("▸");
		case "partial":
			return chalk.yellow("◐");
		case "timed-out":
			return chalk.yellow("⏱");
		case "failed":
			return chalk.red("✗");
		case "cancelled":
			return chalk.dim("⊘");
		default:
			return chalk.dim("·");
	}
}

/**
 * The truncation/completeness notice — shared verbatim between `observations`
 * and the grouped `by-*` commands (Task 1 review, Critical 3: the grouped
 * commands' human output used to drop this signal entirely, so a record past
 * `MAX_NODES_PER_RESPONSE`/`--limit` looked complete over partial data — the
 * same "looks complete, isn't" failure the unattributed row exists to
 * prevent, one layer up, and only on the human surface). `commandLabel` names
 * the specific subcommand whose response is capped (`refarm budget
 * observations`, `refarm budget by-workspace`, …) so the notice never claims
 * a page limit for a command other than the one the operator just ran.
 */
function printPageCompletenessNotice(
	shownCount: number,
	page: Pick<BudgetObservationsPage, "stored" | "truncated" | "offset">,
	commandLabel: string,
): void {
	// The branch reads the SHARED judgement rather than the raw field: `readCompleteness` is the
	// one function `@refarm.dev/storage-contract-v1` exports for this, and four sites in this file
	// were each re-deciding what an absent `truncated` means (ISS-040).
	const completeness = readCompleteness(page);
	if (completeness === "partial") {
		// `shownCount` (the caller's own header line) and `page.stored` (here) are
		// deliberately printed side by side with different words, not both called
		// "total" — see `BudgetObservationsPage`'s doc for why that collision must
		// not happen.
		//
		// THIS SENTENCE HAS NOW BEEN WRONG TWICE, IN OPPOSITE DIRECTIONS, and both times because
		// it described the transport from memory rather than from the transport:
		//
		//   1. it once ended "raise --limit to see the rest" — advice that could not work, since
		//      the sidecar clamps every response at MAX_NODES_PER_RESPONSE and DEFAULT_LIMIT was
		//      already equal to that ceiling;
		//   2. it was then corrected to "rows beyond the cap are not reachable today" — true when
		//      written, and false from the moment `GET /nodes` learned `offset` (ISS-042).
		//
		// So it names a command the operator can run and the number to run it with, which is the
		// only form of this claim that goes stale loudly instead of quietly.
		//
		// `page.stored` can be absent even when `truncated` is `true` — `BudgetObservationsPage`'s
		// doc allows either field to be missing independently, so this must not print "of
		// undefined" when the sidecar reports truncation without also reporting the true count.
		const storedNote = typeof page.stored === "number" ? ` of ${page.stored} stored` : "";
		const nextOffset = page.offset + shownCount;
		console.log(
			chalk.yellow(
				`  ⚠  Showing ${shownCount}${storedNote}, starting at ${page.offset} — this ` +
					`command's response is capped at a single page. The rest is reachable: ` +
					`\`${commandLabel} --offset ${nextOffset}\`.\n`,
			),
		);
	} else if (completeness === "unknown") {
		// This is a gap in what the node could report, not a finding about the record — it
		// may be all of them or it may not, and this cannot tell you which. Same phrasing
		// discipline as `runtime-freshness-doctor.ts`'s `unknown` state: reported plainly,
		// never rounded to "nothing was truncated".
		console.log(
			chalk.dim(
				`  ?  Completeness unknown — this node did not report how many BudgetObservation ` +
					`records exist (an older sidecar build). Whether ${shownCount} shown is all ` +
					`of them cannot be determined from this response.\n`,
			),
		);
	}
}

/** Exported for `budget.test.ts` — drives the truncation notice with a literal payload,
 *  no network, per the same pattern the rest of this file's pure functions already use. */
export function printObservationsHuman(
	observations: readonly ObservationNode[],
	summary: ObservationSummary,
	page: Pick<BudgetObservationsPage, "stored" | "truncated" | "offset">,
): void {
	console.log(chalk.bold(`\n  Budget observations  (${summary.total} shown)\n`));
	printPageCompletenessNotice(summary.total, page, "refarm budget observations");
	if (summary.total === 0) {
		console.log(chalk.dim(`  ${observationsNextAction(summary) ?? ""}`));
		return;
	}
	console.log(
		chalk.dim(
			`  timed-out: ${summary.timedOut}   bound-by-node: ${summary.boundByNode}   ` +
				`bound-by-workspace: ${summary.boundByWorkspace}   ` +
				`stale-pricing: ${summary.stalePricing}   unstamped-pricing: ${summary.unstampedPricing}   ` +
				`price-unknown: ${summary.priceUnknown}\n`,
		),
	);
	// One entry per IDENTIFIED node (host.id), name as a display label — never one entry
	// per label, so two nodes that happen to share a declared name still render as two.
	const nodeLabel = (node: RepresentedNode): string => {
		const label = node.name ?? "(unnamed)";
		const idSlice = node.id.slice(0, 8);
		const suffix = node.observations > 1 ? ` x${node.observations}` : "";
		return `${label} [${idSlice}]${suffix}`;
	};
	const nodesLabel =
		summary.nodesRepresented.length > 0
			? summary.nodesRepresented.map(nodeLabel).join(", ")
			: "(none declared)";
	console.log(
		chalk.dim(
			`  nodes: ${nodesLabel}   unnamed-node: ${summary.unnamedNode}   ` +
				`unidentified-records: ${summary.unidentifiedRecords}\n`,
		),
	);
	for (const node of observations) {
		const outcome = typeof node["refarm.outcome"] === "string" ? node["refarm.outcome"] : "?";
		const boundBy =
			typeof node["refarm.budget.bound_by"] === "string" ? node["refarm.budget.bound_by"] : "?";
		const effortId = typeof node.effort_id === "string" ? node.effort_id : "?";
		const hostName = typeof node["host.name"] === "string" ? (node["host.name"] as string) : "?";
		// The short id slice rides every row too, not only the summary line: two rows both
		// printing "node:sede" would otherwise look like the same machine ran both, which is
		// the exact lie this change removes from the summary above.
		const hostId = typeof node["host.id"] === "string" ? (node["host.id"] as string).slice(0, 8) : undefined;
		const nodeColumn = hostId ? `${hostName}[${hostId}]` : hostName;
		console.log(
			`  ${outcomeMark(outcome as string)} ${(outcome as string).padEnd(10)} ` +
				`bound-by:${(boundBy as string).padEnd(10)} node:${nodeColumn.padEnd(21)} ${chalk.dim(effortId as string)}`,
		);
	}
	console.log(chalk.dim(`\n  ${BUDGET_OBSERVATIONS_JSON_COMMAND}\n`));
}

const GROUP_AXIS_LABEL: Record<GroupByAxis, string> = {
	workspace: "workspace",
	host: "host",
	spawner: "spawner",
};

/** The subcommand name per axis — used both to build the `--json` example
 *  string in help text and, here, to name the specific command a truncation
 *  notice is about (`printPageCompletenessNotice`'s `commandLabel`). */
const GROUP_SUBCOMMAND_NAME: Record<GroupByAxis, string> = {
	workspace: "by-workspace",
	host: "by-host",
	spawner: "by-spawner",
};

/** The row label this file reserves for the unattributed bucket. A REAL
 *  workspace/spawner could, in principle, be named exactly this string — JSON
 *  is unaffected (the bucket lives in its own `unattributed` field, never in
 *  `groups`), but the human table would otherwise print two adjacent,
 *  visually identical rows with no way to tell which is which (Minor finding,
 *  Task 1 review). `printGroupedObservationsHuman` disambiguates any real
 *  group whose label collides with this sentinel before printing it. */
const UNATTRIBUTED_ROW_LABEL = "(unattributed)";

/**
 * `usd === null` renders as an em dash, never `$0.00` (Global Constraints: a
 * report that prints `$0.00` next to real work teaches the operator to ignore
 * the column; `—` teaches him the axis does not apply here).
 */
function formatGroupUsd(usd: number | null): string {
	return usd === null ? "—" : `$${usd.toFixed(4)}`;
}

/** Where the operator goes next after a grouped report — same discipline as
 *  `observationsNextAction`, extended rather than paralleled: the empty-record
 *  case shares its exact wording (`NO_OBSERVATIONS_MESSAGE`), and a non-empty
 *  report additionally names the unattributed bucket by count so it is never
 *  mistaken for "nothing left to attribute" silence. */
function groupedNextAction(grouped: GroupedObservations): string | null {
	if (grouped.total === 0) return NO_OBSERVATIONS_MESSAGE;
	if (grouped.unattributed.observations > 0) {
		const axis = GROUP_AXIS_LABEL[grouped.by];
		return (
			`${grouped.unattributed.observations} of ${grouped.total} observation(s) have no ${axis} ` +
			`attribution and are grouped under (unattributed) rather than folded into a total — see ` +
			`${BUDGET_OBSERVATIONS_JSON_COMMAND} for the individual records.`
		);
	}
	return null;
}

/** Exported for `budget.test.ts` — drives the grouped report with a literal
 *  `GroupedObservations`, no network, same pattern as `printObservationsHuman`.
 *  Takes `page` for the same reason `printObservationsHuman` does: the
 *  truncation/completeness signal must reach the human surface here too
 *  (Task 1 review, Critical 3) — it used to be JSON-only. */
export function printGroupedObservationsHuman(
	grouped: GroupedObservations,
	page: Pick<BudgetObservationsPage, "stored" | "truncated" | "offset">,
): void {
	const axis = GROUP_AXIS_LABEL[grouped.by];
	console.log(chalk.bold(`\n  Budget by ${axis}  (${grouped.total} observation(s))\n`));
	printPageCompletenessNotice(grouped.total, page, `refarm budget ${GROUP_SUBCOMMAND_NAME[grouped.by]}`);
	if (grouped.total === 0) {
		console.log(chalk.dim(`  ${groupedNextAction(grouped) ?? ""}`));
		return;
	}
	const printRow = (label: string, totals: GroupTotals): void => {
		const flags: string[] = [];
		if (totals.structuralZeroMembers > 0) flags.push(`non-billable:${totals.structuralZeroMembers}`);
		if (totals.priceUnknown > 0) flags.push(`price-unknown:${totals.priceUnknown}`);
		if (totals.noUsageRecord > 0) flags.push(`no-usage-record:${totals.noUsageRecord}`);
		const flagsText = flags.length > 0 ? `   (${flags.join(", ")})` : "";
		console.log(
			`  ${label.padEnd(28)} obs:${String(totals.observations).padEnd(5)} ` +
				`in:${String(totals.tokens.input).padEnd(8)} out:${String(totals.tokens.output).padEnd(8)} ` +
				`usd:${formatGroupUsd(totals.usd)}${flagsText}`,
		);
	};
	for (const group of grouped.groups) {
		// by:"host" carries a separate mutable label (host.name); workspace/spawner keys
		// are already the human-facing string, so the key alone is the label there.
		let rowLabel =
			grouped.by === "host"
				? `${group.label ?? "(unnamed)"} [${group.key.slice(0, 8)}]`
				: group.key;
		// A real workspace/spawner named exactly "(unattributed)" would otherwise print
		// identically to the bucket below — see `UNATTRIBUTED_ROW_LABEL`'s doc.
		if (rowLabel === UNATTRIBUTED_ROW_LABEL) rowLabel = `${UNATTRIBUTED_ROW_LABEL} [a real key, not the bucket]`;
		printRow(rowLabel, group);
	}
	// The unattributed row — ALWAYS printed, even at zero, per Global Constraints: its
	// presence at zero is itself informative (this axis is fully attributed), and its
	// absence at any other value would be the exact silent dilution this row exists to
	// prevent.
	printRow(UNATTRIBUTED_ROW_LABEL, grouped.unattributed);
	console.log(chalk.dim(`\n  ${BUDGET_OBSERVATIONS_JSON_COMMAND}\n`));
}

/**
 * Requests-per-billing-period — the axis `groupObservations` cannot answer. The
 * operator's daily route is `openai-codex`, a SUBSCRIPTION: `refarm.pricing_mode`
 * is `"subscription"` in 29 of 29 live records and `refarm.cost.estimated_usd`
 * sums to 0.0 across all of them (measured 2026-08-08). Every existing budget
 * bound — `refarm.budget.max_usd`, `max_tokens` — measures consumption WITHIN a
 * single dispatch. A subscription quota is a different kind of constraint: it
 * REFILLS on a billing date, across runs, rather than being drawn down within
 * one. No new counter is written for this — `timestamp_ns` already rides every
 * observation — this section only reads it differently.
 *
 * THE DESIGN DECISION, MADE EXPLICIT: a subscription quota refills on a billing
 * DATE, and no `BudgetObservation` field names that date — nothing has ever been
 * asked to write it. Two different readings of "usage this period" are both
 * defensible from `timestamp_ns` alone, and they disagree:
 *
 *   - ROLLING: the last N days, counted back from now.
 *   - CALENDAR: the 1st of the current month through today.
 *
 * ROLLING is the default (`DEFAULT_PERIOD_SPEC = "30d"`) because a calendar
 * month is confidently WRONG for every billing anchor except "signs up on the
 * 1st" — it resets the window on a day chosen by the calendar, not by the
 * vendor, and the operator's actual anchor date is not recorded anywhere this
 * command can read. A rolling window makes no claim about which day of the
 * month the quota refills; "usage in the last 30 days" is true regardless of
 * where in a billing cycle today happens to fall, which is the only property a
 * default can honestly promise without the anchor date. CALENDAR remains
 * REACHABLE, not deleted, via `--period month` (this month) or `--period
 * YYYY-MM` (a named month) — a reader who DOES know their billing anchor is
 * the calendar month can ask for exactly that.
 */
export type PeriodKind = "rolling-days" | "calendar-month";

/**
 * A period spec resolved to concrete millisecond bounds — half-open,
 * `[startMs, endMs)`: inclusive start, exclusive end. Half-open so that two
 * adjacent periods (this month and next month; today's rolling window and
 * tomorrow's) partition every possible timestamp without either double-
 * counting or dropping the exact instant at the boundary.
 */
export interface ResolvedPeriod {
	kind: PeriodKind;
	/** Milliseconds since epoch — the domain `Date.now()` and `Date.UTC()` both
	 *  use, converted down from the record's `timestamp_ns` (nanoseconds) at
	 *  read time rather than carried in nanoseconds: a day/month boundary needs
	 *  only millisecond precision, and staying in that unit keeps every
	 *  comparison here exact instead of routing through a magnitude where a JS
	 *  `number`'s 53-bit mantissa is already lossy below the microsecond (true
	 *  of `timestamp_ns` itself at today's epoch scale — a pre-existing
	 *  property of this record, not something introduced here; see
	 *  `currentRateTableFrom` above, which already treats it as a plain
	 *  `number`). */
	startMs: number;
	endMs: number;
	/** The spec string this was parsed from (e.g. `"30d"`, `"month"`,
	 *  `"2026-08"`) — echoed back so a `--json` reader sees exactly what was
	 *  asked for, not just the bounds it resolved to. */
	spec: string;
	/** Human label, e.g. `"last 30 days"` or `"August 2026"`. */
	label: string;
}

/** Rolling is the default — see this section's design-decision doc above. */
export const DEFAULT_PERIOD_SPEC = "30d";

const ROLLING_DAYS_PATTERN = /^([1-9]\d*)d$/;
const EXPLICIT_CALENDAR_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTH_NAMES = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];

function calendarMonthPeriod(year: number, monthIndex: number, spec: string): ResolvedPeriod {
	return {
		kind: "calendar-month",
		startMs: Date.UTC(year, monthIndex, 1),
		endMs: Date.UTC(year, monthIndex + 1, 1),
		spec,
		label: `${MONTH_NAMES[monthIndex]} ${year}`,
	};
}

/**
 * Pure: resolves a `--period` spec string to concrete bounds against a
 * caller-supplied `nowMs` — never reads the clock itself, so it is testable
 * against a fixed instant instead of whatever moment the test happens to run
 * (the CLI wiring below is the only caller that passes a real `Date.now()`).
 *
 * Accepts:
 *   `"<N>d"`    — a rolling N-day window ending at `nowMs` (the default).
 *   `"month"`   — the calendar month containing `nowMs`, UTC.
 *   `"YYYY-MM"` — a specific calendar month, independent of `nowMs`.
 *
 * Throws a plain `Error` (not `InvalidArgumentError` — that's commander's
 * vocabulary, wrapped on at the CLI boundary by `parsePeriodOption` below, not
 * here, so this function stays usable from a plain unit test) on anything else.
 */
export function parsePeriodSpec(spec: string, nowMs: number): ResolvedPeriod {
	const rolling = ROLLING_DAYS_PATTERN.exec(spec);
	if (rolling) {
		const days = Number(rolling[1]);
		return {
			kind: "rolling-days",
			startMs: nowMs - days * MS_PER_DAY,
			endMs: nowMs,
			spec,
			label: `last ${days} day${days === 1 ? "" : "s"}`,
		};
	}
	if (spec === "month") {
		const now = new Date(nowMs);
		return calendarMonthPeriod(now.getUTCFullYear(), now.getUTCMonth(), spec);
	}
	const explicitMonth = EXPLICIT_CALENDAR_MONTH_PATTERN.exec(spec);
	if (explicitMonth) {
		const year = Number(explicitMonth[1]);
		const monthIndex = Number(explicitMonth[2]) - 1;
		return calendarMonthPeriod(year, monthIndex, spec);
	}
	throw new Error(
		`Unrecognised --period "${spec}". Use "<N>d" for a rolling window (e.g. "30d", the ` +
			'default), "month" for the current calendar month, or "YYYY-MM" for a specific ' +
			'calendar month (e.g. "2026-08").',
	);
}

/** Commander's option-parser boundary for `--period` — validates eagerly (at
 *  argument-parsing time, before the action runs) by delegating to
 *  `parsePeriodSpec` and discarding the result; only the format is checked
 *  here — the `nowMs` actually used to resolve bounds is read fresh inside the
 *  action below, a few milliseconds later, which is immaterial at day
 *  granularity. Wraps the plain `Error` `parsePeriodSpec` throws into
 *  commander's `InvalidArgumentError`, same pattern `task-support.ts`'s own
 *  option parsers already use. */
function parsePeriodOption(value: string): string {
	try {
		parsePeriodSpec(value, Date.now());
	} catch (err) {
		throw new InvalidArgumentError(err instanceof Error ? err.message : String(err));
	}
	return value;
}

/** One bucket's worth of requests and tokens — same token vocabulary as
 *  `GroupTokenTotals`, no dollar field: `usageByPeriod` answers "how many
 *  requests", not "how much did they cost" (that remains `groupObservations`'
 *  job) — so `structuralZeroMembers`/`priceUnknown` are NOT mirrored here:
 *  both exist solely to explain gaps in a DOLLAR figure this bucket never
 *  computes. `noUsageRecord` IS mirrored — same field name, same meaning as
 *  `GroupTotals.noUsageRecord` — because it explains a gap in `tokens` itself
 *  (code review, follow-up to Task 1's fc53a9c3): a terminal effort with no
 *  `UsageRecord` at all contributes a real 0 to every field in `tokens` below
 *  because it has none to contribute — not because it ran and used nothing.
 *  Without this count, a bucket of five efforts that failed before ever
 *  calling a model reports `output: 0`, indistinguishable from five efforts
 *  that ran and genuinely produced nothing. */
export interface PeriodBucket {
	observations: number;
	tokens: GroupTokenTotals;
	/** Members with NO `refarm.pricing_mode` at all (`hasUsageRecord(node) ===
	 *  false`) — see that function's doc for the exact Rust condition this
	 *  reads. `tokens` above still accumulates unconditionally for every
	 *  member, same discipline `GroupTokenTotals`'s doc already states (this is
	 *  a TOTAL, not a per-record unknown-tracking field) — this count is what
	 *  lets a reader tell HOW MUCH of that total's `0` is "nothing was
	 *  recorded" rather than "nothing was spent". */
	noUsageRecord: number;
}

function newPeriodBucket(): PeriodBucket {
	return {
		observations: 0,
		tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0 },
		noUsageRecord: 0,
	};
}

function absorbIntoPeriodBucket(bucket: PeriodBucket, node: ObservationNode): void {
	bucket.observations += 1;
	accumulateTokens(bucket.tokens, node);
	// Checked, not returned early on — unlike the dollar axis, there is no further
	// branch to short-circuit here: every member's tokens are already accumulated
	// above regardless of this fact (see `PeriodBucket`'s doc for why that stays
	// unconditional), so this is purely an ADDITIONAL count, never a gate.
	if (!hasUsageRecord(node)) bucket.noUsageRecord += 1;
}

/** `timestamp_ns` (nanoseconds since epoch, per `now_ns()` in the WASM guest)
 *  converted to milliseconds — the domain `ResolvedPeriod` bounds live in.
 *  Deliberately its OWN small function, not shared with `currentRateTableFrom`
 *  above: that function is Task 1 territory under active review right now, and
 *  this task must not restructure anything it touches (this task's own brief) —
 *  a few duplicated lines here is the cheaper, zero-collision choice over
 *  extracting a shared helper mid-review. Returns `undefined` for anything that
 *  is not a finite number once coerced — a missing field, a non-numeric string,
 *  `NaN`, `Infinity` — so the caller can tell "no usable timestamp" apart from
 *  a real one, rather than defaulting to 0 (1970) or to "now" (which would
 *  silently place an unreadable record in the CURRENT period — exactly what
 *  this task's three-states requirement forbids). */
function parseObservationTimestampMs(node: ObservationNode): number | undefined {
	const raw = node.timestamp_ns;
	const ns = typeof raw === "number" ? raw : Number(raw);
	if (!Number.isFinite(ns)) return undefined;
	return ns / 1_000_000;
}

export interface UsageByPeriod {
	/** Echoes back exactly which window was queried, so a `--json` reader never
	 *  has to re-derive "what did 30d mean today" from a timestamp comparison
	 *  of its own. */
	period: ResolvedPeriod;
	/** `nodes.length` — every member read, regardless of which bucket it landed
	 *  in. Same total-equals-the-sum-of-every-bucket discipline as
	 *  `GroupedObservations.total`. */
	total: number;
	/** Records whose `timestamp_ns` falls inside `[period.startMs, period.endMs)`. */
	inPeriod: PeriodBucket;
	/** Records with a real, parseable timestamp OUTSIDE the queried window —
	 *  distinct from `inPeriod` and from `unknownTimestamp`: this usage
	 *  genuinely happened, just not during the period being asked about. */
	outOfPeriod: PeriodBucket;
	/** THREE STATES, NEVER TWO: records with no `timestamp_ns` at all, or one
	 *  that cannot be parsed as a finite number. This bucket exists so such a
	 *  record is neither silently dropped from the count nor silently folded
	 *  into `inPeriod` just because it could not be proven to belong outside
	 *  it — the exact failure mode this line of work keeps re-finding: a
	 *  missing/unparseable member treated as though the set were complete
	 *  without it, or worse, defaulted into the very bucket a reader is most
	 *  likely to act on. */
	unknownTimestamp: PeriodBucket;
}

/**
 * Pure: buckets the same record `groupObservations` reads into three states —
 * never two — against a caller-supplied, already-resolved `period`. Answers
 * "how many requests, and how many tokens, did I use in this window" — the
 * subscription request-quota axis, not the dollar axis.
 */
export function usageByPeriod(
	nodes: readonly ObservationNode[],
	options: { period: ResolvedPeriod },
): UsageByPeriod {
	const { period } = options;
	const inPeriod = newPeriodBucket();
	const outOfPeriod = newPeriodBucket();
	const unknownTimestamp = newPeriodBucket();

	for (const node of nodes) {
		const tsMs = parseObservationTimestampMs(node);
		if (tsMs === undefined) {
			absorbIntoPeriodBucket(unknownTimestamp, node);
			continue;
		}
		if (tsMs >= period.startMs && tsMs < period.endMs) {
			absorbIntoPeriodBucket(inPeriod, node);
		} else {
			absorbIntoPeriodBucket(outOfPeriod, node);
		}
	}

	return { period, total: nodes.length, inPeriod, outOfPeriod, unknownTimestamp };
}

/**
 * What a `usage` reading can NEVER answer, regardless of which period was
 * asked for — printed UNCONDITIONALLY (not only when something looks wrong),
 * in both JSON and human output. No `BudgetObservation` field names the
 * operator's actual billing anchor date (the rolling-vs-calendar choice above
 * approximates it, it does not read it), and none names his plan's quota
 * ceiling — that number lives with the subscription vendor, not on this
 * record. A command that prints a usage count next to no denominator invites
 * the reader to assume one exists; this says outright that it does not, rather
 * than let the gap be read as "that's the whole limit" by silence.
 */
export const USAGE_CANNOT_ANSWER =
	"This counts requests and tokens in the window; it cannot say how many requests remain. " +
	"No BudgetObservation field records the operator's actual billing anchor date (the period " +
	"above approximates it, it does not read it) or the plan's quota size — refarm does not " +
	"know either today.";

/** Same discipline as `observationsNextAction`/`groupedNextAction`: informational, not
 *  always a literal command. Names whichever fact is actionable — an empty in-period
 *  bucket the reader might otherwise mistake for "nothing has been read", an
 *  unknown-timestamp bucket the reader might otherwise not notice was excluded, or an
 *  in-period `noUsageRecord` count that explains why the in-period token totals above
 *  may read lower than the in-period observation count would suggest. */
function usageNextAction(usage: UsageByPeriod): string | null {
	if (usage.total === 0) return NO_OBSERVATIONS_MESSAGE;
	const notes: string[] = [];
	if (usage.inPeriod.observations === 0) {
		notes.push(`No observations fall inside ${usage.period.label} (--period ${usage.period.spec}).`);
	}
	if (usage.inPeriod.noUsageRecord > 0) {
		notes.push(
			`${usage.inPeriod.noUsageRecord} of ${usage.inPeriod.observations} in-period observation(s) have ` +
				"no UsageRecord at all — their token contribution above is \"nothing recorded,\" not \"nothing " +
				`spent\" — see ${BUDGET_OBSERVATIONS_JSON_COMMAND} for the individual records.`,
		);
	}
	if (usage.unknownTimestamp.observations > 0) {
		notes.push(
			`${usage.unknownTimestamp.observations} of ${usage.total} observation(s) have no usable ` +
				"timestamp_ns and are excluded from both in- and out-of-period counts — see " +
				`${BUDGET_OBSERVATIONS_JSON_COMMAND} for the individual records.`,
		);
	}
	return notes.length > 0 ? notes.join(" ") : null;
}

/** Exported for `budget.test.ts` — drives the report with a literal `UsageByPeriod`, no
 *  network, same pattern as `printGroupedObservationsHuman`. Takes `page` for the same
 *  reason `printGroupedObservationsHuman` does (Task 1 review, Critical 3): this command
 *  never wired the truncation/completeness signal into its human output at all until
 *  now — `--json` always carried `stored`/`truncated`, the human reader never saw
 *  either, and a record past a single page's cap looked complete over partial data. */
export function printUsageByPeriodHuman(
	usage: UsageByPeriod,
	page: Pick<BudgetObservationsPage, "stored" | "truncated" | "offset">,
): void {
	console.log(chalk.bold(`\n  Budget usage — ${usage.period.label}  (--period ${usage.period.spec})\n`));
	printPageCompletenessNotice(usage.total, page, "refarm budget usage");
	const printBucket = (label: string, bucket: PeriodBucket): void => {
		const flagsText = bucket.noUsageRecord > 0 ? `   (no-usage-record:${bucket.noUsageRecord})` : "";
		console.log(
			`  ${label.padEnd(16)} obs:${String(bucket.observations).padEnd(5)} ` +
				`in:${String(bucket.tokens.input).padEnd(8)} out:${String(bucket.tokens.output).padEnd(8)}${flagsText}`,
		);
	};
	if (usage.total === 0) {
		console.log(chalk.dim(`  ${usageNextAction(usage) ?? ""}`));
	} else {
		printBucket("in period", usage.inPeriod);
		printBucket("out of period", usage.outOfPeriod);
		printBucket("no timestamp", usage.unknownTimestamp);
		const note = usageNextAction(usage);
		if (note) console.log(chalk.dim(`\n  ${note}`));
	}
	// Printed unconditionally, empty record or not — see USAGE_CANNOT_ANSWER's doc for why
	// this must never depend on whether anything else looked wrong first.
	console.log(chalk.yellow(`\n  ⚠  ${USAGE_CANNOT_ANSWER}\n`));
	console.log(chalk.dim(`  ${BUDGET_OBSERVATIONS_JSON_COMMAND}\n`));
}

interface BudgetObservationsCommandOptions {
	limit: number;
	offset: number;
	currentRateTable?: string;
	json?: boolean;
}

export function createBudgetCommand(): Command {
	const command = new Command("budget").description(
		"Inspect the durable BudgetObservation record every terminal effort leaves",
	);

	command
		.command("observations")
		.description("List BudgetObservation nodes and summarise which ceiling cut what")
		.option("-n, --limit <n>", "Max observations to read", parseLimitOption, DEFAULT_LIMIT)
		.option(
			"--offset <n>",
			"Skip this many records — the way past the single-page cap (ISS-042)",
			parseOffsetOption,
			0,
		)
		.option(
			"--current-rate-table <version>",
			"Compare each observation's stamp against this rate table version to count stale pricing " +
				"(omit to auto-derive it from the newest observation's own stamp — F7)",
		)
		.option("--json", "Output machine-readable JSON")
		.action(async (options: BudgetObservationsCommandOptions) => {
			let page: BudgetObservationsPage;
			try {
				page = await fetchBudgetObservations(options.limit, options.offset);
			} catch (err) {
				reportSidecarError(err, {
					json: options.json,
					command: "budget",
					operation: "observations",
				});
				return;
			}
			const { observations, stored, truncated } = page;
			// An explicit --current-rate-table still wins (e.g. checking against a
			// version not yet seen in any observation); omitted, it is derived from
			// the newest observation read back rather than left undetermined.
			const currentRateTable = options.currentRateTable ?? currentRateTableFrom(observations);
			const summary = summariseObservations(observations, currentRateTable);
			const nextAction = observationsNextAction(summary);
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "budget",
						operation: "observations",
						extra: {
							observations,
							summary,
							// Carried through verbatim from the sidecar — see
							// `BudgetObservationsPage`'s doc for why these are not folded
							// into `summary`. When the sidecar didn't report them, both are
							// `undefined` here, and `JSON.stringify` (via `printJson`) drops
							// an `undefined`-valued key entirely — absent means absent on
							// the wire too, never an invented `false`/count.
							stored,
							truncated,
							offset: page.offset,
							// The VERDICT, beside the sums it qualifies. `summary` totals a page that
							// may have been cut, and a consumer reading `summary.total` to decide
							// "under budget" needs to know which of the three states produced it —
							// ISS-039's visible half. Derived, never stored: one function decides.
							completeness: readCompleteness({ truncated }),
						},
						nextAction,
					}),
				);
				return;
			}
			printObservationsHuman(observations, summary, { stored, truncated, offset: page.offset });
		});

	command.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm budget observations",
			"  $ refarm budget observations --json",
			"  $ refarm budget observations --limit 50 --json",
			"  $ refarm budget observations --current-rate-table <version> --json  (optional — see below)",
			"",
			"Notes:",
			"  A BudgetObservation is written for every terminal effort — this command only reads it.",
			"  Each --json observation carries refarm.outcome, refarm.budget.bound_by, and the",
			"  flattened gen_ai.usage.* / refarm.cost.* fields, per the Task 10 record shape.",
			"  host.name / host.id (OTel's resource vocabulary) name which node ran it — a declared,",
			"  mutable name and an opaque, per-installation id; either may be absent on a node that",
			"  has not declared a name, or on a record written before node identity shipped.",
			"  refarm dispatch --budget-deadline-ms / --budget-max-tokens / --budget-max-usd declares a",
			"  budget; omit them and the record fills from whichever level (node/workspace/declared/",
			"  default) resolved for the run instead.",
			"  --current-rate-table is auto-derived from the newest observation's own stamp when",
			"  omitted; pass it explicitly only to check staleness against a version not yet observed.",
		].join("\n"),
	);

	const GROUP_SUBCOMMANDS: ReadonlyArray<{ name: string; by: GroupByAxis; describes: string }> = [
		{ name: "by-workspace", by: "workspace", describes: "workspace (refarm.workspace.id)" },
		{ name: "by-host", by: "host", describes: "node (host.id)" },
		{ name: "by-spawner", by: "spawner", describes: "spawner (refarm.budget.spawner)" },
	];
	for (const { name, by, describes } of GROUP_SUBCOMMANDS) {
		command
			.command(name)
			.description(`Group BudgetObservation nodes by ${describes} and summarise cost per group`)
			.option("-n, --limit <n>", "Max observations to read", parseLimitOption, DEFAULT_LIMIT)
			.option(
				"--offset <n>",
				"Skip this many records — the way past the single-page cap (ISS-042)",
				parseOffsetOption,
				0,
			)
			.option("--json", "Output machine-readable JSON")
			.action(async (options: { limit: number; offset: number; json?: boolean }) => {
				let page: BudgetObservationsPage;
				try {
					page = await fetchBudgetObservations(options.limit, options.offset);
				} catch (err) {
					reportSidecarError(err, { json: options.json, command: "budget", operation: name });
					return;
				}
				const grouped = groupObservations(page.observations, { by });
				const nextAction = groupedNextAction(grouped);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "budget",
							operation: name,
							extra: {
								grouped,
								// Same pass-through discipline as `observations` — absent means
								// absent, never defaulted (`BudgetObservationsPage`'s doc).
								stored: page.stored,
								truncated: page.truncated,
								offset: page.offset,
								completeness: readCompleteness(page),
							},
							nextAction,
							// Read-only drill-down into the individual records this group
							// summarised — offered only when there is something the summary
							// itself cannot show (an unattributed member to go inspect).
							nextCommand:
								grouped.unattributed.observations > 0
									? BUDGET_OBSERVATIONS_JSON_COMMAND
									: undefined,
						}),
					);
					return;
				}
				printGroupedObservationsHuman(grouped, { stored: page.stored, truncated: page.truncated, offset: page.offset });
			});
	}

	command.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm budget by-workspace --json",
			"  $ refarm budget by-host --json",
			"  $ refarm budget by-spawner --json",
			"",
			"Notes:",
			"  Each group reports observation count, gen_ai.usage.* token totals, and a dollar total",
			"  that is null (rendered as — in human output) rather than 0 when every member of that",
			"  group is subscription-priced (refarm.pricing_mode === \"subscription\") — dollars are",
			"  honestly inapplicable there, not honestly zero.",
			"  Records with no value for the grouping key land in their own (unattributed) bucket —",
			"  never folded into a group total and never dropped from the count.",
		].join("\n"),
	);

	command
		.command("usage")
		.description(
			"Bucket BudgetObservation nodes into a request-per-period window — the subscription " +
				"quota axis, not the dollar axis",
		)
		.option("-n, --limit <n>", "Max observations to read", parseLimitOption, DEFAULT_LIMIT)
		.option(
			"--offset <n>",
			"Skip this many records — the way past the single-page cap (ISS-042)",
			parseOffsetOption,
			0,
		)
		.option(
			"--period <spec>",
			`Period to bucket by: "<N>d" for a rolling N-day window ending now (default ` +
				`"${DEFAULT_PERIOD_SPEC}"), "month" for the current UTC calendar month, or "YYYY-MM" ` +
				"for a specific calendar month",
			parsePeriodOption,
			DEFAULT_PERIOD_SPEC,
		)
		.option("--json", "Output machine-readable JSON")
		.action(async (options: { limit: number; offset: number; period: string; json?: boolean }) => {
			let page: BudgetObservationsPage;
			try {
				page = await fetchBudgetObservations(options.limit, options.offset);
			} catch (err) {
				reportSidecarError(err, { json: options.json, command: "budget", operation: "usage" });
				return;
			}
			// Resolved against a real Date.now() here, at action time — parsePeriodOption above
			// already validated the spec's FORMAT at argument-parsing time, a few milliseconds
			// earlier; re-resolving here is immaterial at day granularity and keeps the bounds
			// exactly what "now" meant when the read actually happened.
			const period = parsePeriodSpec(options.period, Date.now());
			const usage = usageByPeriod(page.observations, { period });
			const nextAction = usageNextAction(usage);
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "budget",
						operation: "usage",
						extra: {
							usage,
							// Stated unconditionally on every response, JSON included — see
							// USAGE_CANNOT_ANSWER's doc for why a usage count must never travel
							// without this caveat riding next to it.
							cannotAnswer: USAGE_CANNOT_ANSWER,
							stored: page.stored,
							truncated: page.truncated,
							offset: page.offset,
							completeness: readCompleteness(page),
						},
						nextAction,
						// Read-only drill-down, offered whenever there is a gap the summary itself
						// cannot fully explain: an unusable timestamp, or a member with no
						// UsageRecord at all (in either the in-period or out-of-period bucket).
						nextCommand:
							usage.unknownTimestamp.observations > 0 ||
							usage.inPeriod.noUsageRecord > 0 ||
							usage.outOfPeriod.noUsageRecord > 0
								? BUDGET_OBSERVATIONS_JSON_COMMAND
								: undefined,
					}),
				);
				return;
			}
			printUsageByPeriodHuman(usage, { stored: page.stored, truncated: page.truncated, offset: page.offset });
		});

	command.addHelpText(
		"after",
		[
			"",
			"Examples:",
			`  $ refarm budget usage --json                    (default: ${DEFAULT_PERIOD_SPEC}, rolling)`,
			"  $ refarm budget usage --period 1d --json         (rolling 1-day window)",
			"  $ refarm budget usage --period month --json      (current calendar month, UTC)",
			"  $ refarm budget usage --period 2026-08 --json    (a specific calendar month)",
			"",
			"Notes:",
			"  Requests refill on a billing DATE, which no BudgetObservation field records — so the",
			"  default here is a rolling window (usage in the last N days), not a calendar month: a",
			"  calendar month silently assumes the billing anchor is the 1st, which is true for",
			"  almost no subscription. --period month/YYYY-MM remains available for a reader who DOES",
			"  bill on the calendar boundary.",
			"  Every response also states plainly what it cannot answer: a usage count, never a",
			"  remaining-quota figure — this record has no field for the operator's billing anchor",
			"  date or his plan's quota size.",
			"  A record with no timestamp_ns, or an unparseable one, lands in its own bucket —",
			"  neither dropped from the count nor silently placed in the current period.",
		].join("\n"),
	);

	return command;
}

export const budgetCommand = createBudgetCommand();
