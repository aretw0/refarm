// check:permission-vocab — the permission vocabulary must not drift Rust↔TS.
//
// The Rust host (`packages/tractor/src/host/permission.rs`) is the SOURCE OF
// TRUTH (ADR-059: the host is the authoritative runtime). The TS side
// (`packages/plugin-manifest/src/permission-vocab.js`) mirrors it for manifest
// validation + the persona approval UX. This guard fails if the two disagree on
// the vocabulary (ids), the human-readable labels, or the risk levels — the same
// single-source-of-truth invariant `check:wit` enforces for the plugin WIT.
//
// It reads the Rust `Permission::as_str`/`label`/`risk` match arms by regex (the
// pattern `check-model-defaults-drift.mjs` established) and compares against the
// imported TS PERMISSIONS table.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const rustPath = resolve(rootDir, "packages/tractor/src/host/permission.rs");
const tsPath = resolve(
	rootDir,
	"packages/plugin-manifest/src/permission-vocab.js",
);

const rust = readFileSync(rustPath, "utf-8");
const { PERMISSIONS } = await import(pathToFileURL(tsPath));

// ── Parse the Rust vocabulary from the three exhaustive match blocks ──────────

// Scope to `impl Permission { ... }` first — `RiskLevel` also has an `as_str`,
// so an unscoped method search would grab the wrong block. The impl block runs
// to the next top-level `impl` or `#[cfg(test)]`.
const implStart = rust.indexOf("impl Permission {");
if (implStart === -1) {
	throw new Error("could not find `impl Permission {` in permission.rs");
}
const implEndCandidates = [
	rust.indexOf("\nimpl ", implStart + 1),
	rust.indexOf("\n#[cfg(test)]", implStart),
].filter((i) => i !== -1);
const implEnd = Math.min(...implEndCandidates);
const implBody = rust.slice(implStart, implEnd);

/** Extract `Permission::Variant => <value>` arms inside the named method. */
function rustArms(methodSig, valueRe) {
	const start = implBody.indexOf(methodSig);
	if (start === -1) {
		throw new Error(`could not find ${methodSig} in impl Permission`);
	}
	// The method body ends at the first line that is exactly `    }` (4-space
	// method close) after the signature.
	const closeIdx = implBody.indexOf("\n    }", start);
	const body = implBody.slice(start, closeIdx === -1 ? undefined : closeIdx);
	const arms = new Map();
	const re = new RegExp(`Permission::(\\w+)\\s*=>\\s*${valueRe}`, "g");
	let m;
	while ((m = re.exec(body)) !== null) {
		arms.set(m[1], m[2]);
	}
	return arms;
}

const rustWire = rustArms("fn as_str(self)", `"([^"]+)"`);
const rustLabel = rustArms("fn label(self)", `"([^"]+)"`);
const rustRisk = rustArms("fn risk(self)", `RiskLevel::(\\w+)`);

const RISK_TS = { Low: "low", Medium: "medium", High: "high" };

// Build the Rust-side vocabulary keyed by wire id.
const rustVocab = new Map();
for (const [variant, wire] of rustWire) {
	rustVocab.set(wire, {
		id: wire,
		label: rustLabel.get(variant),
		risk: RISK_TS[rustRisk.get(variant)],
	});
}

// ── Compare against the TS table ─────────────────────────────────────────────

const failures = [];
const tsById = new Map(PERMISSIONS.map((p) => [p.id, p]));

for (const id of rustVocab.keys()) {
	if (!tsById.has(id)) {
		failures.push(`Rust declares "${id}" but the TS PERMISSIONS table omits it`);
	}
}
for (const id of tsById.keys()) {
	if (!rustVocab.has(id)) {
		failures.push(`TS declares "${id}" but the Rust enum omits it`);
	}
}
for (const [id, r] of rustVocab) {
	const t = tsById.get(id);
	if (!t) continue;
	if (t.label !== r.label) {
		failures.push(`"${id}" label: Rust="${r.label}" TS="${t.label}"`);
	}
	if (t.risk !== r.risk) {
		failures.push(`"${id}" risk: Rust="${r.risk}" TS="${t.risk}"`);
	}
}

if (rustVocab.size === 0) {
	failures.push("parsed zero permissions from Rust — the regex/source drifted");
}

if (failures.length > 0) {
	console.error(
		"[check:permission-vocab] Rust↔TS permission vocabulary drift:\n" +
			failures.map((f) => `  - ${f}`).join("\n") +
			"\n\nThe Rust enum (packages/tractor/src/host/permission.rs) is the source of " +
			"truth; update packages/plugin-manifest/src/permission-vocab.js to match.",
	);
	process.exit(1);
}

console.log(
	`[check:permission-vocab] OK — ${rustVocab.size} permissions aligned Rust↔TS ` +
		`(${[...rustVocab.keys()].join(", ")})`,
);
