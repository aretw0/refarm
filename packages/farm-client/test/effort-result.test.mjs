import assert from "node:assert/strict";
import { test } from "node:test";
import {
	extractAnswer,
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
