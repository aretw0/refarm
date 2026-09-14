import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createInMemoryEventBus } from "./in-memory.js";
import {
	ABSENT,
	AUTH_ACCEPTED,
	AUTH_AUTHENTICATION_FAILED,
	AUTH_AUTHORIZATION_REFUSED,
	AUTH_CREDENTIAL_EXPIRED,
	AUTH_RATE_LIMIT_ENGAGED,
	SECURITY_EVENT_CHANNEL,
	SECURITY_EVENT_NAMES,
	SECURITY_EVENT_PREFIX,
	onAnySecurityEvent,
	onSecurityEvent,
	parseSecurityEventLine,
	publishSecurityEventLines,
	securityResponseFor,
	type SecurityEventLine,
} from "./security.js";

/**
 * THE shared wire fixture: one line per fact, in the exact bytes the Rust gate writes.
 * `packages/tractor/src/sidecar/auth.rs`'s `the_wire_lines_are_exactly_what_the_shared_fixture_pins`
 * asserts the same file from the producing side. Neither runtime can rename a field or an
 * event without the other's suite going red — which is what makes "one vocabulary, two
 * runtimes" a fact rather than an intention.
 */
const WIRE = readFileSync(
	fileURLToPath(new URL("../security-events.fixture.ndjson", import.meta.url)),
	"utf8",
);

describe("the vocabulary", () => {
	it("names every fact in one namespace", () => {
		expect(SECURITY_EVENT_NAMES).toEqual([
			"auth:accepted",
			"auth:authentication-failed",
			"auth:authorization-refused",
			"auth:credential-expired",
			"auth:rate-limit-engaged",
		]);
		for (const name of SECURITY_EVENT_NAMES) {
			expect(name.startsWith(SECURITY_EVENT_PREFIX)).toBe(true);
		}
	});

	it("parses every line the gate writes, and types each one", () => {
		const parsed = WIRE.split("\n")
			.filter((line) => line.trim() !== "")
			.map((line) => parseSecurityEventLine(line));

		expect(parsed.every((event) => event !== null)).toBe(true);
		expect(parsed.map((event) => event?.event)).toEqual([
			AUTH_ACCEPTED,
			AUTH_ACCEPTED,
			AUTH_AUTHENTICATION_FAILED,
			AUTH_AUTHORIZATION_REFUSED,
			AUTH_CREDENTIAL_EXPIRED,
			AUTH_RATE_LIMIT_ENGAGED,
			AUTH_RATE_LIMIT_ENGAGED,
		]);
		// The one fact that is NOT derivable from the event name.
		expect(parsed.map((event) => event?.budget)).toEqual([
			ABSENT,
			ABSENT,
			"authentication",
			"authorization",
			"authorization",
			"authentication",
			"authorization",
		]);
	});

	it("refuses a line that is not one of ours rather than throwing", () => {
		// The trail is shared: `agent:*` and `host-effect:*` lines sit in the same file.
		expect(parseSecurityEventLine('{"event":"agent:iteration","ts":1}')).toBeNull();
		expect(parseSecurityEventLine("not json at all")).toBeNull();
		expect(parseSecurityEventLine("")).toBeNull();
		// A well-formed line with a budget outside the vocabulary is not a security event.
		expect(
			parseSecurityEventLine(
				'{"ts":1,"event":"auth:accepted","outcome":"accepted","budget":"whatever",' +
					'"identity":"-","credential":"-","scope":"-","method":"GET"}',
			),
		).toBeNull();
	});

	it("carries no credential material, over every line the gate can write", () => {
		// Mutation guard: the rule is asserted over the FIXTURE, so a field added on the Rust
		// side that carried a digest would land here and fail. A hex run of 16+ characters is
		// the shape of a hash, truncated or whole.
		expect(WIRE).not.toMatch(/[0-9a-f]{16,}/);
		for (const line of WIRE.split("\n").filter((l) => l.trim() !== "")) {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			expect(Object.keys(parsed).sort()).toEqual([
				"budget",
				"credential",
				"event",
				"identity",
				"method",
				"outcome",
				"scope",
				"ts",
			]);
			for (const key of Object.keys(parsed)) {
				expect(key.toLowerCase()).not.toMatch(/token|hash|digest|secret|sha/);
			}
		}
	});
});

