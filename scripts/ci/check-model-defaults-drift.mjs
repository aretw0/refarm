import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const configPath = resolve(rootDir, "packages/config/src/model-routing.js");
const agentPath = resolve(rootDir, "packages/agent/src/provider_config.rs");
const utilsPath = resolve(rootDir, "packages/agent/src/utils.rs");
const baselinePath = resolve(rootDir, "scripts/ci/model-defaults-price-baseline.json");

const commonCompatProviders = [
	"openai",
	"groq",
	"mistral",
	"xai",
	"deepseek",
	"together",
	"openrouter",
	"gemini",
	"ollama",
];

export function rustStringConst(rustSource, name) {
	const match = rustSource.match(new RegExp(`const\\s+${name}\\s*:\\s*&str\\s*=\\s*"([^"]+)"`));
	return match?.[1];
}

export function rustOpenAiCompatModels(rustSource) {
	const entries = new Map();
	for (const provider of commonCompatProviders.filter((value) => value !== "ollama")) {
		const match = rustSource.match(
			new RegExp(`"${provider}"\\s*=>\\s*\\(\\s*"[^"]+"\\s*,\\s*"([^"]+)"\\s*,?\\s*\\)`),
		);
		if (match?.[1]) {
			entries.set(provider, match[1]);
		}
	}

	const fallback = rustSource.match(/_\s*=>\s*\("http:\/\/localhost:11434",\s*"([^"]+)"\)/);
	if (fallback?.[1]) {
		entries.set("ollama", fallback[1]);
	}
	return entries;
}

export function expectModel(failures, provider, actual, expected, source) {
	if (actual === expected) return;
	failures.push(
		`${provider}: ${source} has ${actual ?? "<missing>"} but packages/config has ${expected ?? "<missing>"}`,
	);
}

// ── Comment stripping ───────────────────────────────────────────────────────
//
// Finding (fix round 1): the parser matched `model.contains("...")` and
// `"..." => "..."` shapes ANYWHERE in a sliced function body, including inside
// a `//` or `/* */` comment. A maintainer writing `// e.g. model.contains
// ("gpt-6")` would silently add "gpt-6" to the priced set, and the gate would
// stop flagging a genuinely unpriced gpt-6 default — a SILENT PASS, strictly
// worse than an error. This strips Rust line and block comments before either
// extractor runs, while leaving string literal CONTENTS untouched (a model id
// containing "//" — none do today, but the parser must not assume that stays
// true — must not be corrupted by a comment-stripper that doesn't know it's
// inside a string).

export function stripRustComments(source) {
	let result = "";
	let i = 0;
	const n = source.length;
	while (i < n) {
		const two = source.slice(i, i + 2);
		if (two === "//") {
			const newline = source.indexOf("\n", i);
			i = newline === -1 ? n : newline;
			continue;
		}
		if (two === "/*") {
			const end = source.indexOf("*/", i + 2);
			i = end === -1 ? n : end + 2;
			continue;
		}
		const ch = source[i];
		if (ch === '"') {
			result += ch;
			i++;
			while (i < n && source[i] !== '"') {
				if (source[i] === "\\" && i + 1 < n) {
					result += source[i] + source[i + 1];
					i += 2;
					continue;
				}
				result += source[i];
				i++;
			}
			if (i < n) {
				result += source[i];
				i++;
			}
			continue;
		}
		result += ch;
		i++;
	}
	return result;
}

