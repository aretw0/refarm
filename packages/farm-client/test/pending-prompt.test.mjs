import assert from "node:assert/strict";
import { test } from "node:test";

import {
	answerOutcomeLine,
	answerPath,
	classifyAnswerResponse,
	declaredPollIntervalMs,
	DEFAULT_POLL_INTERVAL_MS,
	describeDevice,
	idleLine,
	isExpired,
	MAX_POLL_INTERVAL_MS,
	nextPollDelayMs,
	KIT_UPDATE_COMMAND,
	promptHeaderLines,
	PROMPTS_PATH,
	wireRefusalLines,
	wireUnknownLine,
} from "../src/pending-prompt.mjs";
import { checkPendingPromptListWire, PENDING_PROMPT_WIRE } from "../vendor/prompt-contract-v1/dist/index.js";

test("the routes are the wire's, and an id with a slash cannot escape its path", () => {
	assert.equal(PROMPTS_PATH, "/prompts");
	assert.equal(answerPath("p-1"), "/prompts/p-1/answer");
	assert.equal(answerPath("../plugins/reload"), "/prompts/..%2Fplugins%2Freload/answer");
});

test("polling backs off from the declared interval and stops at the ceiling", () => {
	// Honest polling: a stated interval, then backoff — never as-fast-as-possible.
	assert.equal(nextPollDelayMs(0), DEFAULT_POLL_INTERVAL_MS);
	assert.equal(nextPollDelayMs(1), DEFAULT_POLL_INTERVAL_MS * 2);
	assert.equal(nextPollDelayMs(2), DEFAULT_POLL_INTERVAL_MS * 4);
	// It grows monotonically...
	let previous = 0;
	for (let round = 0; round <= 12; round++) {
		const delay = nextPollDelayMs(round);
		assert.ok(delay >= previous, `round ${round} must not poll sooner than round ${round - 1}`);
		previous = delay;
	}
	// ...and is capped, so a device left on the desk never becomes a hammer.
	assert.equal(nextPollDelayMs(50), MAX_POLL_INTERVAL_MS);
	assert.equal(nextPollDelayMs(1000), MAX_POLL_INTERVAL_MS);
});

test("a round that found something resets the backoff to the floor", () => {
	assert.equal(nextPollDelayMs(0, { base: 500 }), 500);
	assert.equal(nextPollDelayMs(-3), DEFAULT_POLL_INTERVAL_MS);
	assert.equal(nextPollDelayMs(Number.NaN), DEFAULT_POLL_INTERVAL_MS);
});

test("the node's declared interval is used, and a nonsense one is not", () => {
	assert.equal(declaredPollIntervalMs({ pollIntervalMs: 5000 }), 5000);
	assert.equal(declaredPollIntervalMs({ pollIntervalMs: 0 }), DEFAULT_POLL_INTERVAL_MS);
	assert.equal(declaredPollIntervalMs({ pollIntervalMs: "soon" }), DEFAULT_POLL_INTERVAL_MS);
	assert.equal(declaredPollIntervalMs({}), DEFAULT_POLL_INTERVAL_MS);
	assert.equal(declaredPollIntervalMs(null), DEFAULT_POLL_INTERVAL_MS);
});

test("every HTTP outcome becomes a distinct thing to say — and a 409 says WHO won", () => {
	assert.deepEqual(classifyAnswerResponse(200, { device: "pixel-7" }), {
		outcome: "answered",
		device: "pixel-7",
	});
	assert.deepEqual(classifyAnswerResponse(409, { device: " terminal", outcome: "abandoned", reason: "cancelled" }), {
		outcome: "already-settled",
		device: " terminal",
		settledAs: "abandoned",
		reason: "cancelled",
	});
	assert.equal(classifyAnswerResponse(400, { detail: "select expects…" }).outcome, "invalid");
	assert.equal(classifyAnswerResponse(404).outcome, "gone");
	assert.deepEqual(classifyAnswerResponse(503), { outcome: "error", status: 503 });
});

test("a lost race is explained, never dropped in silence", () => {
	// "The answer is no" and "I could not ask" are different answers, and a
	// caller told nothing learns only to retry harder.
	const answeredElsewhere = answerOutcomeLine(
		classifyAnswerResponse(409, { device: "pixel-7", outcome: "answered" }),
	);
	assert.match(answeredElsewhere, /pixel-7/);

	const cancelledAtDesk = answerOutcomeLine(
		classifyAnswerResponse(409, { device: " terminal", outcome: "abandoned", reason: "cancelled" }),
	);
	assert.match(cancelledAtDesk, /encerrada/);

	const expired = answerOutcomeLine(
		classifyAnswerResponse(409, { device: " terminal", outcome: "abandoned", reason: "expired" }),
	);
	assert.match(expired, /prazo/);

	assert.match(answerOutcomeLine(classifyAnswerResponse(404)), /foi embora/);
});

