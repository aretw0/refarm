import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRespondEffort } from "../src/effort.mjs";

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