// ── Price coverage: every default model must be priceable, with a shrinking baseline ──
//
// The drift checks above only ask whether the two sources AGREE on a model id.
// They never ask whether the cost estimator (`rate_for_model` in
// packages/agent/src/utils.rs) can actually price that id. A default model
// with no rate on file estimates $0.00 in silence — see `RateLookup::Unknown`
// in utils.rs. This section reads utils.rs as TEXT, the same established
// pattern used above for provider_config.rs, and never invokes Rust.
//
// There is no "known-free" escape hatch here (there used to be one; it was
// deleted — see utils.rs). Whether a model is free depends on WHO SERVES IT,
// not what it is called, and `pricing_mode_for_provider` already answers that,
// earlier, on the provider axis. Anything this section looks at is a default
// for an `api`-mode provider (`estimate_billable_usd` short-circuits `local`
// and `subscription` providers before `rate_for_model` ever runs), so it is
// being sold; without a rate it is simply unpriced.
//
// Rates are not invented to make this pass. Instead this follows the ratchet
// shape `@refarm.dev/hardening` already uses in this repo
// (packages/hardening/src/baseline.ts, hardening-baseline.json): an explicit,
// hand-edited, dated baseline of KNOWN debt, each entry citing the vendor's
// OFFICIAL pricing page. The gate is red if an unpriced default is NOT in the
// baseline (growth), red if a baselined entry now HAS a rate and was not
// deleted (undeleted progress), and red if a baselined entry no longer
// matches any current default (stale cover) — it is green only while the
// unpriced set is fully, currently, accounted for.

/// The function that HOLDS THE TABLE, sliced out so a `model.contains("...")` literal elsewhere
/// in the file can never be mistaken for a priced branch.
///
/// It is `rate_from_builtin_table`, not `rate_for_model`. It used to be the latter, and the
/// pricing chain was later split three ways — `rate_for_model` became a three-line delegator,
/// `rate_for_model_in` took the catalog-first path, and the literal table moved here. The parser
/// kept reading the delegator and found ZERO literals.
///
/// The gate handled that exactly as designed: `MINIMUM_PLAUSIBLE_PRICED_LITERAL_COUNT` made it
/// SCREAM about a broken parse instead of reporting a clean run over an empty table, which is
/// the one thing a matcher-based guard must never do. What it could not do was tell anyone —
/// no lane ran this suite (ISS-106), so the scream went into an empty room for as long as the
/// refactor has been in. Both halves are fixed: the parser points at the table, and
/// `pnpm run scripts:test` runs in `before-push`.
export function rateForModelFunctionSource(source) {
	const start = source.indexOf("pub(crate) fn rate_from_builtin_table");
	if (start === -1) {
		throw new Error(
			"check-model-defaults-drift: could not find `rate_from_builtin_table` in " +
				`${relative(rootDir, utilsPath)} — refusing to guess which default models are priced.`,
		);
	}
	const nextFn = source.indexOf("\npub(crate) fn ", start + 1);
	if (nextFn === -1) {
		throw new Error(
			"check-model-defaults-drift: found `rate_from_builtin_table` but not the function after it in " +
				`${relative(rootDir, utilsPath)} — refusing to guess where it ends.`,
		);
	}
	return source.slice(start, nextFn);
}

/// The smallest number of DISTINCT priced literals a healthy `rate_for_model`
/// should ever parse to. This is the general defence Finding 1(b) asked for:
/// not just "zero literals is suspicious" but "a parse that found almost
/// nothing is ALSO suspicious" — a renamed function, a reformatted branch
/// chain, or every literal hiding inside a comment would all quietly produce
/// a small-but-nonzero count without this floor. Today's real count is 14
/// (4 Claude families incl. the Haiku/Opus generation splits, 6 OpenAI
/// literals); 8 leaves comfortable room for legitimate future edits while
/// still screaming on anything that looks like a broken parse rather than a
/// smaller-but-real table. A gate that matches nothing (or next to nothing)
/// must scream, never pass.
export const MINIMUM_PLAUSIBLE_PRICED_LITERAL_COUNT = 8;

/// Every `model.contains("...")` literal that is a POSITIVE match condition in
/// `rate_for_model` — i.e. evidence a model id is priced. A literal that only
/// ever appears negated (`!model.contains("mini")`, used to carve gpt-4o-mini
/// out of the plain gpt-4o branch) is an EXCLUSION, not proof of a rate, and
/// must not be counted as one — that false positive was caught while building
/// this check: it made "gemini-3-flash-preview" look priced because it happens
/// to contain the substring "mini". Comments are stripped first (Finding 1(a)):
/// a comment can describe a price, never declare one.
export function pricedLiterals(fnSource) {
	const stripped = stripRustComments(fnSource);
	const literals = new Set();
	for (const match of stripped.matchAll(/(!?)\s*model\.contains\("([^"]+)"\)/g)) {
		if (match[1] !== "!") literals.add(match[2]);
	}
	if (literals.size < MINIMUM_PLAUSIBLE_PRICED_LITERAL_COUNT) {
		throw new Error(
			`check-model-defaults-drift: rate_from_builtin_table parsed only ${literals.size} priced literal(s) in ` +
				`${relative(rootDir, utilsPath)} (expected at least ${MINIMUM_PLAUSIBLE_PRICED_LITERAL_COUNT}) ` +
				"— the parse looks broken (renamed function, reformatted branches, comments stripped down to " +
				"nothing left, or something else this parser doesn't understand), not just a smaller table. " +
				"A gate that matches nothing, or next to nothing, must scream, never quietly report a clean run.",
		);
	}
	return literals;
}

