#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
};

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function collectPhaseNumbers() {
	const phasesDir = ".project/phases";
	if (!existsSync(phasesDir)) return new Set();

	const values = new Set();
	const files = readdirSync(phasesDir).filter((name) => name.endsWith(".json"));
	for (const file of files) {
		const phase = readJson(join(phasesDir, file));
		if (typeof phase.number === "number") {
			values.add(String(phase.number));
		}
		if (typeof phase.number === "string") {
			values.add(phase.number);
		}
	}
	return values;
}

function ensureUniqueIds(items, label, errors) {
	const seen = new Set();
	for (const item of items) {
		if (!item || typeof item.id !== "string" || item.id.trim() === "") {
			errors.push(`[${label}] entry with missing/invalid id`);
			continue;
		}

		if (seen.has(item.id)) {
			errors.push(`[${label}] duplicate id: ${item.id}`);
			continue;
		}

		seen.add(item.id);
	}
}

const CITATION = /\bISS-\d+\b/g;

// External anchor #1 (deterministic — feeds `errors`): every handoff entry must cite a work
// item that actually exists in the ledger, and every issue must carry the fields its status
// demands. Pure and filesystem-free so it is testable without touching disk. Deliberately does
// NOT require the reverse (every open issue appearing in the handoff) — with 54 open items that
// would force the handoff back into the bloat this migration exists to end.
export function checkHandoffCitations(handoff, issues) {
	const errors = [];
	const ids = new Set(issues.map((issue) => issue.id));
	const entries = [
		...asArray(handoff.next_actions).map((text) => ["next_actions", text]),
		...asArray(handoff.blockers).map((text) => ["blockers", text]),
	];

	for (const [field, text] of entries) {
		const cited = String(text).match(CITATION) ?? [];
		if (cited.length === 0) {
			errors.push(`[handoff] ${field} entry cites no work item: ${String(text).slice(0, 60)}…`);
			continue;
		}
		for (const id of cited) {
			if (!ids.has(id)) errors.push(`[handoff] cites unknown work item: ${id}`);
		}
	}

	for (const issue of issues) {
		if (issue.status === "open" && !issue.axis) {
			errors.push(`[issues] ${issue.id} is open with no axis`);
		}
		// Sole owner of the "resolved with no resolved_by" message. main()'s issue loop has its
		// own resolved_by check too (the VER- verification cross-reference), but that one only
		// fires once resolved_by is non-empty — so a missing resolved_by is reported exactly
		// once, here, never twice for the same root cause.
		if (issue.status === "resolved" && !issue.resolved_by) {
			errors.push(`[issues] ${issue.id} is resolved with no resolved_by`);
		}
	}

	return { errors };
}

// External anchor #3 (deterministic — feeds `errors`): an item MAY serve an operator requirement,
// and if it names one, that requirement must exist. Deliberately does NOT require an item to name
// one: the field is optional by the operator's decision, because several open items are pure hygiene
// and "serves no requirement" is a real answer rather than missing data. Blocks rather than warns
// under the rule this gate already follows — a citation of a non-existent id is verifiable, and the
// agent fixes it with one command (`issues set-requirement`, or `--clear`).
export function checkRequirementCitations(requirements, issues) {
	const errors = [];
	const ids = new Set(requirements.map((entry) => entry?.id).filter(Boolean));
	for (const issue of issues) {
		if (!issue?.requirement) continue;
		if (!ids.has(issue.requirement)) {
			errors.push(`[issues] ${issue.id} serves unknown requirement: ${issue.requirement}`);
		}
	}
	return { errors };
}

// External anchor #4 (deterministic — feeds `errors`): `docs/OPERATOR_REQUIREMENTS.md` is an INDEX
// over this record, which means a requirement's title and maturity are written in two places. An
// index free to drift from its record is the two-records defect ISS-089 named, rebuilt in miniature
// — so drift BLOCKS, and the fix is one table row. Only `R*` ids are indexed; the May-era REQ-
// cohort was never claimed by the table.
//
// The index is the ONLY file outside `.project/` this gate reads, which is the honest cost of
// keeping a readable document in front of the record. An unreadable index WARNS rather than errors:
// "I could not check" is not "they agree", and it is not the agent's to fix either.
export function checkRequirementIndex(markdown, requirements) {
	if (markdown === null) {
		return { errors: [], warnings: ["[requirements] the docs index could not be read — drift unchecked, not clean"] };
	}
	const errors = [];
	const rows = new Map(
		markdown
			.split("\n")
			.map((line) => /^\| (R\d+) \| (.+?) \| ([a-z-]+) \|$/.exec(line.trim()))
			.filter(Boolean)
			.map(([, id, title, maturity]) => [id, { title, maturity }]),
	);
	for (const requirement of requirements) {
		if (!/^R\d+$/.test(requirement?.id ?? "")) continue;
		const row = rows.get(requirement.id);
		if (!row) {
			errors.push(`[requirements] ${requirement.id} has no row in the docs index`);
			continue;
		}
		if (row.title !== requirement.title || row.maturity !== requirement.maturity) {
			errors.push(
				`[requirements] ${requirement.id} index row (${row.title} · ${row.maturity}) disagrees with the record (${requirement.title} · ${requirement.maturity})`,
			);
		}
	}
	return { errors, warnings: [] };
}

