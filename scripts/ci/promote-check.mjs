#!/usr/bin/env node
/**
 * promote-check — the durable "is it safe to promote develop→main?" rite.
 *
 * A develop→main merge auto-runs exactly one publish-capable workflow (release-changesets.yml).
 * Its `changeset publish` step runs only when the first-publish guard reports `blocked != 'true'`.
 * RELEASE_AUTOMATION is already on and the publish tokens exist, so that guard is the ONLY thing
 * between a merge and a real npm publish. This composes the guard's own functions with a workspace
 * version/changeset scan and (best-effort) the GitHub posture, and prints a verdict so a publish is
 * never accidental.
 *
 * Verdicts:
 *   SAFE          — nothing would publish (guard blocks, or no pending changeset targets a
 *                   published package). Exit 0.
 *   WOULD-PUBLISH — the guard would NOT block and some changeset targets a package already off
 *                   0.1.0; those would publish on the merge. Exit 2 unless --allow-publish
 *                   (a deliberate release), so an unintended publish stops the check.
 *   BLOCKED       — the source is red or the posture is broken; don't promote. Exit 1.
 *
 * Usage:
 *   node scripts/ci/promote-check.mjs [--json] [--selection <id>] [--allow-publish] [--offline]
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	findFirstPublishChangesetRisks,
	findOutOfSelectionBaselineRisks,
	parseChangesets,
	readWorkspacePackageVersions,
} from "./check-first-publish-changesets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ── pure verdict logic (unit-tested) ─────────────────────────────────────────

/**
 * Split pending changesets by what a merge would do with them.
 * @param {{changesets: {packageName: string, bump: string, file: string}[], versions: Map<string,string>}} input
 * @returns {{guarded: object[], wouldPublish: object[], unknown: object[]}}
 */
export function classifyChangesets({ changesets, versions }) {
	const guarded = [];
	const wouldPublish = [];
	const unknown = [];
	for (const entry of changesets) {
		const currentVersion = versions.get(entry.packageName) ?? null;
		const row = { ...entry, currentVersion };
		if (currentVersion === null) unknown.push(row);
		else if (currentVersion === "0.1.0") guarded.push(row);
		else wouldPublish.push(row);
	}
	return { guarded, wouldPublish, unknown };
}

/**
 * Decide the promotion verdict from the deterministic inputs.
 * @param {{blocked: boolean, wouldPublish: object[], sourceGreen: boolean|null, allowPublish: boolean}} input
 * @returns {{verdict: "SAFE"|"WOULD-PUBLISH"|"BLOCKED", ok: boolean, exitCode: number, reasons: string[]}}
 */
export function computeVerdict({ blocked, wouldPublish, sourceGreen, allowPublish }) {
	const reasons = [];

	// A red source branch is never promotable, whatever the publish state.
	if (sourceGreen === false) {
		reasons.push("Source branch (develop) is not green on Test & Quality.");
		return { verdict: "BLOCKED", ok: false, exitCode: 1, reasons };
	}

	// blocked=true skips the ENTIRE changesets step on main — nothing publishes.
	if (blocked) {
		reasons.push(
			"First-publish guard blocks: at least one pending changeset targets a 0.1.0 package, so release-changesets skips publish entirely.",
		);
		return { verdict: "SAFE", ok: true, exitCode: 0, reasons };
	}

	// Guard would not block. Anything targeting an already-published package publishes.
	if (wouldPublish.length > 0) {
		reasons.push(
			`Guard would NOT block and ${wouldPublish.length} changeset(s) target packages already off 0.1.0: ${wouldPublish
				.map((r) => `${r.packageName}@${r.currentVersion}`)
				.join(", ")}. A merge would publish these.`,
		);
		if (allowPublish) {
			reasons.push("--allow-publish set: treating the publish as intended.");
			return { verdict: "WOULD-PUBLISH", ok: true, exitCode: 0, reasons };
		}
		reasons.push("Re-run with --allow-publish if this release is intended; otherwise hold the changesets.");
		return { verdict: "WOULD-PUBLISH", ok: false, exitCode: 2, reasons };
	}

	reasons.push("Guard would not block, but no pending changeset targets a published package — nothing to publish.");
	return { verdict: "SAFE", ok: true, exitCode: 0, reasons };
}

