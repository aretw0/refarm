import assert from "node:assert/strict";
import { test } from "node:test";

import {
	byNameLines,
	classifySidecarProbe,
	daemonWsExposureLines,
	planTailnetReach,
	sidecarExposureLines,
	sidecarProbeFailureLines,
} from "../src/reach.mjs";

const SELF = "node bin/farm-hello.mjs";

/** Every line of a plan, joined — what the operator actually reads. */
function shown(plan) {
	return plan.lines.join("\n");
}

/** The five reasons `tailnetPeersReport` can return, as it returns them. */
const couldNotAsk = (reason, detail) => ({ ok: false, reason, peers: [], detail });

test("HTTP auth refusal proves reachability without pretending the sidecar is usable", () => {
	assert.deepEqual(classifySidecarProbe(200), { reachable: true, usable: true, reason: "ready" });
	assert.deepEqual(classifySidecarProbe(401), {
		reachable: true,
		usable: false,
		reason: "credential-required",
	});
	assert.deepEqual(classifySidecarProbe(null), {
		reachable: false,
		usable: false,
		reason: "unreachable",
	});
	const text = sidecarProbeFailureLines(
		{ ...classifySidecarProbe(401), status: 401 },
		"http://farm:42001",
	).join("\n");
	assert.match(text, /alcançável/);
	assert.match(text, /HTTP 401/);
	assert.match(text, /FARM_TOKEN presente/);
	assert.doesNotMatch(text, /superfície não se abre/);
});

// ── The ordering change ───────────────────────────────────────────────────────
// The operator's phone broadcast to 255.255.255.255, to a multicast group, to its
// OWN tailnet IP and to the LAN, then swept 253 addresses — and never once tried
// the host by name, even though the `tailscale` CLI does not exist in Termux at
// all (Android runs the app). These tests pin the fix.

test("enumeration unavailable: the host's NAME is offered before anything else", () => {
	const plan = planTailnetReach(couldNotAsk("cli-missing", "the `tailscale` CLI is not on PATH"), {
		self: SELF,
	});

	assert.equal(plan.askedTailnet, false);
	assert.equal(plan.suggestByName, true);
	// MUTATION GUARD on the ORDER: it is not enough that the name is mentioned —
	// it was already mentioned before this change, last, after the sweep. What is
	// being asserted is that it comes FIRST among the things offered. Move the
	// by-name block after any other suggestion and this fails.
	const text = shown(plan);
	const nameAt = text.indexOf("NOME do host");
	const sweepAt = text.indexOf("varro a sub-rede");
	assert.ok(nameAt > 0, "the by-name form must be offered");
	assert.ok(sweepAt > 0, "the plan must say what it will NOT do");
	assert.ok(nameAt < sweepAt, "the by-name form must come BEFORE anything about sweeping");
	// And it is the very first suggestion in the block — only the "why" precedes it.
	const suggestionLines = plan.lines.filter((line) => line.includes(SELF));
	assert.ok(suggestionLines.length > 0);
	assert.equal(plan.lines.indexOf(suggestionLines[0]), 3);
});

test("enumeration unavailable: the 253-address sweep is NOT started", () => {
	for (const reason of ["cli-missing", "query-failed", "bad-output"]) {
		const plan = planTailnetReach(couldNotAsk(reason, "boom"), { self: SELF });
		assert.equal(plan.sweepSubnet, false, `${reason} must not authorise a subnet sweep`);
		assert.equal(plan.suggestByName, true, `${reason} must offer the by-name form`);
		assert.deepEqual(plan.peers, []);
	}
});

test("`no-peers` is NOT `could not ask` — the tailnet answered, so the LAN dialects follow", () => {
	const plan = planTailnetReach({ ok: true, reason: "no-peers", peers: [], detail: null }, {
		self: SELF,
	});

	// MUTATION GUARD on the distinction itself: collapse `no-peers` into the
	// could-not-ask branch (the bug this fixes, in reverse) and both of these flip.
	assert.equal(plan.askedTailnet, true);
	assert.equal(plan.sweepSubnet, true, "a complete answer earns the full ladder");
	assert.equal(plan.suggestByName, false, "nothing to work around — the question was answered");
	assert.match(shown(plan), /A tailnet respondeu/);
});

test("peers found: they are handed back to probe, and the ladder stays open", () => {
	const peers = [
		{ name: "serpro-1577853", ip: "100.105.71.127" },
		{ name: "phone", ip: "100.88.1.2" },
	];
	const plan = planTailnetReach({ ok: true, reason: "peers", peers, detail: null }, { self: SELF });

	assert.deepEqual(plan.peers, peers);
	assert.equal(plan.askedTailnet, true);
	assert.equal(plan.suggestByName, false);
	assert.equal(plan.sweepSubnet, true);
	assert.match(shown(plan), /testando 2 peer\(s\)/);
});

