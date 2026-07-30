import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	createScriptedOperatorChannel,
	OperatorPromptCancelledError,
	type OperatorChannel,
	type OperatorPrompt,
	type SelectPrompt,
} from "@refarm.dev/prompt-contract-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthPolicyFile } from "./auth.js";
import {
	createAuthEnrollCommand,
	promptForIdentity,
	sha256Hex,
	upsertCredential,
	validateIdentityLabel,
} from "./auth.js";
import {
	collectIdentityCandidates,
	sanitiseIdentityLabel,
	type IdentityCandidate,
	type IdentityCandidateSource,
} from "./identity-candidates.js";
import {
	createTailnetIdentitySource,
	declaresTailnetSurface,
	reportToCandidates,
} from "./identity-source-tailnet.js";
import { defaultIdentityCandidateSources } from "./identity-sources.js";

describe("refarm auth — credential policy", () => {
	it("sha256Hex matches the digest the daemon stores (lowercase hex)", () => {
		// Known vector: sha256("test-device-token")
		expect(sha256Hex("test-device-token")).toMatch(/^[0-9a-f]{64}$/);
		expect(sha256Hex("a")).toBe(sha256Hex("a"));
		expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
	});

	it("upsertCredential adds a new identity without touching others", () => {
		const policy: AuthPolicyFile = { credentials: [{ identity: "spouse", tokenSha256: "s" }] };
		const next = upsertCredential(policy, "arthur", "a", false);
		expect(next.credentials).toEqual([
			{ identity: "spouse", tokenSha256: "s" },
			{ identity: "arthur", tokenSha256: "a" },
		]);
		// pure — original untouched
		expect(policy.credentials).toHaveLength(1);
	});

	it("upsertCredential refuses to clobber an enrolled identity without --rotate", () => {
		const policy: AuthPolicyFile = { credentials: [{ identity: "arthur", tokenSha256: "old" }] };
		expect(() => upsertCredential(policy, "arthur", "new", false)).toThrow(/already enrolled/);
	});

	it("upsertCredential rotates an existing identity's token when asked", () => {
		const policy: AuthPolicyFile = { credentials: [{ identity: "arthur", tokenSha256: "old" }] };
		const next = upsertCredential(policy, "arthur", "new", true);
		expect(next.credentials).toEqual([{ identity: "arthur", tokenSha256: "new" }]);
	});

	it("preserves Slice-2 fields (workspaces/memberships) verbatim", () => {
		const policy: AuthPolicyFile = {
			credentials: [],
			workspaces: [{ id: "personal-arthur", kind: "personal", namespace: "personal-arthur" }],
		};
		const next = upsertCredential(policy, "arthur", "a", false);
		expect(next.workspaces).toEqual(policy.workspaces);
	});
});

describe("validateIdentityLabel", () => {
	it("trims surrounding whitespace", () => {
		expect(validateIdentityLabel("  arthur-phone  ")).toBe("arthur-phone");
	});

	it("rejects an empty (or whitespace-only) label", () => {
		expect(() => validateIdentityLabel("")).toThrow(/must not be empty/);
		expect(() => validateIdentityLabel("   ")).toThrow(/must not be empty/);
	});

	it("rejects a label containing control characters", () => {
		expect(() => validateIdentityLabel("arthurphone")).toThrow(/control characters/);
		expect(() => validateIdentityLabel("arthur\nphone")).toThrow(/control characters/);
	});
});

