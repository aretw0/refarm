// The reference vault:v1 surface, as the JS entry that `jco componentize` compiles
// into a `vault-surface` WASM component. The world imports NOTHING, so this is
// pure compute over the (verb, note, profile) the host hands it — that absence IS
// the sandbox. The dispatch logic lives in run-core.js (shared with plugin.js so
// the sandbox proof and the runtime plugin can never diverge).
//
// WIT ⇄ JS mapping (jco): interface `surface` → `export const surface`; func `run`
// → `run(verb, note, profile)`; kebab fields camelCased (rule-id → ruleId); the
// `record-json` extract output carries the KnowledgeRecord as a JSON string.

import { runVault } from "./run-core.js";

export const surface = {
	run(verb, note, profile) {
		return runVault(verb, note, profile);
	},
};
