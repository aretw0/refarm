import assert from "node:assert/strict";
import test from "node:test";

import {
	KNOWN_PRICING_MODES,
	MINIMUM_PLAUSIBLE_PRICED_LITERAL_COUNT,
	main,
	pricedLiterals,
	pricingModesFromSource,
	rateForModelFunctionSource,
	stripRustComments,
} from "./check-model-defaults-drift.mjs";

// A minimal but structurally realistic `rate_for_model`, big enough to clear
// MINIMUM_PLAUSIBLE_PRICED_LITERAL_COUNT on its own so fixture tests below
// aren't fighting the floor they're not testing.
function fakeRateForModel(extraBranches = "") {
	return `pub(crate) fn rate_for_model(model: &str) -> RateLookup {
    let (rate_in, rate_out): (f64, f64) = if model.contains("a-1") {
        (1.0, 1.0)
    } else if model.contains("a-2") {
        (1.0, 1.0)
    } else if model.contains("a-3") {
        (1.0, 1.0)
    } else if model.contains("a-4") {
        (1.0, 1.0)
    } else if model.contains("a-5") {
        (1.0, 1.0)
    } else if model.contains("a-6") {
        (1.0, 1.0)
    } else if model.contains("a-7") {
        (1.0, 1.0)
    } else if model.contains("a-8") {
        (1.0, 1.0)
    }${extraBranches} else {
        return RateLookup::Unknown;
    };
    RateLookup::Priced { rate_in, rate_out }
}

pub(crate) fn estimate_usd(model: &str) -> f64 {
    0.0
}`;
}

// ── Finding 1(a): a comment cannot declare a price ──────────────────────────

test("pricedLiterals ignores a model.contains(...) that only appears inside a comment", () => {
	const source = fakeRateForModel(
		'\n    // e.g. model.contains("gpt-6") would need its own verified branch',
	);
	const literals = pricedLiterals(source);
	assert.ok(!literals.has("gpt-6"), "a commented-out example must not enter the priced set");
});

test("stripRustComments removes // and block comments but leaves string contents alone", () => {
	const source = [
		'model.contains("kept-1") // model.contains("from-line-comment")',
		"/* model.contains(\"from-block-comment\") */ model.contains(\"kept-2\")",
		'let url = "https://example.com/not-a-comment"; // trailing',
	].join("\n");
	const stripped = stripRustComments(source);
	assert.ok(stripped.includes('model.contains("kept-1")'));
	assert.ok(stripped.includes('model.contains("kept-2")'));
	assert.ok(!stripped.includes("from-line-comment"));
	assert.ok(!stripped.includes("from-block-comment"));
	// The "//" inside a real string literal (a URL) must survive — a naive
	// stripper that doesn't track string state would truncate the line here.
	assert.ok(stripped.includes("https://example.com/not-a-comment"));
});

// ── Finding 1(b): a parse that finds nothing, or next to nothing, must scream ──

test("pricedLiterals throws when the body has zero model.contains(...) branches", () => {
	assert.throws(() => pricedLiterals("pub(crate) fn rate_for_model(model: &str) -> RateLookup { RateLookup::Unknown }"), /priced literal/);
});

test("pricedLiterals throws when the body is reformatted past recognition (below the floor, not zero)", () => {
	// Three real branches: fewer than MINIMUM_PLAUSIBLE_PRICED_LITERAL_COUNT but
	// not zero either — the exact case a bare "!== 0" check would have missed.
	assert.ok(3 < MINIMUM_PLAUSIBLE_PRICED_LITERAL_COUNT);
	const body = `pub(crate) fn rate_for_model(model: &str) -> RateLookup {
    let (rate_in, rate_out): (f64, f64) = if model.contains("a-1") {
        (1.0, 1.0)
    } else if model.contains("a-2") {
        (1.0, 1.0)
    } else if model.contains("a-3") {
        (1.0, 1.0)
    } else {
        return RateLookup::Unknown;
    };
    RateLookup::Priced { rate_in, rate_out }
}`;
	assert.throws(() => pricedLiterals(body), /priced literal/);
});

test("rateForModelFunctionSource throws when the function cannot be found at all (renamed past recognition)", () => {
	assert.throws(
		() => rateForModelFunctionSource("pub(crate) fn totally_renamed(model: &str) { }"),
		/could not find `rate_for_model`/,
	);
});

// Finding 1's own words: "assert the script exits non-zero". `main()` returns
// the exact code the guarded entrypoint turns into `process.exit` — calling it
// in-process (never `process.exit` itself) is how that gets asserted without
// spawning a subprocess or risking the test runner's own exit code.
test("main() returns a non-zero exit code when fed a rate_for_model body it cannot understand", async () => {
	const code = await main({
		utilsSource: "this is not rust code, and definitely not rate_for_model, at all",
		rustSource: 'pub(crate) const ANTHROPIC_DEFAULT_MODEL: &str = "claude-sonnet-4-6";',
		config: { defaultModelForProvider: () => undefined },
		baselineRaw: '{"entries":[]}',
	});
	assert.equal(code, 1);
});

// ── Finding 2: an unrecognised pricing mode must error, never silently default ──

test("pricingModesFromSource throws on an arm whose mode it does not recognise", () => {
	const source = `pub(crate) fn pricing_mode_for_provider(provider: &str) -> &'static str {
    match provider.trim().to_ascii_lowercase().as_str() {
        "openai-codex" | "github-copilot" => "subscription",
        "ollama" => "local",
        "some-new-provider" => "enterprise",
        _ => "api",
    }
}

pub(crate) fn next_fn() {}`;
	assert.throws(() => pricingModesFromSource(source), /does not recognise/);
});

test("pricingModesFromSource accepts every currently-known mode without error", () => {
	assert.deepEqual([...KNOWN_PRICING_MODES].sort(), ["api", "local", "subscription"]);
	const source = `pub(crate) fn pricing_mode_for_provider(provider: &str) -> &'static str {
    match provider.trim().to_ascii_lowercase().as_str() {
        "openai-codex" | "github-copilot" => "subscription",
        "ollama" => "local",
        _ => "api",
    }
}

pub(crate) fn next_fn() {}`;
	const modes = pricingModesFromSource(source);
	assert.equal(modes.get("openai-codex"), "subscription");
	assert.equal(modes.get("ollama"), "local");
});

test("pricingModesFromSource ignores a pricing-mode arm mentioned only in a comment", () => {
	const source = `pub(crate) fn pricing_mode_for_provider(provider: &str) -> &'static str {
    match provider.trim().to_ascii_lowercase().as_str() {
        // "some-new-provider" => "enterprise",
        "ollama" => "local",
        _ => "api",
    }
}

pub(crate) fn next_fn() {}`;
	const modes = pricingModesFromSource(source);
	assert.ok(!modes.has("some-new-provider"), "a commented-out arm must not be parsed as real");
});

// ── Regression guard: the real repo, end to end, unmodified ────────────────

test("main() exits 0 against the real repo files (regression guard)", async () => {
	const code = await main();
	assert.equal(code, 0);
});