test("`peers` with an empty list degrades to the answered-but-empty branch, never to a scan", () => {
	// Defensive: a report claiming `peers` while carrying none is not a licence to
	// treat the tailnet as unaskable — it ANSWERED.
	const plan = planTailnetReach({ ok: true, reason: "peers", peers: [], detail: null });
	assert.equal(plan.askedTailnet, true);
	assert.equal(plan.suggestByName, false);
});

test("a missing/garbage report is treated as could-not-ask, not as an empty tailnet", () => {
	for (const report of [undefined, null, {}, { reason: 42 }]) {
		const plan = planTailnetReach(report, { self: SELF });
		assert.equal(plan.askedTailnet, false);
		assert.equal(plan.suggestByName, true);
		assert.equal(plan.sweepSubnet, false);
	}
});

test("cli-missing says WHY in terms the device can act on — the app is not the CLI", () => {
	const plan = planTailnetReach(couldNotAsk("cli-missing", "the `tailscale` CLI is not on PATH"), {
		self: SELF,
	});
	const text = shown(plan);
	assert.match(text, /Não consegui PERGUNTAR à tailnet/);
	// The structural fact: on Android there is no CLI to install, so the message
	// must not send the operator looking for one.
	assert.match(text, /no Android roda o app, não a CLI/);
});

test("query-failed and bad-output carry the report's own detail, not a generic line", () => {
	const failed = planTailnetReach(
		couldNotAsk("query-failed", "Command failed: failed to connect to local tailscaled"),
		{ self: SELF },
	);
	assert.match(shown(failed), /failed to connect to local tailscaled/);

	const bad = planTailnetReach(couldNotAsk("bad-output", "printed JSON that is not a status"), {
		self: SELF,
	});
	assert.match(shown(bad), /printed JSON that is not a status/);
});

test("suggested commands are copyable as-is — the real invocation, never `.../`", () => {
	const self = "node /data/data/com.termux/files/home/.refarm/kit/farm-client/bin/farm-hello.mjs";
	const lines = byNameLines(self);
	assert.ok(lines.some((line) => line.includes(`${self} <nome-do-host>`)));
	assert.ok(lines.some((line) => line.includes(`FARM_HOST=<nome-do-host> ${self}`)));
	for (const line of lines) assert.ok(!line.includes("..."), `elided path in: ${line}`);
});

// ── The guidance that was stale, and the one line that was dangerous ──────────

test("the sidecar advice DECLARES a surface — it never tells anyone to bind 0.0.0.0", () => {
	const text = sidecarExposureLines().join("\n");

	// The dangerous line, gone: routing around the declaration is the exact footgun
	// `surfaces` exists to remove.
	assert.ok(!text.includes("0.0.0.0"), "must never suggest binding every interface");
	assert.ok(!text.includes("REFARM_HTTP_HOST"), "must not suggest overriding the declaration");
	assert.ok(!text.includes("tractor-start.sh"), "must not route around the declaration");

	// The declaration, in the real vocabulary of the design.
	assert.match(text, /"sidecar-http": \{ "expose": "tailnet", "gate": "device-token" \}/);
	assert.match(text, /"loopback" \| "host:<ip>" \| "tailnet"/);
	assert.match(text, /\.refarm\/config\.json/);
	// A declaration alone is not reach: the device also needs a credential.
	assert.match(text, /refarm auth enroll/);
	assert.match(text, /FARM_TOKEN/);
});

test("the sidecar advice can name any legal expose value", () => {
	const text = sidecarExposureLines({ expose: "host:100.105.71.127" }).join("\n");
	assert.match(text, /"expose": "host:100\.105\.71\.127"/);
});

test("the WS advice states what is TRUE today: loopback by default, authenticated front", () => {
	const text = daemonWsExposureLines().join("\n");

	// The false claim, gone in both its historical spellings.
	assert.ok(!text.includes("0.0.0.0"), "the WS does not listen on 0.0.0.0");
	assert.ok(
		!/ainda não existe/.test(text),
		"ADR-093 shipped — the handshake exists and this must not deny it",
	);

	assert.match(text, /LOOPBACK/);
	assert.match(text, /"daemon-ws": \{ "expose": "host:<ip>", "gate": "device-token" \}/);
	assert.match(text, /bearer\.<token>/);
	assert.match(text, /ADR-093/);
});
