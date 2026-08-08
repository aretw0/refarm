import {
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import { fetchSidecarJson } from "@refarm.dev/sidecar-client";
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
 *  per-record unknown-tracking field (that discipline belongs to `usd`,
 *  `subscriptionMembers`, and `priceUnknown` below, where a whole group's worth
 *  of members can share the same real unknown). */
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
	/** Sum of `refarm.cost.estimated_usd` across members that are NEITHER
	 *  subscription-priced NOR price-unknown. `null` — never `0` — when no member
	 *  qualifies, which covers both "every member is subscription" (the operator's
	 *  live record, 29/29) and the degenerate empty group. A `0` here would claim
	 *  a real, priced, zero-cost run; `null` says the dollar axis does not apply,
	 *  or could not be read, for this group at all (Global Constraints). */
	usd: number | null;
	/** How many members were excluded from `usd` because `refarm.pricing_mode`
	 *  is exactly `"subscription"` — the operator's HONEST zero, not an unpriced
	 *  one. Present (and countable) even when `usd` is a real number, so a mixed
	 *  group's partial sum is legible as partial rather than looking complete. */
	subscriptionMembers: number;
	/** How many NON-subscription members were excluded from `usd` because
	 *  `refarm.cost.price_known === false` (F5's genuine "no rate on file") —
	 *  `summariseObservations`' own `priceUnknown` field, applied per group rather
	 *  than parallelled. Distinct from `subscriptionMembers`: this member's cost
	 *  is not honestly zero, it is UNKNOWN. */
	priceUnknown: number;
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
	 *  understate every workspace by that same 21. */
	unattributed: GroupTotals;
}

interface MutableGroupBucket {
	observations: number;
	tokens: GroupTokenTotals;
	usdSum: number;
	/** At least one member contributed a real, known-priced dollar figure to
	 *  `usdSum`. Distinguishes "usd is a real 0.0" from "usd does not apply" —
	 *  the same distinction `usd: number | null` makes at the type level. */
	hasBillableMember: boolean;
	subscriptionMembers: number;
	priceUnknown: number;
	label: string | null;
}

function newGroupBucket(): MutableGroupBucket {
	return {
		observations: 0,
		tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0 },
		usdSum: 0,
		hasBillableMember: false,
		subscriptionMembers: 0,
		priceUnknown: 0,
		label: null,
	};
}

