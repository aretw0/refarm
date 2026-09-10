import assert from "node:assert/strict";
import test from "node:test";

import {
	buildOperatorAttentionGateCommands,
	buildOperatorAttentionGateHandoff,
} from "./operator-state-bridge.mjs";

test("bridge exporta helpers do contrato de attention gate", () => {
	assert.equal(typeof buildOperatorAttentionGateCommands, "function");
	assert.equal(typeof buildOperatorAttentionGateHandoff, "function");

	const commands = buildOperatorAttentionGateCommands("bridge:test", 60000, {
		commandPrefix: "refarm operator attention",
	});
	assert.equal(
		commands.prepare,
		"refarm operator attention 'bridge:test' --prepare-only --window-ms 60000 --json",
	);

	const handoff = buildOperatorAttentionGateHandoff({
		scope: "bridge:test",
		armed: false,
		windowMs: 60000,
		expiresAt: null,
	});
	assert.equal(handoff.ok, false);
	assert.equal(handoff.nextCommands.length, 1);
});