export function hasRateOnFile(modelId, pricedSet) {
	for (const literal of pricedSet) {
		if (modelId.includes(literal)) return true;
	}
	return false;
}

/// The pricing modes `pricing_mode_for_provider` (in utils.rs) is allowed to
/// return today. Finding 2: the old regex hardcoded these three literals
/// directly into its match pattern, so a FOURTH mode added in Rust would not
/// match at all — the arm would be silently invisible to this parser, and
/// `isEverBilled` would then default that provider to `"api"`, demanding a
/// price for something Rust actually exempts. Kept as a named, editable set so
/// that adding a real new mode in Rust is a one-line, deliberate update here
/// too, not a silent gap.
export const KNOWN_PRICING_MODES = new Set(["subscription", "local", "api"]);

/// Parse `pricing_mode_for_provider`'s match arms as text, the same established
/// pattern as everything else here. `estimate_billable_usd` calls this FIRST and
/// short-circuits to $0.00 for anything that isn't `"api"`, before `rate_for_model`
/// ever runs — so a `local`/`subscription` provider's default can never actually
/// reach the price table in production. This is the concrete shape of the finding
/// that motivated deleting the free list: ollama is `"local"`, so demanding a rate
/// for its default would be requiring a price nothing will ever charge. Comments
/// are stripped first, same reasoning as `pricedLiterals`. Any arm whose mode is
/// NOT in `KNOWN_PRICING_MODES` is an explicit, loud error — never silently
/// dropped or defaulted.
export function pricingModesFromSource(source) {
	const start = source.indexOf("pub(crate) fn pricing_mode_for_provider");
	if (start === -1) {
		throw new Error(
			"check-model-defaults-drift: could not find `pricing_mode_for_provider` in " +
				`${relative(rootDir, utilsPath)} — refusing to guess which providers are ever billed.`,
		);
	}
	const nextFn = source.indexOf("\npub(crate) fn ", start + 1);
	if (nextFn === -1) {
		throw new Error(
			"check-model-defaults-drift: found `pricing_mode_for_provider` but not the function after " +
				`it in ${relative(rootDir, utilsPath)} — refusing to guess where it ends.`,
		);
	}
	const fnSource = stripRustComments(source.slice(start, nextFn));
	const modes = new Map();
	for (const match of fnSource.matchAll(/((?:"[^"]+"\s*\|\s*)*"[^"]+")\s*=>\s*"([^"]+)"/g)) {
		const mode = match[2];
		if (!KNOWN_PRICING_MODES.has(mode)) {
			throw new Error(
				"check-model-defaults-drift: `pricing_mode_for_provider` in " +
					`${relative(rootDir, utilsPath)} has an arm mapping to "${mode}", which this parser does ` +
					`not recognise (known modes: ${[...KNOWN_PRICING_MODES].join(", ")}). The JS parser is out ` +
					"of date with the Rust source — update KNOWN_PRICING_MODES here rather than let an " +
					'unrecognised mode fall through and default to "api" (which would wrongly demand a price ' +
					"for a provider Rust actually exempts).",
			);
		}
		for (const providerMatch of match[1].matchAll(/"([^"]+)"/g)) {
			modes.set(providerMatch[1], mode);
		}
	}
	if (modes.size === 0) {
		throw new Error(
			"check-model-defaults-drift: `pricing_mode_for_provider` matched no arms in " +
				`${relative(rootDir, utilsPath)} — refusing to guess which providers are ever billed.`,
		);
	}
	return modes;
}