describe("promptForIdentity", () => {
	it("goes straight to a text prompt when no identity is enrolled yet", async () => {
		const operator = createScriptedOperatorChannel(["arthur-phone"]);
		const result = await promptForIdentity(operator, []);
		expect(result).toEqual({ identity: "arthur-phone", impliedRotate: false });
	});

	it("choosing an already-enrolled identity implies rotation", async () => {
		const operator = createScriptedOperatorChannel(["arthur"]);
		const result = await promptForIdentity(operator, ["arthur", "spouse"]);
		expect(result).toEqual({ identity: "arthur", impliedRotate: true });
	});

	it("choosing 'a new device' leads to a text prompt for the new label", async () => {
		const operator = createScriptedOperatorChannel([" new-device", "arthur-tablet"]);
		const result = await promptForIdentity(operator, ["arthur"]);
		expect(result).toEqual({ identity: "arthur-tablet", impliedRotate: false });
	});

	it("with zero contributed candidates the prompt is byte-identical to the canonical one", async () => {
		// Same two shapes as above, but with the seam's parameter explicitly empty:
		// the extension must be invisible when nothing plugged in.
		const bare = recordingOperator(["arthur-phone"]);
		expect(await promptForIdentity(bare.operator, [], [])).toEqual({
			identity: "arthur-phone",
			impliedRotate: false,
		});
		expect(bare.prompts.map((p) => p.type)).toEqual(["text"]);

		const populated = recordingOperator(["arthur"]);
		expect(await promptForIdentity(populated.operator, ["arthur", "spouse"], [])).toEqual({
			identity: "arthur",
			impliedRotate: true,
		});
		expect(selectPrompt(populated.prompts).options).toEqual([
			{ value: "arthur", label: "arthur", description: "rotate its token" },
			{ value: "spouse", label: "spouse", description: "rotate its token" },
			{ value: " new-device", label: "A new device", description: "enroll a new identity" },
		]);
	});

	it("a contributed candidate is offered by name, and 'A new device' is still last", async () => {
		const { operator, prompts } = recordingOperator(["meu-android"]);
		const result = await promptForIdentity(
			operator,
			[],
			[{ value: "meu-android", label: "meu-android", description: "on your tailnet" }],
		);
		expect(result).toEqual({ identity: "meu-android", impliedRotate: false });
		expect(selectPrompt(prompts).options).toEqual([
			{ value: "meu-android", label: "meu-android", description: "on your tailnet — enroll it" },
			{ value: " new-device", label: "A new device", description: "enroll a new identity" },
		]);
	});

	it("a contributed candidate that is already enrolled appears once, as a rotate", async () => {
		const { operator, prompts } = recordingOperator(["meu-android"]);
		const result = await promptForIdentity(
			operator,
			["meu-android"],
			[
				{ value: "meu-android", label: "meu-android", description: "on your tailnet" },
				{ value: "raspberry", label: "raspberry", description: "on your tailnet" },
			],
		);
		expect(result).toEqual({ identity: "meu-android", impliedRotate: true });
		const values = selectPrompt(prompts).options.map((o) => o.value);
		expect(values).toEqual(["meu-android", "raspberry", " new-device"]);
		expect(values.filter((v) => v === "meu-android")).toHaveLength(1);
		expect(selectPrompt(prompts).options[0]?.description).toBe(
			"on your tailnet — rotate its token",
		);
	});

	it("a repaired candidate name is offered for confirmation, never enrolled silently", async () => {
		const { operator, prompts } = recordingOperator(["myphone", "myphone-edited"]);
		const result = await promptForIdentity(
			operator,
			[],
			[
				{
					value: "myphone",
					label: "myphone",
					description: "on your tailnet, name adjusted",
					needsConfirmation: true,
					rawName: "myphone",
				},
			],
		);
		// The operator EDITED the offer — what they typed is what gets enrolled.
		expect(result).toEqual({ identity: "myphone-edited", impliedRotate: false });
		const text = prompts.find((p) => p.type === "text");
		expect(text).toBeDefined();
		expect(text?.type === "text" && text.default).toBe("myphone");
		expect(text?.question).toContain("accept or edit");
	});
});

// ── The candidate seam (source-agnostic) ─────────────────────────────────────

describe("collectIdentityCandidates", () => {
	function fixedSource(
		id: string,
		report: {
			candidates: IdentityCandidate[];
			notices: string[];
		},
	): IdentityCandidateSource {
		return { id, collect: async () => report };
	}

	it("merges candidates and notices across sources, in order", async () => {
		const merged = await collectIdentityCandidates([
			fixedSource("a", { candidates: [{ value: "one", label: "one" }], notices: ["from a"] }),
			fixedSource("b", { candidates: [{ value: "two", label: "two" }], notices: ["from b"] }),
		]);
		expect(merged.candidates.map((c) => c.value)).toEqual(["one", "two"]);
		expect(merged.notices).toEqual(["from a", "from b"]);
	});

	it("never shows one device twice — first source to claim a label keeps it", async () => {
		const merged = await collectIdentityCandidates([
			fixedSource("a", { candidates: [{ value: "dup", label: "from-a" }], notices: [] }),
			fixedSource("b", { candidates: [{ value: "dup", label: "from-b" }], notices: [] }),
		]);
		expect(merged.candidates).toEqual([{ value: "dup", label: "from-a" }]);
	});

	it("a source that throws becomes a notice, never a failed enrolment", async () => {
		const merged = await collectIdentityCandidates([
			{
				id: "broken",
				collect: async () => {
					throw new Error("kaboom");
				},
			},
			fixedSource("ok", { candidates: [{ value: "one", label: "one" }], notices: [] }),
		]);
		expect(merged.candidates.map((c) => c.value)).toEqual(["one"]);
		expect(merged.notices[0]).toMatch(/Could not ask "broken".*kaboom/);
	});
});

describe("sanitiseIdentityLabel", () => {
	it("drops control characters and trims, or gives up honestly", () => {
		expect(sanitiseIdentityLabel("myphone")).toBe("myphone");
		expect(sanitiseIdentityLabel("  spaced  ")).toBe("spaced");
		expect(sanitiseIdentityLabel("")).toBeNull();
		expect(sanitiseIdentityLabel("   ")).toBeNull();
	});
});

// ── C3: the gate is the declaration, never detection ─────────────────────────

