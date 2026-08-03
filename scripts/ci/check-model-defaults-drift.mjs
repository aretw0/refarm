import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const configPath = resolve(rootDir, "packages/config/src/model-routing.js");
const agentPath = resolve(rootDir, "packages/agent/src/provider_config.rs");
const utilsPath = resolve(rootDir, "packages/agent/src/utils.rs");

const baselinePath = resolve(rootDir, "scripts/ci/model-defaults-price-baseline.json");

const config = await import(pathToFileURL(configPath));
const rustSource = await readFile(agentPath, "utf-8");
const utilsSource = await readFile(utilsPath, "utf-8");
const baselineRaw = await readFile(baselinePath, "utf-8");

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

function rustStringConst(name) {
	const match = rustSource.match(
		new RegExp(`const\\s+${name}\\s*:\\s*&str\\s*=\\s*"([^"]+)"`),
	);
	return match?.[1];
}

function rustOpenAiCompatModels() {
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

const rustDefaults = rustOpenAiCompatModels();
const failures = [];

function expectModel(provider, actual, expected, source) {
	if (actual === expected) return;
	failures.push(
		`${provider}: ${source} has ${actual ?? "<missing>"} but packages/config has ${expected ?? "<missing>"}`,
	);
}

for (const provider of commonCompatProviders) {
	expectModel(
		provider,
		rustDefaults.get(provider),
		config.defaultModelForProvider(provider),
		"agent openai_compat_defaults",
	);
}

expectModel(
	"anthropic",
	rustStringConst("ANTHROPIC_DEFAULT_MODEL"),
	config.defaultModelForProvider("anthropic"),
	"agent ANTHROPIC_DEFAULT_MODEL",
);

// ── Price coverage: every default model must be priceable, with a shrinking baseline ──
//
// The checks above only ask whether the two sources AGREE on a model id. They
// never ask whether the cost estimator (`rate_for_model` in packages/agent/src/
// utils.rs) can actually price that id. A default model with no rate on file
// estimates $0.00 in silence — see `RateLookup::Unknown` in utils.rs. This
// section reads utils.rs as TEXT, the same established pattern used above for
// provider_config.rs, and never invokes Rust.
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

/// Slice out just the body of `rate_for_model` so a `model.contains("...")`
/// literal elsewhere in the file (there shouldn't be one today, but the parse
/// must not silently assume that stays true) can never be mistaken for a priced
/// branch.
function rateForModelFunctionSource(source) {
	const start = source.indexOf("pub(crate) fn rate_for_model");
	if (start === -1) {
		throw new Error(
			"check-model-defaults-drift: could not find `rate_for_model` in " +
				`${relative(rootDir, utilsPath)} — refusing to guess which default models are priced.`,
		);
	}
	const nextFn = source.indexOf("\npub(crate) fn ", start + 1);
	if (nextFn === -1) {
		throw new Error(
			"check-model-defaults-drift: found `rate_for_model` but not the function after it in " +
				`${relative(rootDir, utilsPath)} — refusing to guess where it ends.`,
		);
	}
	return source.slice(start, nextFn);
}

/// Every `model.contains("...")` literal that is a POSITIVE match condition in
/// `rate_for_model` — i.e. evidence a model id is priced. A literal that only
/// ever appears negated (`!model.contains("mini")`, used to carve gpt-4o-mini
/// out of the plain gpt-4o branch) is an EXCLUSION, not proof of a rate, and
/// must not be counted as one — that false positive was caught while building
/// this check: it made "gemini-3-flash-preview" look priced because it happens
/// to contain the substring "mini".
function pricedLiterals(fnSource) {
	const literals = new Set();
	for (const match of fnSource.matchAll(/(!?)\s*model\.contains\("([^"]+)"\)/g)) {
		if (match[1] !== "!") literals.add(match[2]);
	}
	if (literals.size === 0) {
		throw new Error(
			"check-model-defaults-drift: `rate_for_model` has no `model.contains(\"...\")` branches in " +
				`${relative(rootDir, utilsPath)} — refusing to guess which default models are priced.`,
		);
	}
	return literals;
}

const pricedSet = pricedLiterals(rateForModelFunctionSource(utilsSource));

function hasRateOnFile(modelId) {
	for (const literal of pricedSet) {
		if (modelId.includes(literal)) return true;
	}
	return false;
}

/// Parse `pricing_mode_for_provider`'s match arms as text, the same established
/// pattern as everything else here. `estimate_billable_usd` calls this FIRST and
/// short-circuits to $0.00 for anything that isn't `"api"`, before `rate_for_model`
/// ever runs — so a `local`/`subscription` provider's default can never actually
/// reach the price table in production. This is the concrete shape of the finding
/// that motivated deleting the free list: ollama is `"local"`, so demanding a rate
/// for its default would be requiring a price nothing will ever charge.
function pricingModesFromSource(source) {
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
	const fnSource = source.slice(start, nextFn);
	const modes = new Map();
	for (const match of fnSource.matchAll(
		/((?:"[^"]+"\s*\|\s*)*"[^"]+")\s*=>\s*"(subscription|local|api)"/g,
	)) {
		for (const providerMatch of match[1].matchAll(/"([^"]+)"/g)) {
			modes.set(providerMatch[1], match[2]);
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

const pricingModes = pricingModesFromSource(utilsSource);

/// `_ => "api"` is the fallback arm in `pricing_mode_for_provider` itself — any
/// provider not named as `subscription`/`local` there is billed.
function isEverBilled(provider) {
	return (pricingModes.get(provider) ?? "api") === "api";
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

function defaultModelEntryId(provider, modelId) {
	return `${provider}:${modelId}`;
}

const unpriced = new Map(); // id -> { provider, modelId }
for (const [provider, modelId] of defaultModelIds) {
	if (isEverBilled(provider) && !hasRateOnFile(modelId)) {
		unpriced.set(defaultModelEntryId(provider, modelId), { provider, modelId });
	}
}

// ── The baseline: hand-edited, never auto-written ───────────────────────────
//
// Parsed strictly — a baseline this gate can silently misread is worse than
// one it refuses to read at all.

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

function splitBaselineEntryId(id) {
	const sep = typeof id === "string" ? id.indexOf(":") : -1;
	if (sep <= 0) return null;
	return { provider: id.slice(0, sep), modelId: id.slice(sep + 1) };
}

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
	if (hasRateOnFile(parsed.modelId)) {
		fixed.push(id);
		continue;
	}
	held.push(id);
}

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
	process.exit(1);
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
