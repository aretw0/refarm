// check:config-node-keys — the config-node key lists must not drift Rust↔TS.
//
// The config node (`urn:sovereign:config:workspace`) replicates cross-device, and its
// `revision` is a byte-identical sha256 across stacks. That parity holds ONLY if the
// two producers strip the SAME keys before hashing. Two lists gate what leaves a
// device:
//   - REDACTION_KEY_PATTERNS  — secret-name substrings → `<redacted>`
//   - DEVICE_LOCAL_KEYS        — machine-specific keys → REMOVED from the node
// Both are hand-mirrored between packages/config/src/config-node.js (TS) and
// packages/tractor/src/host/plugin_host/config_node.rs (Rust). This guard fails if
// either list disagrees — the same single-source invariant check:permission-vocab
// enforces. Comparison is case-insensitive: TS keeps camelCase (`sidecarUrl`), Rust
// pre-lowers (`sidecarurl`); they must match as a SET once lowercased.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const rustPath = resolve(rootDir, "packages/tractor/src/host/plugin_host/config_node.rs");
const tsPath = resolve(rootDir, "packages/config/src/config-node.js");

const rust = readFileSync(rustPath, "utf-8");
const { CONFIG_NODE_REDACTION_KEY_PATTERNS, CONFIG_NODE_DEVICE_LOCAL_KEYS } = await import(
	pathToFileURL(tsPath)
);

/** Extract the string literals from a Rust `const NAME: &[&str] = &[ ... ];` slice.
 * Anchor on the `= &[` that opens the VALUE array — the type `&[&str]` has its own
 * `[` that must not be mistaken for the array open. */
function rustStringSlice(constName) {
	const start = rust.indexOf(`const ${constName}`);
	if (start === -1) {
		throw new Error(`could not find \`const ${constName}\` in config_node.rs`);
	}
	const eq = rust.indexOf("= &[", start);
	if (eq === -1) {
		throw new Error(`could not find the \`= &[\` value opener for ${constName}`);
	}
	const open = eq + "= &".length; // index of the `[` that opens the value array
	const close = rust.indexOf("]", open);
	if (close === -1) {
		throw new Error(`could not parse the slice body of ${constName}`);
	}
	const body = rust.slice(open + 1, close);
	return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Set-equality of two key lists, compared case-insensitively. */
function diffAsLowerSet(name, rustKeys, tsKeys, failures) {
	const rustSet = new Set(rustKeys.map((k) => k.toLowerCase()));
	const tsSet = new Set(tsKeys.map((k) => k.toLowerCase()));
	if (rustSet.size === 0) {
		failures.push(`${name}: parsed zero keys from Rust — the regex/source drifted`);
	}
	for (const k of rustSet) {
		if (!tsSet.has(k)) failures.push(`${name}: Rust has "${k}" but TS omits it`);
	}
	for (const k of tsSet) {
		if (!rustSet.has(k)) failures.push(`${name}: TS has "${k}" but Rust omits it`);
	}
}

const failures = [];
diffAsLowerSet(
	"REDACTION_KEY_PATTERNS",
	rustStringSlice("REDACTION_KEY_PATTERNS"),
	CONFIG_NODE_REDACTION_KEY_PATTERNS,
	failures,
);
diffAsLowerSet(
	"DEVICE_LOCAL_KEYS",
	rustStringSlice("DEVICE_LOCAL_KEYS"),
	CONFIG_NODE_DEVICE_LOCAL_KEYS,
	failures,
);

if (failures.length > 0) {
	console.error(
		"[check:config-node-keys] Rust↔TS config-node key drift:\n" +
			failures.map((f) => `  - ${f}`).join("\n") +
			"\n\nThe config node's cross-stack digest parity depends on both producers " +
			"stripping the SAME keys. Align packages/config/src/config-node.js and " +
			"packages/tractor/src/host/plugin_host/config_node.rs.",
	);
	process.exit(1);
}

console.log(
	`[check:config-node-keys] OK — ${CONFIG_NODE_REDACTION_KEY_PATTERNS.length} redaction + ` +
		`${CONFIG_NODE_DEVICE_LOCAL_KEYS.length} device-local keys aligned Rust↔TS`,
);