describe("declaresTailnetSurface", () => {
	it("is true only when a surface declares expose: tailnet", () => {
		expect(
			declaresTailnetSurface({
				surfaces: { "sidecar-http": { expose: "tailnet", gate: "device-token" } },
			}),
		).toBe(true);
		// Any surface name answers the question — including one Rust does not read yet.
		expect(declaresTailnetSurface({ surfaces: { web: { expose: "tailnet" } } })).toBe(true);
	});

	it("is false for everything else — silence is closed, not an invitation", () => {
		expect(declaresTailnetSurface(null)).toBe(false);
		expect(declaresTailnetSurface({})).toBe(false);
		expect(declaresTailnetSurface({ surfaces: {} })).toBe(false);
		expect(declaresTailnetSurface({ surfaces: [] })).toBe(false);
		expect(declaresTailnetSurface({ surfaces: "tailnet" })).toBe(false);
		expect(
			declaresTailnetSurface({
				surfaces: { "sidecar-http": { expose: "loopback" }, "daemon-ws": { expose: "loopback" } },
			}),
		).toBe(false);
		expect(
			declaresTailnetSurface({ surfaces: { "sidecar-http": { expose: "host:10.0.0.2" } } }),
		).toBe(false);
		// The word appearing anywhere else in the config is not a declaration.
		expect(declaresTailnetSurface({ tailnet: true, connections: { tailnet: {} } })).toBe(false);
	});
});

describe("the tailnet identity source — C3", () => {
	it("NEVER invokes `tailscale` when no surface declares it", async () => {
		const calls: string[][] = [];
		const run = async (args: string[]) => {
			calls.push(args);
			return statusWith({ k: tailnetPeerJson("meu-android", "meu-android.tail1.ts.net.") });
		};
		for (const config of [
			null,
			{},
			{ surfaces: {} },
			{ surfaces: { "sidecar-http": { expose: "loopback" }, "daemon-ws": { expose: "loopback" } } },
			{ surfaces: { "sidecar-http": { expose: "host:100.64.0.1", gate: "device-token" } } },
		]) {
			const source = createTailnetIdentitySource({ loadConfig: () => config, run });
			await expect(source.collect()).resolves.toEqual({ candidates: [], notices: [] });
		}
		// The teeth: not one spawn, on a machine that may well have Tailscale running.
		expect(calls).toEqual([]);
	});

	it("a config reader that throws closes the gate rather than opening it", async () => {
		const calls: string[][] = [];
		const source = createTailnetIdentitySource({
			loadConfig: () => {
				throw new Error("unreadable");
			},
			run: async (args) => {
				calls.push(args);
				return "{}";
			},
		});
		await expect(source.collect()).resolves.toEqual({ candidates: [], notices: [] });
		expect(calls).toEqual([]);
	});

	it("queries only once the declaration is present", async () => {
		const calls: string[][] = [];
		const source = createTailnetIdentitySource({
			loadConfig: () => DECLARED_TAILNET,
			run: async (args) => {
				calls.push(args);
				return statusWith({ k: tailnetPeerJson("meu-android", "meu-android.tail1.ts.net.") });
			},
		});
		const report = await source.collect();
		expect(calls).toEqual([["status", "--json"]]);
		expect(report.candidates.map((c) => c.value)).toEqual(["meu-android"]);
		expect(report.notices).toEqual([]);
	});

	it("prefers the short MagicDNS handle over the raw OS hostname", async () => {
		const source = createTailnetIdentitySource({
			loadConfig: () => DECLARED_TAILNET,
			// Tailscale deduplicated a shared HostName into a unique MagicDNS name.
			run: async () =>
				statusWith({
					a: tailnetPeerJson("phone", "phone.tail1.ts.net.", "100.88.1.2"),
					b: tailnetPeerJson("phone", "phone-1.tail1.ts.net.", "100.88.1.3"),
				}),
		});
		const report = await source.collect();
		expect(report.candidates.map((c) => c.value).sort()).toEqual(["phone", "phone-1"]);
	});

	it("falls back to the hostname when a peer has no MagicDNS name", async () => {
		const source = createTailnetIdentitySource({
			loadConfig: () => DECLARED_TAILNET,
			run: async () => statusWith({ a: tailnetPeerJson("bare-host", null) }),
		});
		expect((await source.collect()).candidates.map((c) => c.value)).toEqual(["bare-host"]);
	});

	// C2.4: this source queries WITH offline peers, unlike `tailnetPeers`' default.
	// The operator's real situation — a tailnet with peers, all of them offline —
	// must still contribute candidates, not silently produce an empty list.
	it("offers candidates even when every peer on the tailnet is offline", async () => {
		const source = createTailnetIdentitySource({
			loadConfig: () => DECLARED_TAILNET,
			run: async () =>
				statusWith({
					a: tailnetPeerJson("galaxy-a55-5g", "galaxy-a55-5g.tail1.ts.net.", "100.88.1.2", {
						online: false,
						lastSeen: "2026-07-27T00:00:00Z",
					}),
					b: tailnetPeerJson("r2vivo", "r2vivo.tail1.ts.net.", "100.88.1.3", { online: false }),
				}),
		});
		const report = await source.collect();
		expect(report.candidates.map((c) => c.value).sort()).toEqual(["galaxy-a55-5g", "r2vivo"]);
		expect(report.notices).toEqual([]);
		for (const candidate of report.candidates) {
			expect(candidate.description).toMatch(/offline/);
		}
	});
});

// ── C2.3: "no peers" and "could not ask" are different answers ───────────────

