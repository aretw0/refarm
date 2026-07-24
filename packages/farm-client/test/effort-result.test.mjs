import assert from "node:assert/strict";
import { test } from "node:test";
import {
	extractAnswer,
	humanizeAgentError,
	isSuccessEffort,
	isTerminalEffort,
} from "../src/effort-result.mjs";

test("isTerminalEffort covers stopped states, not running ones", () => {
	for (const s of ["done", "delivered", "partial", "failed", "timed-out", "cancelled"]) {
		assert.equal(isTerminalEffort(s), true, s);
	}
	assert.equal(isTerminalEffort("pending"), false);
	assert.equal(isTerminalEffort("in-progress"), false);
	assert.equal(isTerminalEffort(undefined), false);
});

test("isSuccessEffort separates answers from failures", () => {
	assert.equal(isSuccessEffort("done"), true);
	assert.equal(isSuccessEffort("partial"), true);
	assert.equal(isSuccessEffort("failed"), false);
	assert.equal(isSuccessEffort("cancelled"), false);
});

test("extractAnswer reads the real agent shape (results[].result.content)", () => {
	const result = {
		effortId: "e1",
		status: "done",
		results: [{ status: "ok", result: { content: "farm-ask vivo" } }],
	};
	assert.equal(extractAnswer(result), "farm-ask vivo");
});

test("extractAnswer tolerates string / text / message shapes", () => {
	assert.equal(extractAnswer({ results: [{ status: "ok", result: "olá" }] }), "olá");
	assert.equal(extractAnswer({ results: [{ status: "ok", result: { text: "t" } }] }), "t");
	assert.equal(extractAnswer({ results: [{ status: "ok", result: { message: "m" } }] }), "m");
});

test("extractAnswer prefers the ok task and surfaces errors", () => {
	const mixed = {
		results: [
			{ status: "error", error: "boom" },
			{ status: "ok", result: { content: "certo" } },
		],
	};
	assert.equal(extractAnswer(mixed), "certo");
	assert.equal(extractAnswer({ results: [{ status: "error", error: "boom" }] }), "⚠️ boom");
});

test("extractAnswer returns null when there is nothing to read", () => {
	assert.equal(extractAnswer({ results: [] }), null);
	assert.equal(extractAnswer({}), null);
});

test("humanizeAgentError turns a plan-gated model 400 into an actionable hint", () => {
	const raw =
		'[runtime-agent error] HTTP 400: {"detail":"The \'gpt-5.3-codex-spark\' model is not supported when using Codex with a ChatGPT account."}';
	const out = humanizeAgentError(raw);
	assert.match(out, /'gpt-5\.3-codex-spark'/); // model lifted from the message
	assert.match(out, /verifique seu plano/);
	assert.match(out, /gpt-5\.5/); // points at a working alternative
	assert.ok(out.includes(raw), "the original detail is preserved, never hidden");
});

test("humanizeAgentError is generic — no per-model table (a different gated model works too)", () => {
	const out = humanizeAgentError("The 'some-future-model' model is not supported for your plan");
	assert.match(out, /'some-future-model'/);
	assert.match(out, /não está disponível no seu plano/);
});

test("humanizeAgentError leaves an unrelated error as a plain warning", () => {
	assert.equal(humanizeAgentError("boom"), "⚠️ boom");
	assert.equal(humanizeAgentError("timed out after 45s"), "⚠️ timed out after 45s");
});