// The age past which an open item is reported as unreviewed. A DECLARED POLICY, and said so
// rather than dressed as a measurement — but derived from one: on 2026-08-25 the 23 open items had
// a MEDIAN age of 6.8 days, so twice that names the genuine tail (3 items, oldest 16.7 days)
// instead of normal circulation. Raising it hides the tail; lowering it toward the median turns
// the ledger's healthy churn into a warning, which is the exact defect this constant replaced.
export const UNREVIEWED_AFTER_DAYS = 14;

// External anchor #2 (heuristic — feeds `warnings`, never `errors`): the ledger can be
// internally perfect and still be stale. Staleness is a judgement call, not a verifiable defect
// an agent can always remediate in one command, so it warns rather than blocks — blocking here
// would deadlock the agent loop and create an incentive to bypass the gate. Three states, never
// two: `null` means git could not be read (shallow clone, no `.git`) and reports "unknown",
// never "fresh".
//
// PER ITEM, NOT PER FILE — and the file-level version this replaced was wrong in BOTH directions,
// measured on 2026-08-25 before it was changed:
//
//   UNDER-REPORTED. It asked "how many commits since .project/issues.json changed", and that file
//   is touched most sessions. So it answered FRESH while 9 of 23 open items had not themselves
//   changed in over a week, the oldest a `high` at 16.7 days. A ledger where one item is edited
//   daily and another has rotted since 2026-08-17 is not a fresh ledger, and ISS-131 — found
//   false that day, its evidence 8 days old — was in exactly that tail.
//
//   OVER-REPORTED. Its threshold was `> 0`, so it fired whenever the newest commit was not a
//   ledger commit: 52 of the last 80 commits, 65%, with a maximum real distance of 7. A gate that
//   speaks on two runs in three is not read, which is the same finding 7b35d843 recorded for the
//   moderate security audit.
//
// It names the OLDEST rather than listing all of them: a warning long enough to scroll is one
// nobody finishes, and the oldest is the one an operator can act on first.
export function checkLedgerFreshness({ itemAgeDays }) {
	if (itemAgeDays === null) {
		return { errors: [], warnings: ["[ledger] freshness unknown — git history unreadable"] };
	}
	const unreviewed = [...itemAgeDays.entries()]
		.filter(([, days]) => days > UNREVIEWED_AFTER_DAYS)
		.sort((a, b) => b[1] - a[1]);
	if (unreviewed.length === 0) return { errors: [], warnings: [] };
	const [oldestId, oldestDays] = unreviewed[0];
	return {
		errors: [],
		warnings: [
			`[ledger] ${unreviewed.length} open item(s) unreviewed for over ${UNREVIEWED_AFTER_DAYS} days ` +
				`(oldest ${oldestId}, ${oldestDays.toFixed(1)}d) — re-measure before acting on them`,
		],
	};
}