describe("reportToCandidates — the C2.3 split", () => {
	it("a trustworthy empty tailnet says nobody is there", () => {
		const report = reportToCandidates({ ok: true, reason: "no-peers", peers: [], detail: null });
		expect(report.candidates).toEqual([]);
		expect(report.notices).toHaveLength(1);
		expect(report.notices[0]).toMatch(/no other devices are on it/);
		expect(report.notices[0]).not.toMatch(/[Cc]ould not ask/);
	});

	it("a failed query says it could not ask, and names why", () => {
		const report = reportToCandidates({
			ok: false,
			reason: "cli-missing",
			peers: [],
			detail: "the `tailscale` CLI is not on PATH",
		});
		expect(report.candidates).toEqual([]);
		expect(report.notices).toHaveLength(1);
		expect(report.notices[0]).toMatch(/Could not ask your tailnet/);
		expect(report.notices[0]).toMatch(/not on PATH/);
	});

	it("the two answers are never the same words", () => {
		const empty = reportToCandidates({ ok: true, reason: "no-peers", peers: [], detail: null });
		for (const reason of ["cli-missing", "query-failed", "bad-output"] as const) {
			const failed = reportToCandidates({ ok: false, reason, peers: [], detail: "why" });
			expect(failed.notices).not.toEqual(empty.notices);
		}
	});

	it("a peer name that cannot be a label is repaired and flagged, not silently rewritten", () => {
		const report = reportToCandidates({
			ok: true,
			reason: "peers",
			peers: [
				{
					name: "myphone",
					ip: "100.88.1.2",
					dnsName: null,
					shortName: null,
					online: true,
					lastSeen: null,
				},
			],
			detail: null,
		});
		expect(report.candidates).toEqual([
			{
				value: "myphone",
				label: "myphone",
				description: "on your tailnet, name adjusted",
				needsConfirmation: true,
				rawName: "myphone",
				source: "tailnet",
			},
		]);
	});

	it("a peer name nothing can repair is skipped with a notice, not a crash", () => {
		const report = reportToCandidates({
			ok: true,
			reason: "peers",
			peers: [
				{ name: "", ip: "100.88.1.2", dnsName: null, shortName: null, online: true, lastSeen: null },
				{ name: "good", ip: "100.88.1.3", dnsName: null, shortName: "good", online: true, lastSeen: null },
			],
			detail: null,
		});
		expect(report.candidates.map((c) => c.value)).toEqual(["good"]);
		expect(report.notices[0]).toMatch(/cannot be used as a device label/);
	});
});

// ── C2.4: enrolment is not discovery — offline peers are offered, marked ─────

describe("reportToCandidates — C2.4, offline peers are offered and marked", () => {
	it("an online peer is offered plain; an offline peer is offered marked offline", () => {
		const report = reportToCandidates({
			ok: true,
			reason: "peers",
			peers: [
				{ name: "online-one", ip: "100.88.1.2", dnsName: null, shortName: null, online: true, lastSeen: null },
				{
					name: "offline-one",
					ip: "100.88.1.3",
					dnsName: null,
					shortName: null,
					online: false,
					lastSeen: null,
				},
			],
			detail: null,
		});
		const byValue = new Map(report.candidates.map((c) => [c.value, c]));
		expect(byValue.get("online-one")?.description).toBe("on your tailnet");
		expect(byValue.get("offline-one")?.description).toBe("on your tailnet, offline");
		// Distinguishable, and neither is hidden.
		expect(report.candidates.map((c) => c.value).sort()).toEqual(["offline-one", "online-one"]);
	});

	it("renders last-seen when the status document carried it, and stays generic when it did not", () => {
		const now = Date.parse("2026-07-28T12:00:00Z");
		const report = reportToCandidates(
			{
				ok: true,
				reason: "peers",
				peers: [
					{
						name: "phone-with-time",
						ip: "100.88.1.2",
						dnsName: null,
						shortName: null,
						online: false,
						lastSeen: "2026-07-27T12:00:00Z", // exactly 1 day before `now`
					},
					{
						name: "phone-no-time",
						ip: "100.88.1.3",
						dnsName: null,
						shortName: null,
						online: false,
						lastSeen: null,
					},
				],
				detail: null,
			},
			now,
		);
		const byValue = new Map(report.candidates.map((c) => [c.value, c]));
		expect(byValue.get("phone-with-time")?.description).toBe("on your tailnet, offline (last seen 1d ago)");
		// No LastSeen in the status document ⇒ no invented value, just the mark.
		expect(byValue.get("phone-no-time")?.description).toBe("on your tailnet, offline");
	});

	it("a repaired offline candidate's description carries both facts: name adjusted AND offline", () => {
		const report = reportToCandidates({
			ok: true,
			reason: "peers",
			// A control character forces the repair path (as in the "name adjusted" test above).
			peers: [{ name: "myphone", ip: "100.88.1.2", dnsName: null, shortName: null, online: false, lastSeen: null }],
			detail: null,
		});
		expect(report.candidates[0]?.description).toBe("on your tailnet, name adjusted, offline");
	});

	it("a tailnet where EVERY peer is offline still yields candidates — never the 'no other devices' notice", () => {
		// The operator's exact situation this closes: two peers, both offline.
		const report = reportToCandidates({
			ok: true,
			reason: "peers",
			peers: [
				{
					name: "Galaxy A55 5G",
					ip: "100.88.1.2",
					dnsName: null,
					shortName: null,
					online: false,
					lastSeen: null,
				},
				{ name: "r2vivo", ip: "100.88.1.3", dnsName: null, shortName: "r2vivo", online: false, lastSeen: null },
			],
			detail: null,
		});
		expect(report.candidates).toHaveLength(2);
		expect(report.candidates.map((c) => c.value)).toEqual(
			expect.arrayContaining(["Galaxy A55 5G", "r2vivo"]),
		);
		expect(report.notices).toEqual([]);
		// The regression this guards against: collapsing "peers, all offline" into
		// the trustworthy-empty answer.
		expect(report.notices.join(" ")).not.toMatch(/no other devices are on it/);
	});
});