/// `_ => "api"` is the fallback arm in `pricing_mode_for_provider` itself — any
/// provider not named as `subscription`/`local` there is billed.
export function isEverBilled(provider, pricingModes) {
	return (pricingModes.get(provider) ?? "api") === "api";
}

export function defaultModelEntryId(provider, modelId) {
	return `${provider}:${modelId}`;
}

export function splitBaselineEntryId(id) {
	const sep = typeof id === "string" ? id.indexOf(":") : -1;
	if (sep <= 0) return null;
	return { provider: id.slice(0, sep), modelId: id.slice(sep + 1) };
}

export function parsePriceBaseline(baselineRaw) {
	let priceBaseline;
	try {
		priceBaseline = JSON.parse(baselineRaw);
	} catch (error) {
		throw new Error(
			`check-model-defaults-drift: ${relative(rootDir, baselinePath)} is not valid JSON — refusing to guess its contents. ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!Array.isArray(priceBaseline?.entries)) {
		throw new Error(
			`check-model-defaults-drift: ${relative(rootDir, baselinePath)} has no \`entries\` array — refusing to guess its contents.`,
		);
	}
	return priceBaseline;
}

export function evaluatePriceBaseline(priceBaseline, unpriced, defaultModelIds, pricedSet) {
	const regressions = [];
	for (const id of unpriced.keys()) {
		if (!priceBaseline.entries.some((entry) => entry.id === id)) {
			regressions.push(`${id} — no rate_for_model branch, and not in the baseline`);
		}
	}

	const fixed = [];
	const stale = [];
	const malformed = [];
	const held = [];
	for (const entry of priceBaseline.entries) {
		const id = typeof entry?.id === "string" ? entry.id : "";
		const note = typeof entry?.note === "string" ? entry.note : "";
		const pricingUrl = typeof entry?.pricingUrl === "string" ? entry.pricingUrl : "";
		if (!id || !note.trim() || !pricingUrl.trim()) {
			malformed.push(id || "(an entry with no id)");
			continue;
		}
		const parsed = splitBaselineEntryId(id);
		const currentDefault = parsed ? defaultModelIds.get(parsed.provider) : undefined;
		if (!parsed || currentDefault !== parsed.modelId) {
			stale.push({
				id,
				why: currentDefault
					? `the current "${parsed.provider}" default is now "${currentDefault}"`
					: `"${parsed?.provider}" no longer has this as a checked default`,
			});
			continue;
		}
		if (hasRateOnFile(parsed.modelId, pricedSet)) {
			fixed.push(id);
			continue;
		}
		held.push(id);
	}

	return { regressions, fixed, stale, malformed, held };
}