function numericField(node: ObservationNode, field: string): number {
	const raw = node[field];
	return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function absorbIntoGroupBucket(bucket: MutableGroupBucket, node: ObservationNode, by: GroupByAxis): void {
	bucket.observations += 1;
	bucket.tokens.input += numericField(node, "gen_ai.usage.input_tokens");
	bucket.tokens.output += numericField(node, "gen_ai.usage.output_tokens");
	bucket.tokens.cacheCreation += numericField(node, "gen_ai.usage.cache_creation.input_tokens");
	bucket.tokens.cacheRead += numericField(node, "gen_ai.usage.cache_read.input_tokens");
	bucket.tokens.reasoning += numericField(node, "gen_ai.usage.reasoning.output_tokens");

	if (by === "host") {
		// Same "keep the newest non-null name seen" rule as `summariseObservations`'
		// `nodesRepresented` — host.name is read live and documented mutable.
		const rawName = node["host.name"];
		const name = typeof rawName === "string" && rawName.length > 0 ? rawName : null;
		if (name !== null) bucket.label = name;
	}

	// Subscription is checked FIRST and unconditionally excludes: a member can carry
	// both `refarm.pricing_mode: "subscription"` and `price_known: false` at once (the
	// live record's own shape), and it must count once, as the honest-zero case, not
	// twice or as the unpriced case.
	if (node["refarm.pricing_mode"] === "subscription") {
		bucket.subscriptionMembers += 1;
		return;
	}
	if (node["refarm.cost.price_known"] === false) {
		bucket.priceUnknown += 1;
		return;
	}
	bucket.usdSum += numericField(node, "refarm.cost.estimated_usd");
	bucket.hasBillableMember = true;
}

function finalizeGroupBucket(bucket: MutableGroupBucket): GroupTotals {
	return {
		observations: bucket.observations,
		tokens: bucket.tokens,
		usd: bucket.hasBillableMember ? bucket.usdSum : null,
		subscriptionMembers: bucket.subscriptionMembers,
		priceUnknown: bucket.priceUnknown,
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
}): BudgetObservationsPage {
	const observations = Array.isArray(body.nodes) ? (body.nodes as ObservationNode[]) : [];
	return {
		observations,
		// Absent means absent: no fallback to `observations.length` / `false`. See
		// `BudgetObservationsPage`'s doc for why a guess here is worse than saying "unknown".
		stored: typeof body.stored === "number" ? body.stored : undefined,
		truncated: typeof body.truncated === "boolean" ? body.truncated : undefined,
	};
}

async function fetchBudgetObservations(limit: number): Promise<BudgetObservationsPage> {
	const body = await fetchSidecarJson<{ nodes?: unknown[]; stored?: number; truncated?: boolean }>(
		sidecarUrl(
			`/nodes?type=${encodeURIComponent(BUDGET_OBSERVATION_NODE_TYPE)}&limit=${limit}`,
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

/** Exported for `budget.test.ts` — drives the truncation notice with a literal payload,
 *  no network, per the same pattern the rest of this file's pure functions already use. */
export function printObservationsHuman(
	observations: readonly ObservationNode[],
	summary: ObservationSummary,
	page: Pick<BudgetObservationsPage, "stored" | "truncated">,
): void {
	console.log(chalk.bold(`\n  Budget observations  (${summary.total} shown)\n`));
	if (page.truncated === true) {
		// `summary.total` (shown above) and `page.stored` (here) are deliberately printed
		// side by side with different words, not both called "total" — see
		// `BudgetObservationsPage`'s doc for why that collision must not happen.
		//
		// This used to end with "raise --limit to see the rest" — advice that cannot work.
		// The sidecar clamps every `GET /nodes` response at `MAX_NODES_PER_RESPONSE`
		// (`packages/tractor/src/sidecar/mod.rs`) regardless of the requested `--limit`,
		// there is no offset/paging parameter to reach the rows past that cap, and
		// `DEFAULT_LIMIT` above is already 100 — equal to the ceiling. So on a record of
		// more than 100 rows, the very first default run printed an instruction that does
		// nothing. Say what is true instead: this is the newest page a single response can
		// carry, and rows beyond the cap are not reachable through this command today.
		//
		// `page.stored` can be absent even when `truncated` is `true` — Task 2's contract
		// (`BudgetObservationsPage`'s doc above) allows either field to be missing
		// independently, so this must not print "of undefined" when the sidecar reports
		// truncation without also reporting the true count.
		const storedNote = typeof page.stored === "number" ? ` of ${page.stored} stored` : "";
		console.log(
			chalk.yellow(
				`  ⚠  Showing the newest ${summary.total}${storedNote} — this command's response ` +
					`is capped at a single page, so records beyond that cap are not reachable ` +
					"through `refarm budget observations` today.\n",
			),
		);
	} else if (page.truncated === undefined) {
		// This is a gap in what the node could report, not a finding about the record — it
		// may be all of them or it may not, and this cannot tell you which. Same phrasing
		// discipline as `runtime-freshness-doctor.ts`'s `unknown` state: reported plainly,
		// never rounded to "nothing was truncated".
		console.log(
			chalk.dim(
				`  ?  Completeness unknown — this node did not report how many BudgetObservation ` +
					`records exist (an older sidecar build). Whether ${summary.total} shown is all ` +
					`of them cannot be determined from this response.\n`,
			),
		);
	}
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
 *  `GroupedObservations`, no network, same pattern as `printObservationsHuman`. */
export function printGroupedObservationsHuman(grouped: GroupedObservations): void {
	const axis = GROUP_AXIS_LABEL[grouped.by];
	console.log(chalk.bold(`\n  Budget by ${axis}  (${grouped.total} observation(s))\n`));
	if (grouped.total === 0) {
		console.log(chalk.dim(`  ${groupedNextAction(grouped) ?? ""}`));
		return;
	}
	const printRow = (label: string, totals: GroupTotals): void => {
		const flags: string[] = [];
		if (totals.subscriptionMembers > 0) flags.push(`subscription:${totals.subscriptionMembers}`);
		if (totals.priceUnknown > 0) flags.push(`price-unknown:${totals.priceUnknown}`);
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
		const rowLabel =
			grouped.by === "host"
				? `${group.label ?? "(unnamed)"} [${group.key.slice(0, 8)}]`
				: group.key;
		printRow(rowLabel, group);
	}
	// The unattributed row — ALWAYS printed, even at zero, per Global Constraints: its
	// presence at zero is itself informative (this axis is fully attributed), and its
	// absence at any other value would be the exact silent dilution this row exists to
	// prevent.
	printRow("(unattributed)", grouped.unattributed);
	console.log(chalk.dim(`\n  ${BUDGET_OBSERVATIONS_JSON_COMMAND}\n`));
}

interface BudgetObservationsCommandOptions {
	limit: number;
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
			"--current-rate-table <version>",
			"Compare each observation's stamp against this rate table version to count stale pricing " +
				"(omit to auto-derive it from the newest observation's own stamp — F7)",
		)
		.option("--json", "Output machine-readable JSON")
		.action(async (options: BudgetObservationsCommandOptions) => {
			let page: BudgetObservationsPage;
			try {
				page = await fetchBudgetObservations(options.limit);
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
						},
						nextAction,
					}),
				);
				return;
			}
			printObservationsHuman(observations, summary, { stored, truncated });
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
			.option("--json", "Output machine-readable JSON")
			.action(async (options: { limit: number; json?: boolean }) => {
				let page: BudgetObservationsPage;
				try {
					page = await fetchBudgetObservations(options.limit);
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
				printGroupedObservationsHuman(grouped);
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

	return command;
}

export const budgetCommand = createBudgetCommand();