describe("the default source registry", () => {
	it("wires the tailnet source in — the extension is really reachable", () => {
		expect(defaultIdentityCandidateSources().map((s) => s.id)).toEqual(["tailnet"]);
	});
});

/** A recording OperatorChannel: scripted answers plus the prompts as issued, so a
 * test can assert what the operator was actually SHOWN, not only what they picked. */
function recordingOperator(answers: Array<boolean | string>): {
	operator: OperatorChannel;
	prompts: OperatorPrompt[];
} {
	const scripted = createScriptedOperatorChannel(answers);
	const prompts: OperatorPrompt[] = [];
	const ask = async (prompt: OperatorPrompt): Promise<boolean | string> => {
		prompts.push(prompt);
		return scripted.ask(prompt);
	};
	return { operator: { ask } as unknown as OperatorChannel, prompts };
}

function selectPrompt(prompts: OperatorPrompt[]): SelectPrompt {
	const found = prompts.find((p) => p.type === "select");
	if (!found || found.type !== "select") throw new Error("no select prompt was issued");
	return found;
}

const DECLARED_TAILNET = {
	surfaces: { "sidecar-http": { expose: "tailnet", gate: "device-token" } },
};
const UNDECLARED_TAILNET = {
	surfaces: { "sidecar-http": { expose: "loopback" }, "daemon-ws": { expose: "loopback" } },
};

/** A `tailscale status --json` document, shaped enough to be read as one. */
function statusWith(peers: Record<string, unknown>): string {
	return JSON.stringify({
		Self: { HostName: "this-pc", TailscaleIPs: ["100.64.0.1"], Online: true },
		BackendState: "Running",
		Peer: peers,
	});
}

function tailnetPeerJson(
	hostName: string,
	dnsName: string | null,
	ip = "100.88.1.2",
	options: { online?: boolean; lastSeen?: string } = {},
) {
	return {
		HostName: hostName,
		...(dnsName === null ? {} : { DNSName: dnsName }),
		TailscaleIPs: [ip],
		Online: options.online ?? true,
		...(options.lastSeen === undefined ? {} : { LastSeen: options.lastSeen }),
	};
}

/** Fake TTY read/write streams — never a real stdin/stdout, just objects with `isTTY`
 * so the command's `input.isTTY && output.isTTY ? stdio : auto` detection can be
 * driven from a test without touching the terminal. */
function fakeStream(isTTY: boolean): NodeJS.ReadStream & NodeJS.WriteStream {
	return { isTTY } as unknown as NodeJS.ReadStream & NodeJS.WriteStream;
}