test("the block's reserved identities are rendered as places, not as device names", () => {
	// They begin with a space on purpose (a validated device label cannot), so
	// they must never be shown raw.
	assert.match(describeDevice(" terminal"), /terminal/);
	assert.doesNotMatch(describeDevice(" terminal"), /^ /);
	assert.match(describeDevice(" node-local"), /nó/);
	assert.equal(describeDevice("pixel-7"), "pixel-7");
});

test("the asker's deadline is shown, and an expired prompt is recognised", () => {
	const now = 1_000_000;
	assert.equal(isExpired({ expiresAt: now - 1 }, now), true);
	assert.equal(isExpired({ expiresAt: now + 1 }, now), false);
	// No deadline is not an expired deadline.
	assert.equal(isExpired({ expiresAt: null }, now), false);

	assert.equal(remainingOf({ expiresAt: now + 30_000 }, now), "30s restantes");
	assert.equal(remainingOf({ expiresAt: now + 300_000 }, now), "5min restantes");
	assert.equal(remainingOf({ expiresAt: now - 1 }, now), "prazo esgotado");
	assert.equal(remainingOf({ expiresAt: null }, now), null);
});

function remainingOf(pending, now) {
	// Exercised through the header builder's own helper, imported lazily so this
	// file states the public surface it depends on at the top.
	return promptHeaderLines(pending, { now }).find((l) => l.includes("⏳"))?.replace("  ⏳ ", "") ?? null;
}

test("a secret prompt's header WARNS that the answer will travel, before anyone types (P4)", () => {
	const now = 1_000_000;
	const secret = {
		prompt: { type: "secret", question: "Senha da VPN?" },
		answerTravels: true,
		asker: { command: "refarm connection up serpro-vpn", host: "serpro-1577853" },
		askedAt: now,
		expiresAt: null,
	};
	const lines = promptHeaderLines(secret, { now }).join("\n");
	assert.match(lines, /ATRAVESSA/);
	// And it offers the alternative, rather than only stating the risk.
	assert.match(lines, /responda no terminal/);
	assert.match(lines, /refarm connection up serpro-vpn/);
	assert.match(lines, /serpro-1577853/);
});

test("a non-secret prompt carries no scary warning it does not need", () => {
	const lines = promptHeaderLines(
		{
			prompt: { type: "text", question: "Nome?" },
			answerTravels: false,
			asker: { command: "refarm init" },
			askedAt: 0,
			expiresAt: null,
		},
		{ now: 0 },
	).join("\n");
	assert.doesNotMatch(lines, /ATRAVESSA/);
});

test("the idle line states the interval, so silence reads as calm and not as a hang", () => {
	assert.match(idleLine(4000), /4s/);
	assert.match(idleLine(4000), /Ctrl\+C/);
});

// ── The declared wire version: the words, and the command ─────────────────────
//
// The DECISION lives in the vendored block (one place, three clients). What lives
// here is what the operator reads, so it is asserted here — a refusal that does
// not name the fix is a refusal that leaves someone stuck.

test("a refusal names what is old, what is new, and the ONE command that fixes it", () => {
	const check = checkPendingPromptListWire({ wire: "pending-prompt.v2", prompts: [] });
	assert.equal(check.verdict, "incompatible");

	const lines = wireRefusalLines(check);
	const text = lines.join("\n");
	// What this kit speaks.
	assert.match(text, /este kit fala: pending-prompt\.v1/);
	// What the node speaks.
	assert.match(text, /o nó fala:\s+pending-prompt\.v2/);
	// The one command.
	assert.match(text, new RegExp(`Atualize o kit com: ${KIT_UPDATE_COMMAND}`));
	assert.equal(KIT_UPDATE_COMMAND, "farm-update");
	// And the way out that never depends on an update landing.
	assert.match(text, /responda no terminal que perguntou/);
	// Never a bare "something went wrong".
	assert.ok(lines.length >= 4);
});

test("the undeclared case is admitted and NAMED — it never passes as a checked version", () => {
	// The operator's currently-installed kit talking to a peer that predates the
	// declaration. Admitting it is deliberate: refusing would take a working device
	// off the air. Saying nothing would be a lie about what was verified.
	const check = checkPendingPromptListWire({ pollIntervalMs: 2000, prompts: [] });
	assert.equal(check.verdict, "unknown");
	assert.notEqual(check.verdict, "compatible");

	const line = wireUnknownLine(check);
	assert.match(line, /não declarou a versão do fio/);
	assert.match(line, new RegExp(PENDING_PROMPT_WIRE.replace(".", "\\.")));
	// It is a notice, not a refusal: no command to run, nothing to fix.
	assert.ok(!line.includes(KIT_UPDATE_COMMAND), line);
});

test("the envelope the node serves today is compatible — the shape the phone talks to now", () => {
	// Pinned as a literal: this is what `GET /prompts` returns on the operator's
	// node right now, and the check must keep saying yes to it.
	const live = { pollIntervalMs: 2000, prompts: [], wire: "pending-prompt.v1" };
	assert.equal(checkPendingPromptListWire(live).verdict, "compatible");
});