// ── GitHub posture (best-effort, never throws) ───────────────────────────────

function gh(args) {
	try {
		return execFileSync("gh", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return null;
	}
}

function readGithubPosture() {
	const nameWithOwner = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
	if (!nameWithOwner) return { available: false };
	const repo = nameWithOwner;

	const varsRaw = gh(["api", `repos/${repo}/actions/variables`, "--jq", ".variables[] | .name + \"=\" + .value"]);
	const vars = Object.fromEntries(
		(varsRaw ?? "").split("\n").filter(Boolean).map((line) => {
			const i = line.indexOf("=");
			return [line.slice(0, i), line.slice(i + 1)];
		}),
	);

	const secretsRaw = gh(["secret", "list", "--json", "name", "--jq", ".[].name"]) ?? gh(["secret", "list"]);
	const secretNames = (secretsRaw ?? "")
		.split("\n")
		.map((l) => l.split(/\s|\t/)[0])
		.filter(Boolean);

	// Modern rulesets + classic protection; either may carry the required gates.
	const rulesetRules = gh(["api", `repos/${repo}/rulesets?includes_parents=true`, "--jq", ".[].id"]);
	let requiresChecks = false;
	let requiresPr = false;
	let requiredCheckContexts = [];
	for (const id of (rulesetRules ?? "").split("\n").filter(Boolean)) {
		const detail = gh(["api", `repos/${repo}/rulesets/${id}`]);
		if (!detail) continue;
		try {
			const parsed = JSON.parse(detail);
			const targetsDefault = JSON.stringify(parsed.conditions?.ref_name?.include ?? []).includes("DEFAULT_BRANCH")
				|| JSON.stringify(parsed.conditions?.ref_name?.include ?? []).includes("main");
			if (!targetsDefault) continue;
			for (const rule of parsed.rules ?? []) {
				if (rule.type === "pull_request") requiresPr = true;
				if (rule.type === "required_status_checks") {
					requiresChecks = true;
					requiredCheckContexts = (rule.parameters?.required_status_checks ?? []).map((c) => c.context);
				}
			}
		} catch {
			/* ignore a malformed ruleset */
		}
	}

	return {
		available: true,
		repo,
		releaseAutomation: vars.RELEASE_AUTOMATION ?? null,
		releaseOwner: vars.RELEASE_OWNER ?? null,
		npmTokenPresent: secretNames.includes("NPM_TOKEN"),
		cargoTokenPresent: secretNames.includes("CARGO_REGISTRY_TOKEN"),
		mainRequiresPr: requiresPr,
		mainRequiresChecks: requiresChecks,
		mainRequiredCheckContexts: requiredCheckContexts,
	};
}

function readSourceGreen(branch = "develop") {
	const raw = gh([
		"run",
		"list",
		"--workflow",
		"Test & Quality",
		"-L",
		"15",
		"--json",
		"headBranch,status,conclusion,headSha",
	]);
	if (!raw) return null;
	try {
		const runs = JSON.parse(raw).filter((r) => r.headBranch === branch && r.status === "completed");
		if (runs.length === 0) return null;
		return runs[0].conclusion === "success";
	} catch {
		return null;
	}
}

// ── posture-derived advisory findings ────────────────────────────────────────

function postureFindings(posture) {
	const findings = [];
	if (!posture.available) {
		findings.push({ level: "info", text: "GitHub posture skipped (gh unavailable/unauth); ran local checks only." });
		return findings;
	}
	const automationOn = posture.releaseAutomation === "true";
	const tokens = posture.npmTokenPresent || posture.cargoTokenPresent;
	if (automationOn && tokens) {
		findings.push({
			level: "warn",
			text: "RELEASE_AUTOMATION=true and a publish token exists — the first-publish guard is the ONLY barrier to publishing. It is load-bearing; keep it green.",
		});
	}
	if (!posture.mainRequiresPr || !posture.mainRequiresChecks) {
		findings.push({
			level: "warn",
			text: `main is under-protected (PR required: ${posture.mainRequiresPr}, status checks required: ${posture.mainRequiresChecks}). A raw push to main bypasses clean-room-verify + Test & Quality. Enforce with branch protection.`,
		});
	}
	return findings;
}

// ── main ─────────────────────────────────────────────────────────────────────

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	const args = process.argv.slice(2);
	const asJson = args.includes("--json");
	const allowPublish = args.includes("--allow-publish");
	const offline = args.includes("--offline");
	const selectionIndex = args.indexOf("--selection");
	const selectionId = selectionIndex >= 0 ? args[selectionIndex + 1] : "vault-seed-ready";

	const risks = findFirstPublishChangesetRisks({ root: ROOT, selectionId });
	const baselineRisks = findOutOfSelectionBaselineRisks({ root: ROOT, selectionId });
	const blocked = risks.length + baselineRisks.length > 0;

	const changesets = parseChangesets(ROOT);
	const versions = readWorkspacePackageVersions(ROOT);
	const { guarded, wouldPublish, unknown } = classifyChangesets({ changesets, versions });

	const posture = offline ? { available: false } : readGithubPosture();
	const sourceGreen = offline ? null : readSourceGreen("develop");
	const findings = postureFindings(posture);

	const { verdict, ok, exitCode, reasons } = computeVerdict({ blocked, wouldPublish, sourceGreen, allowPublish });

	const nextCommands =
		verdict === "SAFE"
			? [
					"gh pr create --base main --head develop --fill  # the rite: promote via PR, gated by clean-room-verify",
				]
			: verdict === "WOULD-PUBLISH"
				? ["# review the would-publish list; if intended re-run with --allow-publish, else hold the changesets"]
				: ["# fix the source branch (develop) before promoting"];

	const payload = {
		ok,
		verdict,
		blocked,
		pendingChangesets: changesets.length,
		guarded: guarded.length,
		wouldPublish: wouldPublish.map((r) => `${r.packageName}@${r.currentVersion}`),
		unknownTargets: unknown.map((r) => r.packageName),
		sourceGreen,
		posture,
		findings,
		reasons,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};

	if (asJson) {
		process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
	} else {
		const mark = verdict === "SAFE" ? "✅" : verdict === "WOULD-PUBLISH" ? "⚠️ " : "❌";
		process.stdout.write(`\n${mark} promote-check: ${verdict}\n\n`);
		for (const reason of reasons) process.stdout.write(`  • ${reason}\n`);
		process.stdout.write(
			`\n  pending changesets: ${changesets.length} (guarded@0.1.0: ${guarded.length}, would-publish: ${wouldPublish.length}, unknown: ${unknown.length})\n`,
		);
		process.stdout.write(`  source (develop) green: ${sourceGreen === null ? "unknown" : sourceGreen}\n`);
		if (posture.available) {
			process.stdout.write(
				`  posture: RELEASE_AUTOMATION=${posture.releaseAutomation}, npmToken=${posture.npmTokenPresent}, cargoToken=${posture.cargoTokenPresent}, main PR/checks required=${posture.mainRequiresPr}/${posture.mainRequiresChecks}\n`,
			);
		}
		for (const finding of findings) {
			const fmark = finding.level === "warn" ? "⚠️ " : "  ";
			process.stdout.write(`  ${fmark}${finding.text}\n`);
		}
		process.stdout.write(`\n  next: ${payload.nextCommand}\n\n`);
	}

	process.exit(exitCode);
}