describe("refarm auth enroll — no identity argument (interactive selection)", () => {
	const tempDirs: string[] = [];
	let stdoutSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
		process.exitCode = undefined;
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	function tempPolicyPath(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-auth-enroll-test-"));
		tempDirs.push(dir);
		return path.join(dir, "auth-policy.json");
	}

	function writePolicy(policyPath: string, policy: AuthPolicyFile): void {
		fs.mkdirSync(path.dirname(policyPath), { recursive: true });
		fs.writeFileSync(policyPath, JSON.stringify(policy));
	}

	function readPolicyFile(policyPath: string): AuthPolicyFile {
		return JSON.parse(fs.readFileSync(policyPath, "utf8")) as AuthPolicyFile;
	}

	it("empty policy goes straight to the text prompt and enrolls the typed label", async () => {
		const policyPath = tempPolicyPath();
		const operator = createScriptedOperatorChannel(["arthur-phone"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(process.exitCode).toBeUndefined();
		const policy = readPolicyFile(policyPath);
		expect(policy.credentials).toHaveLength(1);
		expect(policy.credentials[0]?.identity).toBe("arthur-phone");
	});

	it("populated policy offers select-plus-new; choosing existing identity implies rotation", async () => {
		const policyPath = tempPolicyPath();
		writePolicy(policyPath, {
			credentials: [{ identity: "arthur", tokenSha256: sha256Hex("old") }],
		});
		const operator = createScriptedOperatorChannel(["arthur"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(process.exitCode).toBeUndefined();
		const policy = readPolicyFile(policyPath);
		expect(policy.credentials).toHaveLength(1);
		expect(policy.credentials[0]?.identity).toBe("arthur");
		expect(policy.credentials[0]?.tokenSha256).not.toBe(sha256Hex("old"));
	});

	it("choosing 'a new device' then typing a label enrolls it alongside the existing one", async () => {
		const policyPath = tempPolicyPath();
		writePolicy(policyPath, {
			credentials: [{ identity: "arthur", tokenSha256: sha256Hex("old") }],
		});
		const operator = createScriptedOperatorChannel([" new-device", "arthur-tablet"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(process.exitCode).toBeUndefined();
		const policy = readPolicyFile(policyPath);
		const identities = policy.credentials.map((c) => c.identity).sort();
		expect(identities).toEqual(["arthur", "arthur-tablet"]);
	});

	it("no TTY and no identity fails with the usage message instead of hanging or defaulting", async () => {
		const policyPath = tempPolicyPath();
		const cmd = createAuthEnrollCommand({
			input: fakeStream(false),
			output: fakeStream(false),
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("missing required argument"));
		expect(fs.existsSync(policyPath)).toBe(false);
	});

	it("--json with no identity fails rather than prompting", async () => {
		const policyPath = tempPolicyPath();
		const cmd = createAuthEnrollCommand({
			input: fakeStream(true),
			output: fakeStream(true),
		});

		await cmd.parseAsync(["--policy", policyPath, "--json"], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("--json"));
		expect(fs.existsSync(policyPath)).toBe(false);
	});

	it("rejects an empty typed label without writing the policy", async () => {
		const policyPath = tempPolicyPath();
		const operator = createScriptedOperatorChannel([""]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("must not be empty"));
		expect(fs.existsSync(policyPath)).toBe(false);
	});

	it("rejects a typed label that duplicates an enrolled identity without implying rotation", async () => {
		const policyPath = tempPolicyPath();
		writePolicy(policyPath, {
			credentials: [{ identity: "arthur", tokenSha256: sha256Hex("old") }],
		});
		// Chooses "a new device" (not the select-existing path) but types the identity
		// that is already enrolled — must be rejected, not silently rotated.
		const operator = createScriptedOperatorChannel([" new-device", "arthur"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("already enrolled"));
		const policy = readPolicyFile(policyPath);
		expect(policy.credentials).toEqual([{ identity: "arthur", tokenSha256: sha256Hex("old") }]);
	});

	it("enroll <identity> as a plain argument is unchanged — no prompt, no operator touched", async () => {
		const policyPath = tempPolicyPath();
		const cmd = createAuthEnrollCommand({
			// no operator injected — if the argument path tried to prompt, this would throw.
			input: fakeStream(false),
			output: fakeStream(false),
		});

		await cmd.parseAsync(["arthur-phone", "--policy", policyPath], { from: "user" });

		expect(process.exitCode).toBeUndefined();
		const policy = readPolicyFile(policyPath);
		expect(policy.credentials).toHaveLength(1);
		expect(policy.credentials[0]?.identity).toBe("arthur-phone");
	});

	it("an explicitly empty source list leaves the canonical flow exactly as it was", async () => {
		const policyPath = tempPolicyPath();
		const { operator, prompts } = recordingOperator(["arthur-phone"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
			identityCandidateSources: [],
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(process.exitCode).toBeUndefined();
		expect(prompts.map((p) => p.type)).toEqual(["text"]);
		expect(stdoutText()).not.toMatch(/tailnet/i);
		expect(readPolicyFile(policyPath).credentials[0]?.identity).toBe("arthur-phone");
	});

	// ── The extended path, end to end ────────────────────────────────────────

	/** A tailnet source wired to a fake config + a fake `tailscale`, recording every
	 * spawn it makes so a test can assert on the ones it must NOT make. */
	function tailnetSource(options: {
		config: Record<string, unknown> | null;
		stdout?: string;
		fail?: Error;
	}): { source: IdentityCandidateSource; calls: string[][] } {
		const calls: string[][] = [];
		const source = createTailnetIdentitySource({
			loadConfig: () => options.config,
			run: async (args) => {
				calls.push(args);
				if (options.fail) throw options.fail;
				return options.stdout ?? statusWith({});
			},
		});
		return { source, calls };
	}

	/** A source that records whether it was consulted at all. */
	function spySource(): { source: IdentityCandidateSource; calls: number } {
		const state = { calls: 0 };
		return {
			source: {
				id: "spy",
				collect: async () => {
					state.calls += 1;
					return { candidates: [], notices: [] };
				},
			},
			get calls() {
				return state.calls;
			},
		};
	}

	it("declared tailnet: peers are offered by their tailnet name, 'A new device' still there", async () => {
		const policyPath = tempPolicyPath();
		const { source, calls } = tailnetSource({
			config: DECLARED_TAILNET,
			stdout: statusWith({
				a: tailnetPeerJson("meu-android", "meu-android.tail1.ts.net.", "100.88.1.2"),
				b: tailnetPeerJson("raspberry", "raspberry.tail1.ts.net.", "100.88.3.4"),
			}),
		});
		const { operator, prompts } = recordingOperator(["meu-android"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
			identityCandidateSources: [source],
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(calls).toEqual([["status", "--json"]]);
		expect(process.exitCode).toBeUndefined();
		const options = selectPrompt(prompts).options;
		expect(options.map((o) => o.value)).toEqual(["meu-android", "raspberry", " new-device"]);
		// C2.2 — typing a name never disappears.
		expect(options.at(-1)).toEqual({
			value: " new-device",
			label: "A new device",
			description: "enroll a new identity",
		});
		// C2.1 — exactly ONE credential was minted, no "enroll all".
		const policy = readPolicyFile(policyPath);
		expect(policy.credentials.map((c) => c.identity)).toEqual(["meu-android"]);
	});

	// C2.4 — the operator's real situation: a tailnet with peers, every one of
	// them offline. The feature must stay live, not go inert, and the operator
	// must be able to tell online from offline at a glance.
	it("declared tailnet, ALL peers offline: still offered, marked, and enrollable — not the empty-tailnet notice", async () => {
		const policyPath = tempPolicyPath();
		const { source, calls } = tailnetSource({
			config: DECLARED_TAILNET,
			stdout: statusWith({
				a: tailnetPeerJson("galaxy-a55-5g", "galaxy-a55-5g.tail1.ts.net.", "100.88.1.2", {
					online: false,
					// A real `LastSeen` far enough in the past that "Xd ago" is stable
					// regardless of exactly when this test happens to run.
					lastSeen: "2000-01-01T00:00:00Z",
				}),
				b: tailnetPeerJson("r2vivo", "r2vivo.tail1.ts.net.", "100.88.3.4", { online: false }),
			}),
		});
		const { operator, prompts } = recordingOperator(["r2vivo"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
			identityCandidateSources: [source],
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(calls).toEqual([["status", "--json"]]);
		expect(process.exitCode).toBeUndefined();
		const options = selectPrompt(prompts).options;
		expect(options.map((o) => o.value)).toEqual(["galaxy-a55-5g", "r2vivo", " new-device"]);
		// Both offline peers are visibly marked, one with last-seen, one without —
		// online vs. offline is distinguishable, and the exact "Xd ago" count is
		// left to the unit-level `reportToCandidates` tests (deterministic `now`).
		expect(options[0]?.description).toMatch(/^on your tailnet, offline \(last seen \d+d ago\) — enroll it$/);
		expect(options[1]?.description).toBe("on your tailnet, offline — enroll it");
		// The regression this closes: an all-offline tailnet must not fall back to
		// the "no other devices" notice — the select prompt itself IS the proof.
		expect(stdoutText()).not.toMatch(/no other devices are on it/);
		expect(readPolicyFile(policyPath).credentials.map((c) => c.identity)).toEqual(["r2vivo"]);
	});

	it("declared tailnet: 'A new device' still leads to free text even with peers on offer", async () => {
		const policyPath = tempPolicyPath();
		const { source } = tailnetSource({
			config: DECLARED_TAILNET,
			stdout: statusWith({ a: tailnetPeerJson("meu-android", "meu-android.tail1.ts.net.") }),
		});
		const operator = createScriptedOperatorChannel([" new-device", "not-on-the-tailnet"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
			identityCandidateSources: [source],
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(process.exitCode).toBeUndefined();
		expect(readPolicyFile(policyPath).credentials.map((c) => c.identity)).toEqual([
			"not-on-the-tailnet",
		]);
	});

	it("declared tailnet, genuinely zero peers: says so, then falls through to typing a name", async () => {
		const policyPath = tempPolicyPath();
		const { source, calls } = tailnetSource({
			config: DECLARED_TAILNET,
			stdout: statusWith({}),
		});
		const { operator, prompts } = recordingOperator(["arthur-phone"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
			identityCandidateSources: [source],
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(calls).toEqual([["status", "--json"]]);
		const shown = stdoutText();
		expect(shown).toMatch(/no other devices are on it/);
		expect(shown).not.toMatch(/[Cc]ould not ask/);
		// No empty list masquerading as a device list — straight to the canonical ask.
		expect(prompts.map((p) => p.type)).toEqual(["text"]);
		expect(readPolicyFile(policyPath).credentials[0]?.identity).toBe("arthur-phone");
	});

	it("declared tailnet, query failed: says it could not ask (and why), then falls through", async () => {
		const policyPath = tempPolicyPath();
		const { source } = tailnetSource({
			config: DECLARED_TAILNET,
			fail: Object.assign(new Error("spawn tailscale ENOENT"), { code: "ENOENT" }),
		});
		const { operator, prompts } = recordingOperator(["arthur-phone"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
			identityCandidateSources: [source],
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		const shown = stdoutText();
		// C2.3 — a DIFFERENT operator-visible outcome from "no peers": it names the
		// reason, and never claims the tailnet is empty.
		expect(shown).toMatch(/Could not ask your tailnet/);
		expect(shown).toMatch(/not on PATH/);
		expect(shown).not.toMatch(/no other devices are on it/);
		expect(prompts.map((p) => p.type)).toEqual(["text"]);
		expect(process.exitCode).toBeUndefined();
		expect(readPolicyFile(policyPath).credentials[0]?.identity).toBe("arthur-phone");
	});

	it("a peer that is already enrolled shows once, as a rotate, and rotates its token", async () => {
		const policyPath = tempPolicyPath();
		writePolicy(policyPath, {
			credentials: [{ identity: "meu-android", tokenSha256: sha256Hex("old") }],
		});
		const { source } = tailnetSource({
			config: DECLARED_TAILNET,
			stdout: statusWith({
				a: tailnetPeerJson("meu-android", "meu-android.tail1.ts.net.", "100.88.1.2"),
				b: tailnetPeerJson("raspberry", "raspberry.tail1.ts.net.", "100.88.3.4"),
			}),
		});
		const { operator, prompts } = recordingOperator(["meu-android"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
			identityCandidateSources: [source],
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		const options = selectPrompt(prompts).options;
		expect(options.filter((o) => o.value === "meu-android")).toHaveLength(1);
		expect(options[0]?.description).toBe("on your tailnet — rotate its token");
		expect(process.exitCode).toBeUndefined();
		const policy = readPolicyFile(policyPath);
		expect(policy.credentials).toHaveLength(1);
		expect(policy.credentials[0]?.tokenSha256).not.toBe(sha256Hex("old"));
	});

	it("a peer name that fails label validation is offered repaired, for the operator to accept", async () => {
		const policyPath = tempPolicyPath();
		const { source } = tailnetSource({
			config: DECLARED_TAILNET,
			// No DNSName, and a HostName carrying a control character: the label
			// validator rejects it, so the source offers a repair rather than
			// dropping the device or crashing.
			stdout: statusWith({ a: tailnetPeerJson("myphone", null, "100.88.1.2") }),
		});
		// Picks the repaired candidate, then ACCEPTS the offered default verbatim.
		const { operator, prompts } = recordingOperator(["myphone", "myphone"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
			identityCandidateSources: [source],
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(selectPrompt(prompts).options[0]?.description).toBe(
			"on your tailnet, name adjusted — enroll it",
		);
		const confirm = prompts.find((p) => p.type === "text");
		expect(confirm?.type === "text" && confirm.default).toBe("myphone");
		expect(process.exitCode).toBeUndefined();
		expect(readPolicyFile(policyPath).credentials[0]?.identity).toBe("myphone");
	});

	it("cancelling the extended select stays graceful — exit 130, no policy written", async () => {
		const policyPath = tempPolicyPath();
		const { source } = tailnetSource({
			config: DECLARED_TAILNET,
			stdout: statusWith({ a: tailnetPeerJson("meu-android", "meu-android.tail1.ts.net.") }),
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const operator: OperatorChannel = {
			ask: async () => {
				throw new OperatorPromptCancelledError();
			},
		} as unknown as OperatorChannel;
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
			identityCandidateSources: [source],
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(process.exitCode).toBe(130);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Cancelled."));
		expect(fs.existsSync(policyPath)).toBe(false);
		logSpy.mockRestore();
	});

	// ── The three paths that must NEVER ask a source anything ────────────────

	it("--json never consults a candidate source", async () => {
		const policyPath = tempPolicyPath();
		const spy = spySource();
		const cmd = createAuthEnrollCommand({
			input: fakeStream(true),
			output: fakeStream(true),
			identityCandidateSources: [spy.source],
		});

		await cmd.parseAsync(["--policy", policyPath, "--json"], { from: "user" });

		expect(spy.calls).toBe(0);
		expect(process.exitCode).toBe(1);
	});

	it("the no-TTY path never consults a candidate source", async () => {
		const policyPath = tempPolicyPath();
		const spy = spySource();
		const cmd = createAuthEnrollCommand({
			input: fakeStream(false),
			output: fakeStream(false),
			identityCandidateSources: [spy.source],
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(spy.calls).toBe(0);
		expect(process.exitCode).toBe(1);
	});

	it("an explicit <identity> argument never consults a candidate source", async () => {
		const policyPath = tempPolicyPath();
		const spy = spySource();
		const cmd = createAuthEnrollCommand({
			input: fakeStream(false),
			output: fakeStream(false),
			identityCandidateSources: [spy.source],
		});

		await cmd.parseAsync(["arthur-phone", "--policy", policyPath], { from: "user" });

		expect(spy.calls).toBe(0);
		expect(process.exitCode).toBeUndefined();
		expect(readPolicyFile(policyPath).credentials[0]?.identity).toBe("arthur-phone");
	});

	it("an undeclared tailnet never spawns `tailscale`, even through the real command", async () => {
		const policyPath = tempPolicyPath();
		const { source, calls } = tailnetSource({
			config: UNDECLARED_TAILNET,
			stdout: statusWith({ a: tailnetPeerJson("meu-android", "meu-android.tail1.ts.net.") }),
		});
		const { operator, prompts } = recordingOperator(["arthur-phone"]);
		const cmd = createAuthEnrollCommand({
			operator,
			input: fakeStream(true),
			output: fakeStream(true),
			identityCandidateSources: [source],
		});

		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(calls).toEqual([]);
		expect(prompts.map((p) => p.type)).toEqual(["text"]);
		expect(stdoutText()).not.toMatch(/tailnet/i);
		expect(readPolicyFile(policyPath).credentials[0]?.identity).toBe("arthur-phone");
	});

	/** Everything the command wrote to stdout during this test. */
	function stdoutText(): string {
		return (stdoutSpy.mock.calls as unknown as unknown[][])
			.map((call) => String(call[0] ?? ""))
			.join("");
	}
});
