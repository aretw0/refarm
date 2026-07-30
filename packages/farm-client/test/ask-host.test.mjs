import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	ASK_HOST_PLACEHOLDER,
	ASK_HOST_QUESTION,
	askFarmHost,
	canAskOperator,
	cancellationExit,
	isOperatorCancellation,
	resolveFarmHost,
} from "../src/ask-host.mjs";
import { rememberedHostPath } from "../src/farm-host.mjs";
import { OperatorPromptCancelledError } from "../vendor/prompt-contract-v1.mjs";

/**
 * The kit ASKS instead of lecturing — and the guarantees around the asking are
 * what make that safe to ship: it asks once, it never asks a script, and a
 * cancelled prompt is a goodbye rather than a stack trace.
 */

async function withKitDir(run) {
	const dir = await mkdtemp(join(tmpdir(), "farm-kit-"));
	try {
		return await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** A channel that records what it was asked and answers from a queue — the
 *  block's own `createScriptedOperatorChannel` plus the recording the assertions
 *  need (that the operator saw the real question, not a paraphrase). */
function recordingChannel(answers) {
	const asked = [];
	const queue = [...answers];
	return {
		asked,
		async ask(prompt) {
			asked.push(prompt);
			if (queue.length === 0) throw new RangeError("no scripted answer left");
			return queue.shift();
		},
	};
}

const silent = () => {};

test("with no remembered host and a TTY, the kit asks and remembers it", async () => {
	await withKitDir(async (kitDir) => {
		const channel = recordingChannel(["serpro-1577853"]);
		const result = await askFarmHost({ kitDir, kitRootDir: kitDir, channel, tty: true, announce: silent });

		assert.deepEqual(result, { host: "serpro-1577853", asked: true });
		assert.equal(channel.asked.length, 1);
		assert.equal(channel.asked[0].type, "text");
		assert.equal(channel.asked[0].question, ASK_HOST_QUESTION);
		assert.equal(channel.asked[0].placeholder, ASK_HOST_PLACEHOLDER);
		assert.equal((await readFile(rememberedHostPath(kitDir), "utf8")).trim(), "serpro-1577853");
	});
});

test("a second run does not ask — the remembered farm answers first", async () => {
	await withKitDir(async (kitDir) => {
		const first = recordingChannel(["serpro-1577853"]);
		const up = async (host) => host === "serpro-1577853";

		const one = await resolveFarmHost({
			kitRootDir: kitDir,
			probe: up,
			channel: first,
			tty: true,
			announce: silent,
		});
		assert.deepEqual(one, { host: "serpro-1577853", source: "asked", asked: true });

		// Second run: same kit dir, a channel with NO answers queued. If the kit
		// asked again this would throw — that is the point of the empty queue.
		const second = recordingChannel([]);
		const two = await resolveFarmHost({
			kitRootDir: kitDir,
			probe: up,
			channel: second,
			tty: true,
			announce: silent,
		});
		assert.deepEqual(two, { host: "serpro-1577853", source: "remembered", asked: false });
		assert.deepEqual(second.asked, []);
	});
});

test("a known-but-unreachable farm is not re-interrogated", async () => {
	await withKitDir(async (kitDir) => {
		const channel = recordingChannel(["serpro-1577853"]);
		await askFarmHost({ kitRootDir: kitDir, channel, tty: true, announce: silent });

		// Nothing answers now. The NAME is known; only the reach is broken, which
		// is a different problem from not knowing the name — so: no second prompt.
		const mute = recordingChannel([]);
		const result = await resolveFarmHost({
			kitRootDir: kitDir,
			probe: async () => false,
			channel: mute,
			tty: true,
			announce: silent,
		});
		assert.deepEqual(result, { host: "serpro-1577853", source: "unreachable", asked: false });
		assert.deepEqual(mute.asked, []);
	});
});

test("without a TTY it NEVER prompts — a script gets the honest error path", async () => {
	await withKitDir(async (kitDir) => {
		const channel = recordingChannel(["should-never-be-used"]);
		const result = await resolveFarmHost({
			kitRootDir: kitDir,
			probe: async () => false,
			channel,
			tty: false,
			announce: silent,
		});

		assert.deepEqual(result, { host: "127.0.0.1", source: "unknown", asked: false });
		assert.deepEqual(channel.asked, [], "a script must never be prompted");
		// And nothing was remembered behind the script's back.
		await assert.rejects(() => readFile(rememberedHostPath(kitDir), "utf8"));
	});
});

test("askFarmHost without a TTY returns nothing and asks nothing", async () => {
	await withKitDir(async (kitDir) => {
		const channel = recordingChannel(["nope"]);
		const result = await askFarmHost({ kitRootDir: kitDir, channel, tty: false, announce: silent });
		assert.deepEqual(result, { host: null, asked: false });
		assert.deepEqual(channel.asked, []);
	});
});

test("canAskOperator requires a terminal on BOTH ends", () => {
	assert.equal(canAskOperator({ input: { isTTY: true }, output: { isTTY: true } }), true);
	assert.equal(canAskOperator({ input: { isTTY: false }, output: { isTTY: true } }), false);
	assert.equal(canAskOperator({ input: { isTTY: true }, output: { isTTY: false } }), false);
	assert.equal(canAskOperator({ input: {}, output: {} }), false);
});

test("a blank answer is not a host — nothing is remembered", async () => {
	await withKitDir(async (kitDir) => {
		const channel = recordingChannel(["   "]);
		const result = await askFarmHost({ kitRootDir: kitDir, channel, tty: true, announce: silent });
		assert.deepEqual(result, { host: null, asked: true });
		await assert.rejects(() => readFile(rememberedHostPath(kitDir), "utf8"));
	});
});

test("the answer is trimmed before it is remembered", async () => {
	await withKitDir(async (kitDir) => {
		const channel = recordingChannel(["  serpro-1577853  "]);
		const result = await askFarmHost({ kitRootDir: kitDir, channel, tty: true, announce: silent });
		assert.equal(result.host, "serpro-1577853");
		assert.equal((await readFile(rememberedHostPath(kitDir), "utf8")).trim(), "serpro-1577853");
	});
});

test("cancelling the prompt rejects with the block's error — and the kit exits gracefully", async () => {
	await withKitDir(async (kitDir) => {
		const channel = {
			async ask() {
				throw new OperatorPromptCancelledError();
			},
		};
		const error = await askFarmHost({ kitRootDir: kitDir, channel, tty: true, announce: silent }).then(
			() => null,
			(err) => err,
		);
		assert.ok(error instanceof OperatorPromptCancelledError);
		assert.equal(isOperatorCancellation(error), true);

		// The kit's answer to it: one line, SIGINT's exit code, no stack trace.
		const written = [];
		const code = cancellationExit(error, { write: (s) => written.push(s) });
		assert.equal(code, 130);
		assert.equal(written.join("").includes("cancelado"), true);
		assert.equal(
			written.join("").includes("OperatorPromptCancelledError"),
			false,
			"the operator must never be shown the error class, let alone a stack",
		);
	});
});

test("a real failure is NOT swallowed as a cancellation", () => {
	const written = [];
	assert.equal(cancellationExit(new Error("disk on fire"), { write: (s) => written.push(s) }), null);
	assert.deepEqual(written, []);
	assert.equal(isOperatorCancellation(new Error("disk on fire")), false);
});

test("a cancellation from another copy of the block is still recognised by name", () => {
	const foreign = Object.assign(new Error("Operator prompt cancelled"), {
		name: "OperatorPromptCancelledError",
	});
	assert.equal(isOperatorCancellation(foreign), true);
	assert.equal(cancellationExit(foreign, { write: () => {} }), 130);
});

test("the ladder prefers explicit, then remembered, then tailnet, then localhost", async () => {
	await withKitDir(async (kitDir) => {
		const never = recordingChannel([]);
		const opts = { kitRootDir: kitDir, channel: never, tty: true, announce: silent };

		assert.deepEqual(await resolveFarmHost({ ...opts, explicit: "given", probe: async () => true }), {
			host: "given",
			source: "explicit",
			asked: false,
		});

		assert.deepEqual(
			await resolveFarmHost({
				...opts,
				probe: async (h) => h === "100.64.0.9",
				peers: async () => ["100.64.0.1", "100.64.0.9"],
			}),
			{ host: "100.64.0.9", source: "tailnet", asked: false },
		);

		assert.deepEqual(await resolveFarmHost({ ...opts, probe: async (h) => h === "127.0.0.1" }), {
			host: "127.0.0.1",
			source: "fallback",
			asked: false,
		});

		assert.deepEqual(never.asked, [], "a farm that answered is never a reason to ask");
	});
});

test("the question names the farm and offers a concrete example", () => {
	// The wording is the deliverable — the operator asked for an ask, not a lecture.
	assert.equal(ASK_HOST_QUESTION, "Como se chama a sua fazenda?");
	assert.equal(ASK_HOST_PLACEHOLDER, "nome MagicDNS, ex.: serpro-1577853");
	assert.ok(ASK_HOST_QUESTION.endsWith("?"), "it must be a question");
});
