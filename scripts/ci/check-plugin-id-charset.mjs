// check:plugin-id-charset — the plugin-id filesystem-safe charset must not drift
// RS↔TS.
//
// A plugin id becomes a filesystem path segment (pluginIdToFsToken) and is
// validated as a routing/allowlist token. Two implementations enforce the SAME
// safe charset: the Rust host `is_safe_plugin_id_token`
// (packages/tractor/src/host/host_effects_bridge/policy_and_fs.rs — the source of
// truth, ADR-059) and the TS contract `PLUGIN_ID_FS_SAFE_CHARS` +
// `PLUGIN_ID_MAX_LEN` (@refarm.dev/config/plugin-identity). They agree today; this
// guard makes them UNABLE to diverge silently — the same single-source invariant
// check:permission-vocab / check:wit enforce.
//
// It reads the Rust charset as a canonical SET (the Rust side uses a method call
// `is_ascii_alphanumeric()` + `b == b'X'` byte literals, not a char class, so a
// string diff would be meaningless) and compares against the TS char-class const.
// Fails on any symmetric difference, a max-len mismatch, or a zero-parse (Rust
// refactored → the regex matched nothing → treat as drift, never as "ok").

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const rustPath = resolve(
	rootDir,
	"packages/tractor/src/host/host_effects_bridge/policy_and_fs.rs",
);
const tsPath = resolve(rootDir, "packages/config/src/plugin-identity.js");

const rust = readFileSync(rustPath, "utf-8");
const { PLUGIN_ID_FS_SAFE_CHARS, PLUGIN_ID_MAX_LEN } = await import(
	pathToFileURL(tsPath)
);

const failures = [];

// ── Scope to the Rust is_safe_plugin_id_token function body ───────────────────
const fnStart = rust.indexOf("fn is_safe_plugin_id_token");
if (fnStart === -1) {
	console.error(
		"[check:plugin-id-charset] could not find `fn is_safe_plugin_id_token` in policy_and_fs.rs — Rust refactored; update this guard.",
	);
	process.exit(1);
}
// The function body ends at the first line that is exactly `}` at column 0.
const fnEnd = rust.indexOf("\n}\n", fnStart);
const fnBody = rust.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

// ── Build the Rust charset as a canonical set of tokens ───────────────────────
// `is_ascii_alphanumeric()` ⇒ the alphanumeric class; each `b == b'X'` ⇒ one punct.
const rustSet = new Set();
if (/is_ascii_alphanumeric\(\)/.test(fnBody)) {
	rustSet.add("A-Za-z0-9");
}
const byteLiterals = [...fnBody.matchAll(/b == b'(\\?.)'/g)].map((m) => m[1]);
for (const lit of byteLiterals) {
	// Rust byte literals like b'_' / b'-' / b'.'; unescape a leading backslash.
	rustSet.add(lit.startsWith("\\") ? lit.slice(1) : lit);
}

if (rustSet.size === 0) {
	failures.push(
		"parsed zero charset tokens from the Rust is_safe_plugin_id_token — the regex/source drifted",
	);
}

// ── Build the TS charset as the same canonical set ────────────────────────────
// PLUGIN_ID_FS_SAFE_CHARS is a regex char-class body, e.g. "A-Za-z0-9._-".
const tsSet = new Set();
if (/A-Za-z0-9/.test(PLUGIN_ID_FS_SAFE_CHARS)) {
	tsSet.add("A-Za-z0-9");
}
// The remaining punctuation chars (strip the alnum ranges).
for (const ch of PLUGIN_ID_FS_SAFE_CHARS.replace(/A-Za-z0-9/g, "")) {
	tsSet.add(ch);
}

// ── Compare (symmetric difference) ────────────────────────────────────────────
for (const tok of rustSet) {
	if (!tsSet.has(tok)) {
		failures.push(
			`Rust is_safe_plugin_id_token permits "${tok}" but the TS PLUGIN_ID_FS_SAFE_CHARS omits it`,
		);
	}
}
for (const tok of tsSet) {
	if (!rustSet.has(tok)) {
		failures.push(
			`TS PLUGIN_ID_FS_SAFE_CHARS permits "${tok}" but the Rust is_safe_plugin_id_token omits it`,
		);
	}
}

// ── Max length ────────────────────────────────────────────────────────────────
const maxMatch = fnBody.match(/MAX_PLUGIN_ID_LEN:\s*usize\s*=\s*(\d+)/);
if (!maxMatch) {
	failures.push("could not find MAX_PLUGIN_ID_LEN in the Rust function");
} else if (Number(maxMatch[1]) !== PLUGIN_ID_MAX_LEN) {
	failures.push(
		`max length: Rust=${maxMatch[1]} TS PLUGIN_ID_MAX_LEN=${PLUGIN_ID_MAX_LEN}`,
	);
}

if (failures.length > 0) {
	console.error(
		"[check:plugin-id-charset] RS↔TS plugin-id charset drift:\n" +
			failures.map((f) => `  - ${f}`).join("\n") +
			"\n\nThe Rust is_safe_plugin_id_token (policy_and_fs.rs) is the source of " +
			"truth; align PLUGIN_ID_FS_SAFE_CHARS / PLUGIN_ID_MAX_LEN in " +
			"packages/config/src/plugin-identity.js.",
	);
	process.exit(1);
}

console.log(
	`[check:plugin-id-charset] OK — fs-safe charset + max-len (${PLUGIN_ID_MAX_LEN}) aligned RS↔TS ` +
		`(${[...rustSet].join(" ")})`,
);