// Pure: a stable digest of ONE work item, used to decide the revision at which it last changed.
// Over the WHOLE item rather than the body alone, because a status, an axis or a resolved_by is a
// review too — the question this answers is "when did anyone last look at this", not "when did the
// prose move". Key order is normalised so a writer that reorders fields is not read as a change.
export function itemDigest(item) {
	const ordered = {};
	for (const key of Object.keys(item).sort()) ordered[key] = item[key];
	return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

// Pure: given the ledger AS IT WAS at each revision, oldest first, when did each id last change?
// Split from the git call for the same reason every other check in this file is — the walk is the
// part with the logic, and it is provable without a checkout.
//
// AN ITEM'S FIRST APPEARANCE COUNTS AS A CHANGE, so a freshly filed item is fresh rather than
// ageless. An item that vanishes keeps its last known change and simply stops being asked about,
// since only OPEN ids are scored.
export function lastChangeByItem(revisions) {
	const lastChange = new Map();
	let previous = new Map();
	for (const { timestampMs, issues } of revisions) {
		const current = new Map();
		for (const item of issues) {
			const digest = itemDigest(item);
			current.set(item.id, digest);
			if (previous.get(item.id) !== digest) lastChange.set(item.id, timestampMs);
		}
		previous = current;
	}
	return lastChange;
}

// Pure: the age in days of each OPEN item, from the last-change map and a clock. Items the walk
// never saw are OMITTED rather than given an age — an id with no history is unknown, and scoring
// it as 0 would report the one thing nobody measured as the freshest thing in the ledger.
export function openItemAgeDays({ issues, lastChange, nowMs }) {
	const ages = new Map();
	for (const item of issues) {
		if (item.status !== "open") continue;
		const changedAt = lastChange.get(item.id);
		if (changedAt === undefined) continue;
		ages.set(item.id, (nowMs - changedAt) / 86_400_000);
	}
	return ages;
}

// The git anchor itself — lives outside the pure functions above so they stay testable without
// a filesystem or a git checkout. Returns null (UNKNOWN) rather than an empty map on any failure;
// a shallow clone is not a fresh ledger.
//
// COST, measured 2026-08-25 on the real history: 166 revisions, `git log` 0.03s and the `git show`
// walk ~1.1s. Paid once per gate run, which is where it belongs — this is CI's question.
function readOpenItemAgeDays(issues) {
	try {
		const log = execFileSync(
			"git",
			["log", "--format=%H %ct", "--", ".project/issues.json"],
			{ encoding: "utf8" },
		).trim();
		if (!log) return null;
		const revisions = [];
		// Oldest first: `lastChange` overwrites as it walks forward, so the final write per id is
		// the most recent revision that changed it.
		for (const line of log.split("\n").reverse()) {
			const [sha, seconds] = line.split(" ");
			if (!sha || !seconds) continue;
			let parsed;
			try {
				parsed = JSON.parse(
					execFileSync("git", ["show", `${sha}:.project/issues.json`], {
						encoding: "utf8",
						maxBuffer: 64 * 1024 * 1024,
					}),
				);
			} catch {
				// A revision where the file was unreadable (a rename, a bad merge) is SKIPPED, not
				// treated as an empty ledger — the latter would mark every item as changed there.
				continue;
			}
			if (!Array.isArray(parsed?.issues)) continue;
			revisions.push({ timestampMs: Number(seconds) * 1000, issues: parsed.issues });
		}
		if (revisions.length === 0) return null;
		return openItemAgeDays({
			issues,
			lastChange: lastChangeByItem(revisions),
			nowMs: Date.now(),
		});
	} catch {
		return null; // UNKNOWN, never fresh — a shallow clone is not a fresh ledger.
	}
}

function main() {
	const requiredFiles = [
		".project/requirements.json",
		".project/tasks.json",
		".project/verification.json",
		".project/issues.json",
		".project/handoff.json",
	];

	for (const path of requiredFiles) {
		if (!existsSync(path)) {
			console.error(
				`${colors.red}✗ missing required file:${colors.reset} ${path}`,
			);
			process.exit(1);
		}
	}

	const requirements = asArray(
		readJson(".project/requirements.json").requirements,
	);
	const tasks = asArray(readJson(".project/tasks.json").tasks);
	const verifications = asArray(
		readJson(".project/verification.json").verifications,
	);
	const issues = asArray(readJson(".project/issues.json").issues);
	const handoff = readJson(".project/handoff.json");

	const requirementIds = new Set(requirements.map((r) => r.id).filter(Boolean));
	const taskIds = new Set(tasks.map((t) => t.id).filter(Boolean));
	const verificationIds = new Set(
		verifications.map((v) => v.id).filter(Boolean),
	);
	const phaseNumbers = collectPhaseNumbers();

	const errors = [];
	const warnings = [];

	ensureUniqueIds(requirements, "requirements", errors);
	ensureUniqueIds(tasks, "tasks", errors);
	ensureUniqueIds(verifications, "verification", errors);
	ensureUniqueIds(issues, "issues", errors);

	for (const req of requirements) {
		for (const ref of asArray(req.traces_to)) {
			if (!taskIds.has(ref) && !phaseNumbers.has(String(ref))) {
				errors.push(`[requirements] ${req.id} traces_to missing ref: ${ref}`);
			}
		}

		for (const dep of asArray(req.depends_on)) {
			if (!requirementIds.has(dep)) {
				errors.push(
					`[requirements] ${req.id} depends_on missing requirement: ${dep}`,
				);
			}
		}
	}

	for (const task of tasks) {
		for (const dep of asArray(task.depends_on)) {
			if (!taskIds.has(dep)) {
				errors.push(`[tasks] ${task.id} depends_on missing task: ${dep}`);
			}
		}

		if (
			typeof task.verification === "string" &&
			task.verification.trim() !== "" &&
			!verificationIds.has(task.verification)
		) {
			errors.push(
				`[tasks] ${task.id} references missing verification: ${task.verification}`,
			);
		}

		if (task.status === "completed") {
			if (!task.verification) {
				errors.push(`[tasks] ${task.id} is completed but has no verification`);
			} else {
				const verification = verifications.find(
					(entry) => entry.id === task.verification,
				);
				if (!verification) {
					errors.push(
						`[tasks] ${task.id} completed with unknown verification: ${task.verification}`,
					);
				} else {
					if (verification.target_type !== "task") {
						errors.push(
							`[tasks] ${task.id} verification ${task.verification} must target_type=task`,
						);
					}
					if (verification.target !== task.id) {
						errors.push(
							`[tasks] ${task.id} verification ${task.verification} targets ${verification.target}`,
						);
					}
					if (verification.status !== "passed") {
						warnings.push(
							`[tasks] ${task.id} completed with verification ${task.verification} status=${verification.status}`,
						);
					}
				}
			}
		}
	}

	for (const verification of verifications) {
		if (!verification || typeof verification.id !== "string") continue;

		switch (verification.target_type) {
			case "task":
				if (!taskIds.has(verification.target)) {
					errors.push(
						`[verification] ${verification.id} target task missing: ${verification.target}`,
					);
				}
				break;
			case "requirement":
				if (!requirementIds.has(verification.target)) {
					errors.push(
						`[verification] ${verification.id} target requirement missing: ${verification.target}`,
					);
				}
				break;
			case "phase":
				if (!phaseNumbers.has(String(verification.target))) {
					errors.push(
						`[verification] ${verification.id} target phase missing: ${verification.target}`,
					);
				}
				break;
			default:
				errors.push(
					`[verification] ${verification.id} has unknown target_type: ${verification.target_type}`,
				);
		}
	}

	// The "resolved with no resolved_by" case is NOT checked here — checkHandoffCitations owns
	// that message (see its comment) so it is reported exactly once, not once per check. This
	// loop keeps only its other responsibility: cross-referencing a VER- resolved_by against the
	// verification block, which needs a non-empty resolved_by to even evaluate.
	for (const issue of issues) {
		if (!issue || typeof issue.id !== "string") continue;

		if (
			issue.status === "resolved" &&
			issue.resolved_by &&
			String(issue.resolved_by).trim() !== "" &&
			String(issue.resolved_by).startsWith("VER-") &&
			!verificationIds.has(issue.resolved_by)
		) {
			errors.push(
				`[issues] ${issue.id} resolved_by references missing verification: ${issue.resolved_by}`,
			);
		}
	}

	const citations = checkHandoffCitations(handoff, issues);
	errors.push(...citations.errors);

	const requirementCitations = checkRequirementCitations(requirements, issues);
	errors.push(...requirementCitations.errors);

	const indexPath = "docs/OPERATOR_REQUIREMENTS.md";
	const indexMarkdown = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
	const requirementIndex = checkRequirementIndex(indexMarkdown, requirements);
	errors.push(...requirementIndex.errors);
	warnings.push(...requirementIndex.warnings);

	const freshness = checkLedgerFreshness({ itemAgeDays: readOpenItemAgeDays(issues) });
	errors.push(...freshness.errors);
	warnings.push(...freshness.warnings);

	// Errors are never silenced. Warnings are noise once a caller has already opted into a quiet
	// aggregated gate (`gate:full:colony` runs this with `--silent`) — respected the same way for
	// every warning in this file, old and new alike.
	const silent = process.argv.includes("--silent");

	if (errors.length > 0) {
		console.error(
			`${colors.red}✗ project block consistency failed${colors.reset}`,
		);
		for (const message of errors) {
			console.error(`  - ${message}`);
		}
		if (warnings.length > 0 && !silent) {
			console.error(`${colors.yellow}Warnings:${colors.reset}`);
			for (const message of warnings) {
				console.error(`  - ${message}`);
			}
		}
		process.exit(1);
	}

	console.log(
		`${colors.green}✓ project block consistency passed${colors.reset}`,
	);
	if (warnings.length > 0 && !silent) {
		console.log(`${colors.yellow}Warnings:${colors.reset}`);
		for (const message of warnings) {
			console.log(`  - ${message}`);
		}
	}
}

// GUARD: `scripts/ci/project-block-consistency.test.mjs` imports this module to unit-test the pure
// functions above (`checkHandoffCitations`, `checkLedgerFreshness`). Without this guard, `main()`
// ran at import time and called `process.exit(1)` the moment cwd was not the repo root (or the
// real ledger had an error) — killing the whole test file, 0 tests run, exactly when the pure
// functions' tests are most needed. Same idiom as `scripts/no-os-resolution.mjs`.
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
