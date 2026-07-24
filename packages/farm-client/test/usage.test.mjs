import assert from "node:assert/strict";
import { test } from "node:test";
import { compactTokens, formatUsage, formatUsd, parseUsage } from "../src/usage.mjs";

/** A realistic EffortResult carrying a `respond` result with a usage block. */
function effortWith(usage) {
	return {
		status: "done",
		results: [
			{
				status: "ok",
				result: { content: "hi", model: "gpt-5.5", provider: "openai-codex", usage },
			},
		],
	};
}

test("parseUsage pulls and normalizes the respond usage block", () => {
	const u = parseUsage(
		effortWith({
			tokens_in: 1234,
			tokens_out: 340,
			tokens_reasoning: 128,
			pricing_mode: "subscription",
			estimated_usd: 0.0042,
			raw: { input_tokens_details: { cached_tokens: 900 } },
		}),
	);
	assert.equal(u.tokensIn, 1234);
	assert.equal(u.tokensOut, 340);
	assert.equal(u.tokensReasoning, 128);
	assert.equal(u.tokensCached, 900);
	assert.equal(u.estimatedUsd, 0.0042);
	assert.equal(u.pricingMode, "subscription");
	assert.equal(u.model, "gpt-5.5");
	assert.equal(u.provider, "openai-codex");
});

test("parseUsage tolerates a JSON-string result", () => {
	const raw = JSON.stringify({ content: "hi", usage: { tokens_in: 10, tokens_out: 5 } });
	const u = parseUsage({ results: [{ status: "ok", result: raw }] });
	assert.equal(u.tokensIn, 10);
	assert.equal(u.tokensOut, 5);
});

test("parseUsage returns null when the turn carried no metering", () => {
	assert.equal(parseUsage({ results: [{ status: "ok", result: { content: "hi" } }] }), null);
	assert.equal(parseUsage({ results: [] }), null);
	assert.equal(parseUsage(null), null);
});

test("parseUsage picks the same task extractAnswer would (first ok)", () => {
	const effort = {
		results: [
			{ status: "error", result: { content: "nope" } },
			{ status: "ok", result: { content: "yes", usage: { tokens_in: 7 } } },
		],
	};
	assert.equal(parseUsage(effort).tokensIn, 7);
});

test("compactTokens keeps small counts exact and abbreviates large ones", () => {
	assert.equal(compactTokens(0), "0");
	assert.equal(compactTokens(980), "980");
	assert.equal(compactTokens(1234), "1.2k");
	assert.equal(compactTokens(45000), "45k");
});

test("formatUsd is blank when unknown and scales its precision", () => {
	assert.equal(formatUsd(null), "");
	assert.equal(formatUsd(0), "~$0");
	assert.equal(formatUsd(0.0042), "~$0.0042");
	assert.equal(formatUsd(1.5), "~$1.50");
});

test("formatUsage leads with context size and hides zero-value rows", () => {
	const line = formatUsage({
		tokensIn: 1234,
		tokensOut: 340,
		tokensReasoning: 0,
		tokensCached: 0,
		estimatedUsd: null,
		pricingMode: null,
	});
	assert.match(line, /^↳ 1\.2k in · 340 out$/);
});

test("formatUsage appends reasoning, cached, and priced cost when present", () => {
	const line = formatUsage({
		tokensIn: 2000,
		tokensOut: 500,
		tokensReasoning: 128,
		tokensCached: 900,
		estimatedUsd: 0.0042,
		pricingMode: "subscription",
	});
	assert.match(line, /128 reasoning/);
	assert.match(line, /900 cached/);
	assert.match(line, /~\$0\.0042 subscription/);
});

test("formatUsage shows the quota mode tag, not a misleading $0, for subscription turns", () => {
	const line = formatUsage({
		tokensIn: 1359,
		tokensOut: 5,
		tokensReasoning: 0,
		tokensCached: 0,
		estimatedUsd: 0,
		pricingMode: "subscription",
	});
	assert.equal(line, "↳ 1.4k in · 5 out · subscription");
	assert.doesNotMatch(line, /\$0/);
});

test("formatUsage is empty for a null usage (nothing to show)", () => {
	assert.equal(formatUsage(null), "");
});