describe("a plugin composing on the bus", () => {
	/**
	 * THE DX test. A plugin subscribes and tells an attack from a scope bug from an expiry —
	 * without parsing an HTTP status code (they are identical for all three, on purpose) and
	 * without reading log prose.
	 */
	it("tells attack from scope bug from expiry by subscription alone", () => {
		const bus = createInMemoryEventBus();

		const attacks: SecurityEventLine[] = [];
		const callerBugs: SecurityEventLine[] = [];
		const expiries: SecurityEventLine[] = [];

		// This is the whole plugin. Three lines, no casts, no status codes, no grep.
		onSecurityEvent(bus, AUTH_AUTHENTICATION_FAILED, (event) => attacks.push(event));
		onSecurityEvent(bus, AUTH_AUTHORIZATION_REFUSED, (event) => callerBugs.push(event));
		onSecurityEvent(bus, AUTH_CREDENTIAL_EXPIRED, (event) => expiries.push(event));

		expect(publishSecurityEventLines(bus, WIRE)).toBe(7);

		expect(attacks).toHaveLength(1);
		expect(callerBugs).toHaveLength(1);
		expect(expiries).toHaveLength(1);

		// And each carries what it needs to ACT on. The scope bug names the caller — the gate
		// resolved that identity from a credential that verified — so a plugin can tell the
		// team whose app is misrouting.
		expect(callerBugs[0]?.identity).toBe("id-browser");
		expect(callerBugs[0]?.credential).toBe("scoped");
		expect(callerBugs[0]?.budget).toBe("authorization");
		// The attack names nobody, because a token matching nothing resolves to nobody — which
		// is also why this event can never be used to name a victim.
		expect(attacks[0]?.identity).toBe(ABSENT);
		expect(attacks[0]?.budget).toBe("authentication");
		expect(expiries[0]?.identity).toBe("id-browser");
	});

	it("routes the whole family on one channel for a dashboard", () => {
		const bus = createInMemoryEventBus();
		const seen: string[] = [];
		onAnySecurityEvent(bus, (event) => seen.push(event.event));
		publishSecurityEventLines(bus, WIRE);
		expect(seen).toHaveLength(7);
		expect(new Set(seen)).toEqual(new Set(SECURITY_EVENT_NAMES));
	});

	it("does not deliver a security event to an unrelated channel", () => {
		const bus = createInMemoryEventBus();
		const unrelated = vi.fn();
		bus.on("agent:iteration", unrelated);
		bus.on(SECURITY_EVENT_CHANNEL, () => {});
		publishSecurityEventLines(bus, WIRE);
		expect(unrelated).not.toHaveBeenCalled();
	});

	it("tells a throttled attacker from a throttled misconfigured app", () => {
		// The two `auth:rate-limit-engaged` lines are the same event name and mean opposite
		// things. A consumer reading only the name would call a misconfigured app an attacker
		// — the exact mistake this whole change exists to stop — so `budget` decides.
		const limits = WIRE.split("\n")
			.map((line) => parseSecurityEventLine(line))
			.filter((event): event is SecurityEventLine => event?.event === AUTH_RATE_LIMIT_ENGAGED);

		expect(limits).toHaveLength(2);
		expect(limits.map(securityResponseFor)).toEqual(["hostile", "caller-bug"]);
	});

	it("answers what to do for every fact in the vocabulary", () => {
		const responses = WIRE.split("\n")
			.map((line) => parseSecurityEventLine(line))
			.filter((event): event is SecurityEventLine => event !== null)
			.map(securityResponseFor);
		expect(responses).toEqual([
			"none",
			"none",
			"hostile",
			"caller-bug",
			"expired",
			"hostile",
			"caller-bug",
		]);
	});
});
