#!/usr/bin/env node
/**
 * THE PROMOTION GATE: `pnpm audit --audit-level=moderate --prod`, with per-advisory expiry.
 *
 * ISS-088 asked which of four audit scopes must hold before a promotion — the repo ran all four
 * and said nothing about which one counts, so `high --prod` passed while `moderate --prod` did
 * not and neither answer was wrong. The operator ruled on 2026-08-11: **moderate --prod, with a
 * re-check date on every accepted advisory.**
 *
 * The second half is the part that matters. Four advisories fail this scope today and none has a
 * reachable fix, so a bare `--audit-level=moderate --prod` is red on arrival — and a gate red on
 * arrival is one an operator learns to bypass. The two mechanisms this replaces both solved that
 * by accepting things forever, and both went stale unnoticed:
 *
 *   the postcss PIN was written against a boundary that later moved (ISS-086)
 *   `ignoreGhsas` accepted a CRITICAL on grounds its own comment said were unverified (ISS-087)
 *
 * A justification with no expiry stops being verified the moment it is written. Every entry in
 * `accepted-advisories.mjs` carries a date, and this gate fails when one passes.
 *
 * FOUR WAYS TO FAIL, and only the first is what a security gate usually has:
 *
 *   UNACCEPTED  a reported advisory nobody wrote down. The ordinary finding.
 *   EXPIRED     an accepted one whose re-check date has passed. The whole point.
 *   STALE       an accepted one that is no longer reported — the exception outlived its advisory
 *               and must go, the same self-expiry the brand guard's allowlist enforces.
 *   HIDDEN      the severity counts do not reconcile. `pnpm audit` COUNTS an `ignoreGhsas`
 *               advisory in `metadata.vulnerabilities` and OMITS it from `advisories`, which is
 *               why `--audit-level=high` exits 0 while printing `critical: 1` in the same JSON.
 *               This gate adds the declared `suppressed` entries back and fails on any surplus,
 *               so a silenced advisory nobody declared is as loud as a new one.
 *
 * Usage: `pnpm run security:gate` (also `--json`).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ACCEPTED_ADVISORIES, classifyAcceptance, judgeAudit } from "./accepted-advisories.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** PURE. `pnpm audit --json` prints progress before its JSON, so the payload starts at the first
 *  brace — parsing the whole stream fails on a machine that logs and passes on one that does not,
 *  which is a difference nobody should have to know about. */
export function parseAuditJson(raw) {
	const start = raw.indexOf("{");
	if (start === -1) throw new Error("pnpm audit produced no JSON payload");
	const payload = JSON.parse(raw.slice(start));
	const advisories = Object.values(payload.advisories ?? {}).map((advisory) => ({
		ghsa: advisory.github_advisory_id ?? advisory.id ?? "(no id)",
		package: advisory.module_name ?? "(unknown)",
		severity: advisory.severity ?? "unknown",
		vulnerable: advisory.vulnerable_versions ?? "",
		patched: advisory.patched_versions ?? "",
	}));
	return { advisories, metadata: payload.metadata?.vulnerabilities ?? {} };
}

/** Today, as the YYYY-MM-DD the dates in `accepted-advisories.mjs` are written in. Injectable so
 *  the expiry logic is testable without waiting two months. */
function today(now = new Date()) {
	return now.toISOString().slice(0, 10);
}

function runAudit() {
	const result = spawnSync("pnpm", ["audit", "--audit-level=moderate", "--prod", "--json"], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		timeout: 300_000,
	});
	// A non-zero exit is EXPECTED — it is what `pnpm audit` does when it finds anything at this
	// level, and this gate's whole job is to decide whether those findings are accepted. Only an
	// absent payload is a failure to run.
	return parseAuditJson(`${result.stdout ?? ""}${result.stderr ?? ""}`);
}

function main() {
	const asJson = process.argv.includes("--json");
	const { advisories, metadata } = runAudit();
	const now = today();
	const verdict = judgeAudit({ reported: advisories, metadata, today: now });

	if (asJson) {
		process.stdout.write(`${JSON.stringify({ ok: verdict.ok, today: now, ...verdict }, null, 2)}\n`);
		if (!verdict.ok) process.exitCode = 1;
		return;
	}

	const soonest = [...ACCEPTED_ADVISORIES].sort((a, b) => a.recheckBy.localeCompare(b.recheckBy))[0];
	process.stdout.write(
		`security gate: pnpm audit --audit-level=moderate --prod (ISS-088)\n` +
			`  reported:   ${advisories.length}\n` +
			`  accepted:   ${ACCEPTED_ADVISORIES.filter((e) => classifyAcceptance(e, now) === "accepted").length}` +
			` / ${ACCEPTED_ADVISORIES.length} declared` +
			`${soonest ? `, next re-check ${soonest.recheckBy} (${soonest.ghsa})` : ""}\n` +
			`  counts:     ${JSON.stringify(metadata)}\n`,
	);

	for (const [label, rows, explain] of [
		[
			"UNACCEPTED",
			verdict.unaccepted.map((a) => `${a.severity} ${a.package} ${a.ghsa} -> ${a.patched}`),
			"reported and undeclared. Fix it, or add an entry with a reason and a re-check date.",
		],
		[
			"EXPIRED",
			verdict.expired.map((e) => `${e.ghsa} (${e.package}) accepted until ${e.recheckBy} — ${e.trigger}`),
			"the acceptance stopped being verified. Re-check the TRIGGER, then renew the date or fix it.",
		],
		[
			"STALE",
			verdict.stale.map((e) => `${e.ghsa} (${e.package}) is no longer reported`),
			"the exception outlived its advisory. Remove the entry.",
		],
		[
			"HIDDEN",
			verdict.hidden.map((h) => `${h.severity}: metadata counts ${h.counted}, declared ${h.accountedFor}`),
			"something is suppressed that nobody declared. Add it as a `suppressed` entry or stop ignoring it.",
		],
	]) {
		if (rows.length === 0) continue;
		process.stdout.write(`\n${label} — ${explain}\n${rows.map((row) => `  ${row}`).join("\n")}\n`);
	}

	if (!verdict.ok) process.exitCode = 1;
	else process.stdout.write("\n  ok — every reported advisory is declared, and no date has passed.\n");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
