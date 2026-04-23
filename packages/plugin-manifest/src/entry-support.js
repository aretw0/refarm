const KNOWN_ENTRY_FORMATS = ["js", "mjs", "cjs", "wasm"];

export const SUPPORTED_ENTRY_FORMATS = Object.freeze(KNOWN_ENTRY_FORMATS);

export const RUNTIME_ENTRY_SUPPORT = Object.freeze({
	node: Object.freeze(["js", "mjs", "cjs", "wasm"]),
	browser: Object.freeze(["js", "mjs"]),
});

/**
 * @param {string} entry
 * @returns {"js"|"mjs"|"cjs"|"wasm"|"unknown"}
 */
export function detectEntryFormat(entry) {
	if (typeof entry !== "string") return "unknown";

	const normalized = entry.trim().split("?")[0].split("#")[0].toLowerCase();
	if (normalized.endsWith(".js")) return "js";
	if (normalized.endsWith(".mjs")) return "mjs";
	if (normalized.endsWith(".cjs")) return "cjs";
	if (normalized.endsWith(".wasm")) return "wasm";
	return "unknown";
}

/**
 * @param {string} entry
 * @param {"node"|"browser"} runtime
 * @returns {{runtime: "node"|"browser", format: "js"|"mjs"|"cjs"|"wasm"|"unknown", supported: boolean}}
 */
export function evaluateEntryRuntimeCompatibility(entry, runtime) {
	const format = detectEntryFormat(entry);
	const supportedFormats = RUNTIME_ENTRY_SUPPORT[runtime] || [];

	return {
		runtime,
		format,
		supported: supportedFormats.includes(format),
	};
}

/**
 * Throws when entry format is unsupported for the selected runtime.
 *
 * @param {string} entry
 * @param {"node"|"browser"} runtime
 */
export function assertEntryRuntimeCompatibility(entry, runtime) {
	const { format, supported } = evaluateEntryRuntimeCompatibility(
		entry,
		runtime,
	);

	if (format === "unknown") {
		throw new Error(
			`entry must be a .js/.mjs/.cjs or .wasm path (received: "${entry}")`,
		);
	}

	if (supported) return;

	if (runtime === "browser" && format === "wasm") {
		throw new Error(
			`entry format .wasm is not yet supported in browser runtime (ADR-044 roadmap)`,
		);
	}

	if (runtime === "browser" && format === "cjs") {
		throw new Error(
			`entry format .cjs is not supported in browser runtime; use .mjs/.js`,
		);
	}

	throw new Error(
		`entry format .${format} is not supported in ${runtime} runtime`,
	);
}
