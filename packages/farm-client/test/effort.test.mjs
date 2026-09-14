import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRespondEffort, parseBudgetDeclaration } from "../src/effort.mjs";

const fixed = {
	randomUUID: (() => {
		let n = 0;
		return () => `id-${++n}`;
	})(),
	now: () => new Date(0),
};

test("default route: no provider/model in args — the farm decides", () => {
	const effort = buildRespondEffort("oi", { ...fixed });
	assert.equal(effort.direction, "ask");
	assert.equal(effort.tasks[0].pluginId, "@refarm/agent");
	assert.equal(effort.tasks[0].fn, "respond");
	assert.deepEqual(effort.tasks[0].args, { prompt: "oi", history_turns: 0 });
	assert.equal("provider" in effort.tasks[0].args, false);
	assert.equal("model" in effort.tasks[0].args, false);
});

test("worker route: provider+model ride into args (the spark-quota path)", () => {
	const effort = buildRespondEffort("tarefa", {
		...fixed,
		provider: "openai-codex",
		model: "gpt-5.3-codex-spark",
	});
	assert.equal(effort.tasks[0].args.provider, "openai-codex");
	assert.equal(effort.tasks[0].args.model, "gpt-5.3-codex-spark");
});

test("historyTurns and source are honored", () => {
	const effort = buildRespondEffort("q", { ...fixed, historyTurns: 5, source: "worker-cli" });
	assert.equal(effort.tasks[0].args.history_turns, 5);
	assert.equal(effort.source, "worker-cli");
});

test("submittedAt is an ISO string from the injected clock", () => {
	const effort = buildRespondEffort("q", { ...fixed });
	assert.equal(effort.submittedAt, new Date(0).toISOString());
});

test("no budget declared ⇒ the effort carries no budget key at all (byte-identical to before)", () => {
	const effort = buildRespondEffort("oi", { ...fixed });
	assert.equal("budget" in effort, false);
	assert.equal(JSON.stringify(effort).includes("budget"), false);
});

test("a declared deadline rides the effort as budget.deadlineMs", () => {
	const effort = buildRespondEffort("oi", { ...fixed, deadlineMs: 120000 });
	assert.deepEqual(effort.budget, { deadlineMs: 120000 });
});

test("all three declared axes ride as one budget object", () => {
	const effort = buildRespondEffort("oi", {
		...fixed,
		deadlineMs: 120000,
		maxTokens: 50000,
		maxUsd: 2.5,
	});
	assert.deepEqual(effort.budget, { deadlineMs: 120000, maxTokens: 50000, maxUsd: 2.5 });
});

test("parseBudgetDeclaration: absent axes produce no key, never 0 or null", () => {
	const budget = parseBudgetDeclaration({ deadlineMs: 120000 });
	assert.deepEqual(budget, { deadlineMs: 120000 });
	assert.equal("maxTokens" in budget, false);
	assert.equal("maxUsd" in budget, false);
});

test("parseBudgetDeclaration: nothing declared returns undefined", () => {
	assert.equal(parseBudgetDeclaration({}), undefined);
	assert.equal(parseBudgetDeclaration(), undefined);
});

test("parseBudgetDeclaration: accepts a numeric string (the env-var shape)", () => {
	const budget = parseBudgetDeclaration({ maxTokens: "50000" });
	assert.deepEqual(budget, { maxTokens: 50000 });
});

test("parseBudgetDeclaration: accepts an explicit zero as a real ceiling", () => {
	const budget = parseBudgetDeclaration({ maxTokens: 0 });
	assert.deepEqual(budget, { maxTokens: 0 });
});

test("parseBudgetDeclaration: rejects a negative value, naming the field", () => {
	assert.throws(
		() => parseBudgetDeclaration({ deadlineMs: -1 }),
		/budget\.deadlineMs must not be negative, got -1/,
	);
});

test("parseBudgetDeclaration: rejects a non-numeric value, naming the field", () => {
	assert.throws(
		() => parseBudgetDeclaration({ maxUsd: "soon" }),
		/budget\.maxUsd must be a number, got "soon"/,
	);
});

test("parseBudgetDeclaration: rejects an empty string rather than reading it as zero", () => {
	assert.throws(
		() => parseBudgetDeclaration({ maxTokens: "  " }),
		/budget\.maxTokens must be a number, got an empty string/,
	);
});
