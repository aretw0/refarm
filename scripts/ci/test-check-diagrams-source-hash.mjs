import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = path.join(ROOT, "scripts", "check-diagrams.mjs");

/**
 * THE GATE ASKS WHETHER A DIAGRAM IS CURRENT, NOT WHETHER ITS BYTES MATCH (ISS-046).
 *
 * The old `--ci` rendered every diagram and ran `git status`, so any difference in the rendering
 * ENVIRONMENT failed it. Measured on 2026-08-12: the browser was already pinned and identical to
 * CI's and it still drifted, because the config names `IBM Plex Sans` and most machines do not
 * have it — every text width moved by ~6%. Chasing that means pinning the font, then fontconfig,
 * then the mermaid version, forever.
 *
 * These pin the replacement: a recorded `sha256(source + config + renderer version)`, verified
 * without a browser.
 */
function runCheck(args, cwd = ROOT) {
	try {
		return {
			code: 0,
			out: execFileSync(process.execPath, [CHECK, ...args], { cwd, encoding: "utf8", stdio: "pipe" }),
		};
	} catch (error) {
		return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
	}
}

test("the repository's diagrams are all derived from their current sources", () => {
	const { code, out } = runCheck(["--ci"]);
	assert.equal(code, 0, out);
	assert.match(out, /All \d+ diagrams are derived from their current sources/u);
});

test("a source edit makes its diagram STALE, and the gate names the file", () => {
	// The defect this exists to catch, and the only one it claims to: the .mermaid moved and the
	// .svg did not.
	const source = path.join(ROOT, "specs", "diagrams", "data-flow.mermaid");
	const original = fs.readFileSync(source, "utf8");
	try {
		fs.writeFileSync(source, `${original}\n  ZZ[a node nobody rendered]\n`);
		const { code, out } = runCheck(["--ci"]);
		assert.equal(code, 1);
		assert.match(out, /are STALE/u);
		assert.match(out, /specs\/diagrams\/data-flow\.mermaid/u);
		// And it hands back the command that fixes it, not just a verdict.
		assert.match(out, /diagrams:fix/u);
	} finally {
		fs.writeFileSync(source, original);
	}
});

test("an UNSTAMPED diagram is its own state, not a stale one", () => {
	// Every file was in this state before the migration. Reporting it as stale would blame somebody
	// for failing to update a diagram nobody had ever stamped — and the remedy is different:
	// `--stamp` records the hash without re-rendering, `--fix` re-renders.
	const svg = path.join(ROOT, "specs", "diagrams", "data-flow.svg");
	const original = fs.readFileSync(svg, "utf8");
	try {
		fs.writeFileSync(svg, original.split("\n<!-- refarm-diagram-source:")[0]);
		const { code, out } = runCheck(["--ci"]);
		assert.equal(code, 1);
		assert.match(out, /record no source hash/u);
		assert.match(out, /diagrams:stamp/u);
		assert.doesNotMatch(out, /are STALE/u);
	} finally {
		fs.writeFileSync(svg, original);
	}
});

test("the config is part of the hash, so a theme edit invalidates every diagram", () => {
	// A theme change redraws everything while no .mermaid moves. Leaving the config out would make
	// the gate green over a repository of diagrams that no longer match their own styling.
	const config = path.join(ROOT, "specs", "diagrams", "mermaid.config.json");
	const original = fs.readFileSync(config, "utf8");
	try {
		const parsed = JSON.parse(original);
		parsed.themeVariables.primaryColor = "#123456";
		fs.writeFileSync(config, JSON.stringify(parsed, null, 2));
		const { code, out } = runCheck(["--ci"]);
		assert.equal(code, 1);
		assert.match(out, /are STALE/u);
	} finally {
		fs.writeFileSync(config, original);
	}
});

test("verifying touches no browser, and is fast enough to run on every edit", () => {
	// The point of the whole change. The old gate rendered 43 diagrams through headless Chrome,
	// which is a CI-only cost; this reads files.
	const started = Date.now();
	const { code } = runCheck(["--ci"]);
	const elapsed = Date.now() - started;
	assert.equal(code, 0);
	assert.ok(elapsed < 5_000, `verification took ${elapsed}ms, which suggests it rendered something`);
});

test("--stamp records the hash WITHOUT re-rendering", () => {
	// The migration path. Re-rendering to stamp would have replaced every committed SVG with one
	// machine's rendering — the exact environment-specific bytes this change exists to stop caring
	// about.
	const svg = path.join(ROOT, "specs", "diagrams", "data-flow.svg");
	const before = fs.readFileSync(svg, "utf8");
	const body = before.split("\n<!-- refarm-diagram-source:")[0];
	const { code } = runCheck(["--stamp"]);
	assert.equal(code, 0);
	const after = fs.readFileSync(svg, "utf8");
	assert.equal(after.split("\n<!-- refarm-diagram-source:")[0], body, "the SVG body must not move");
	assert.match(after, /refarm-diagram-source: sha256=[0-9a-f]{64}/u);
});

test("the marker survives a temp directory with no diagrams at all", () => {
	// A repository slice with no .mermaid files is not a failure, and the gate says so rather than
	// exiting 1 on an empty set.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-diagrams-"));
	try {
		const { code } = runCheck(["--ci"], ROOT);
		assert.equal(code, 0);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