/// The whole gate, as a pure(ish) function of its inputs: reads the real repo
/// files by default, but every input is overridable so a test can feed it a
/// body the parser can't understand and assert on the RETURNED exit code —
/// the same code the guarded block below turns into `process.exit` — without
/// spawning a subprocess or ever calling `process.exit` from inside a test
/// run. Returns 0 or 1; never exits the process itself.
export async function main({
	utilsSource: utilsSourceOverride,
	rustSource: rustSourceOverride,
	config: configOverride,
	baselineRaw: baselineRawOverride,
} = {}) {
	const config = configOverride ?? (await import(pathToFileURL(configPath)));
	const rustSource = rustSourceOverride ?? (await readFile(agentPath, "utf-8"));
	const utilsSource = utilsSourceOverride ?? (await readFile(utilsPath, "utf-8"));
	const baselineRaw = baselineRawOverride ?? (await readFile(baselinePath, "utf-8"));

	const failures = [];
	const rustDefaults = rustOpenAiCompatModels(rustSource);
	for (const provider of commonCompatProviders) {
		expectModel(
			failures,
			provider,
			rustDefaults.get(provider),
			config.defaultModelForProvider(provider),
			"agent openai_compat_defaults",
		);
	}
	expectModel(
		failures,
		"anthropic",
		rustStringConst(rustSource, "ANTHROPIC_DEFAULT_MODEL"),
		config.defaultModelForProvider("anthropic"),
		"agent ANTHROPIC_DEFAULT_MODEL",
	);

	let pricedSet;
	let pricingModes;
	let priceBaseline;
	try {
		pricedSet = pricedLiterals(rateForModelFunctionSource(utilsSource));
		pricingModes = pricingModesFromSource(utilsSource);
		priceBaseline = parsePriceBaseline(baselineRaw);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}

	// The same default model ids the drift checks above already know about: one
	// per `commonCompatProviders` entry (from packages/config, the canonical
	// source those checks compare Rust against) plus the Anthropic default.
	const defaultModelIds = new Map();
	for (const provider of commonCompatProviders) {
		const modelId = config.defaultModelForProvider(provider);
		if (modelId) defaultModelIds.set(provider, modelId);
	}
	const anthropicDefault = config.defaultModelForProvider("anthropic");
	if (anthropicDefault) defaultModelIds.set("anthropic", anthropicDefault);

	const unpriced = new Map(); // id -> { provider, modelId }
	for (const [provider, modelId] of defaultModelIds) {
		if (isEverBilled(provider, pricingModes) && !hasRateOnFile(modelId, pricedSet)) {
			unpriced.set(defaultModelEntryId(provider, modelId), { provider, modelId });
		}
	}

	const { regressions, fixed, stale, malformed, held } = evaluatePriceBaseline(
		priceBaseline,
		unpriced,
		defaultModelIds,
		pricedSet,
	);
	const priceGateFailed =
		regressions.length > 0 || fixed.length > 0 || stale.length > 0 || malformed.length > 0;

	if (failures.length > 0) {
		console.error("Model default drift detected:");
		for (const failure of failures) {
			console.error(`  - ${failure}`);
		}
		console.error("");
	}

	if (regressions.length > 0) {
		console.error("New default model(s) with no cost estimate and no baseline entry:");
		for (const line of regressions) {
			console.error(`  - ${line}`);
		}
		console.error("");
		console.error(
			"Either add a `model.contains(\"...\")` branch with a rate VERIFIED against the vendor's " +
				`official pricing page to rate_for_model in ${relative(rootDir, utilsPath)} and bump ` +
				"RATE_TABLE_VERSION, or add a dated entry citing that official page (never a third-party " +
				`aggregator) to ${relative(rootDir, baselinePath)}.`,
		);
		console.error("");
	}

	if (fixed.length > 0) {
		console.error(
			`Baseline entries in ${relative(rootDir, baselinePath)} that now have a rate on file — delete them (progress must be recorded, not left to rot):`,
		);
		for (const id of fixed) {
			console.error(`  - ${id}`);
		}
		console.error("");
	}

	if (stale.length > 0) {
		console.error(
			`Baseline entries in ${relative(rootDir, baselinePath)} that no longer match a current default — delete them (stale cover is cover for nothing):`,
		);
		for (const { id, why } of stale) {
			console.error(`  - ${id}: ${why}`);
		}
		console.error("");
	}

	if (malformed.length > 0) {
		console.error(
			`Malformed entries in ${relative(rootDir, baselinePath)} (each needs a non-empty "id", "note" and "pricingUrl"):`,
		);
		for (const id of malformed) {
			console.error(`  - ${id}`);
		}
		console.error("");
	}

	if (failures.length > 0 || priceGateFailed) {
		console.error(`Sources compared:`);
		console.error(`  - ${relative(rootDir, configPath)}`);
		console.error(`  - ${relative(rootDir, agentPath)}`);
		console.error(`  - ${relative(rootDir, utilsPath)}`);
		console.error(`  - ${relative(rootDir, baselinePath)}`);
		return 1;
	}

	console.log(
		"Model defaults aligned between packages/config and agent, and every unpriced default model is accounted for.",
	);
	if (held.length > 0) {
		console.log("Known, accepted debt (baselined, still unpriced):");
		for (const id of held) {
			console.log(`  - ${id}`);
		}
	}
	return 0;
}

// Only run as a side effect when invoked directly (`node check-model-defaults-drift.mjs`),
// never on import — this is what lets a test import the pure functions and `main`
// itself above without triggering a real run against the real repo files.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(await main());
}
