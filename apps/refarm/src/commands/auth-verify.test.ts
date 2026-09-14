import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
	createInMemorySasExchangeStore,
	createSasRateLimiter,
	handleSasHttp,
	readScopedCredentials,
	SAS_HTTP_BASE,
	SCOPE_ANSWER_PROMPTS,
	startSasVerification,
	authenticateScopedToken,
	type SasExchangeStore,
} from "@refarm.dev/emoji-sas-v1";
import { createScriptedOperatorChannel, OperatorPromptCancelledError } from "@refarm.dev/prompt-contract-v1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sha256Hex } from "./auth-policy-file.js";
import { createAuthVerifyCommand, describeGrant, formatLifetime } from "./auth-verify.js";
import { createAuthListCommand, createAuthRevokeCommand } from "./auth.js";
import { createFilesystemSasExchangeStore, resolveSasDir, SAS_RECORD_FILE } from "./sas-store.js";

/**
 * The confirmation, end to end, against a THROWAWAY policy under /tmp.
 *
 * Never the operator's `.refarm/auth-policy.json`, and never a path derived from cwd:
 * every test here passes `--policy` explicitly, and `resolveSasDir` derives the
 * exchange directory from that same path, so a test cannot reach the real one even by
 * accident.
 */

const NOW = 1_800_000_000_000;

let dir: string;
let policyPath: string;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), "refarm-sas-verify-"));
	policyPath = path.join(dir, "auth-policy.json");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function fakeStream(isTTY: boolean): PassThrough & NodeJS.WriteStream & NodeJS.ReadStream {
	const stream = new PassThrough() as PassThrough & NodeJS.WriteStream & NodeJS.ReadStream;
	Object.defineProperty(stream, "isTTY", { value: isTTY });
	return stream;
}

function capture(): { stream: PassThrough & NodeJS.WriteStream; text: () => string } {
	const stream = new PassThrough() as PassThrough & NodeJS.WriteStream;
	Object.defineProperty(stream, "isTTY", { value: true });
	let text = "";
	stream.on("data", (chunk: Buffer) => {
		text += chunk.toString();
	});
	return { stream, text: () => text };
}

/** Start an exchange the way the browser does, against an injected store. */
async function startExchange(store: SasExchangeStore, client = "a browser") {
	const surface = { store, limiter: createSasRateLimiter(), surface: "web", now: () => NOW };
	const handle = await startSasVerification({
		client,
		fetch: async (input, init) => {
			const url = new URL(input, "http://node");
			const response = await handleSasHttp(surface, {
				method: init?.method ?? "GET",
				path: url.pathname,
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
			});
			return new Response(JSON.stringify(response!.body), { status: response!.status });
		},
	});
	return handle;
}

describe("refarm auth verify — S4, the confirming side says what it is authorising", () => {
	it("names the surface, the scope, the lifetime and what it is NOT, before the row", async () => {
		const store = createInMemorySasExchangeStore();
		await startExchange(store, "Firefox on the laptop");
		const exchange = (await store.list())[0]!;

		const lines = describeGrant(exchange, NOW).join("\n");
		// A confirmation prompt that shows only emoji has told the operator to compare
		// pictures without telling them what they are agreeing to.
		expect(lines).toContain("Surface     web");
		expect(lines).toContain("Firefox on the laptop");
		expect(lines).toContain("the caller's own claim, not a fact");
		expect(lines).toContain("may answer operator prompts");
		expect(lines).toContain("NOT a device credential");
		expect(lines).toContain("Lifetime    1 hour");
		expect(lines).toContain("Revoke");
	});

	it("prints the seven emoji and the scope before asking, then grants on yes", async () => {
		const store = createInMemorySasExchangeStore();
		const handle = await startExchange(store);
		const out = capture();

		const cmd = createAuthVerifyCommand({
			store,
			now: () => NOW,
			operator: createScriptedOperatorChannel([true]),
			input: fakeStream(true),
			output: out.stream,
			mintToken: () => "the-scoped-token",
		});
		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		// The row the operator was shown is the row the browser derived.
		for (const emoji of handle.emoji) expect(out.text()).toContain(emoji.emoji);
		expect(out.text()).toContain("IN THIS ORDER");
		expect(out.text()).toContain("never retried");
		expect(out.text()).toContain("✅ verified");

		// The TOKEN is never printed — that is the whole improvement over carrying a
		// secret by hand, and printing it here would put it back on this terminal.
		expect(out.text()).not.toContain("the-scoped-token");

		const policy = JSON.parse(fs.readFileSync(policyPath, "utf8")) as Record<string, unknown>;
		const scoped = readScopedCredentials(policy);
		expect(scoped).toHaveLength(1);
		expect(scoped[0]!.scope).toEqual([SCOPE_ANSWER_PROMPTS]);
		expect(scoped[0]!.tokenSha256).toBe(sha256Hex("the-scoped-token"));
		// It is NOT a device credential, in the only file the daemon reads.
		expect(policy.credentials).toEqual([]);
	});

	it("the browser opens the sealed credential — the token never crossed in plaintext", async () => {
		const store = createInMemorySasExchangeStore();
		const handle = await startExchange(store);
		const cmd = createAuthVerifyCommand({
			store,
			now: () => NOW,
			operator: createScriptedOperatorChannel([true]),
			input: fakeStream(true),
			output: capture().stream,
			mintToken: () => "the-scoped-token",
		});
		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		const settled = (await store.get(handle.id))!;
		expect(settled.state).toBe("granted");
		expect(JSON.stringify(settled.sealed)).not.toContain("the-scoped-token");
		// Only the party holding the initiator's private key can read it.
		const outcome = await handle.poll();
		expect(outcome).toEqual({
			state: "granted",
			token: "the-scoped-token",
			scope: [SCOPE_ANSWER_PROMPTS],
			lifetimeMs: 3_600_000,
		});
	});

	it("the granted credential authenticates for its scope, and expires", async () => {
		const store = createInMemorySasExchangeStore();
		await startExchange(store);
		const cmd = createAuthVerifyCommand({
			store,
			now: () => NOW,
			operator: createScriptedOperatorChannel([true]),
			input: fakeStream(true),
			output: capture().stream,
			mintToken: () => "the-scoped-token",
		});
		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		const policy = JSON.parse(fs.readFileSync(policyPath, "utf8")) as Record<string, unknown>;
		const digest = sha256Hex("the-scoped-token");
		expect(authenticateScopedToken(policy, digest, SCOPE_ANSWER_PROMPTS, NOW)).toBeTruthy();
		expect(authenticateScopedToken(policy, digest, "sidecar:call", NOW)).toBeNull();
		expect(authenticateScopedToken(policy, digest, SCOPE_ANSWER_PROMPTS, NOW + 3_600_001)).toBeNull();
	});
});

describe("S5 — a mismatch aborts, is recorded, and is never a retry", () => {
	it("writes nothing to the policy, records the abort, and exits non-zero", async () => {
		const store = createFilesystemSasExchangeStore(resolveSasDir(policyPath));
		const handle = await startExchange(store);
		const out = capture();
		const previousExit = process.exitCode;

		const cmd = createAuthVerifyCommand({
			store,
			now: () => NOW,
			operator: createScriptedOperatorChannel([false]),
			input: fakeStream(true),
			output: out.stream,
		});
		await cmd.parseAsync(["--policy", policyPath], { from: "user" });

		expect(out.text()).toContain("🚨 MISMATCH");
		expect(out.text()).toContain("NOT retried");
		expect(process.exitCode).toBe(1);
		process.exitCode = previousExit;

		// Nothing was written to the policy at all — not an empty entry, not a file.
		expect(fs.existsSync(policyPath)).toBe(false);

		const log = fs
			.readFileSync(path.join(resolveSasDir(policyPath), SAS_RECORD_FILE), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(log).toHaveLength(1);
		expect(log[0]!.outcome).toBe("aborted");
		expect(log[0]!.reason).toBe("mismatch");
		expect(log[0]!.id).toBe(handle.id);

		// MUTATION GUARD for "never a retry": the exchange is dead. A second confirmation
		// — even a `true` one — must not be able to resurrect it.
		const second = capture();
		const retry = createAuthVerifyCommand({
			store,
			now: () => NOW,
			operator: createScriptedOperatorChannel([true]),
			input: fakeStream(true),
			output: second.stream,
		});
		await retry.parseAsync(["--policy", policyPath], { from: "user" });
		expect(second.text()).toContain("No verification is waiting");
		expect(fs.existsSync(policyPath)).toBe(false);
		process.exitCode = previousExit;
	});

	it("the record carries no key material and no token", async () => {
		const store = createFilesystemSasExchangeStore(resolveSasDir(policyPath));
		const handle = await startExchange(store);
		const pendingRaw = fs.readFileSync(
			path.join(resolveSasDir(policyPath), `${handle.id}.json`),
			"utf8",
		);
		const privateKey = (JSON.parse(pendingRaw) as { confirmerPrivateKeyJwk: { d: string } })
			.confirmerPrivateKeyJwk.d;
		const previousExit = process.exitCode;

		await createAuthVerifyCommand({
			store,
			now: () => NOW,
			operator: createScriptedOperatorChannel([false]),
			input: fakeStream(true),
			output: capture().stream,
		}).parseAsync(["--policy", policyPath], { from: "user" });
		process.exitCode = previousExit;

		const log = fs.readFileSync(path.join(resolveSasDir(policyPath), SAS_RECORD_FILE), "utf8");
		expect(log).not.toContain(privateKey);
		expect(log).not.toContain("PrivateKey");
		// And the settled exchange on disk no longer holds it either.
		expect(fs.readFileSync(path.join(resolveSasDir(policyPath), `${handle.id}.json`), "utf8")).not.toContain(
			privateKey,
		);
	});

	it("cancellation SETTLES the exchange rather than leaving it approvable", async () => {
		const store = createInMemorySasExchangeStore();
		const handle = await startExchange(store);
		const out = capture();
		const previousExit = process.exitCode;

		const cancelling = {
			ask: () => Promise.reject(new OperatorPromptCancelledError()),
		} as never;
		await createAuthVerifyCommand({
			store,
			now: () => NOW,
			operator: cancelling,
			input: fakeStream(true),
			output: out.stream,
		}).parseAsync(["--policy", policyPath], { from: "user" });

		expect(process.exitCode).toBe(130);
		process.exitCode = previousExit;
		expect(out.text()).toContain("aborted and recorded");
		const settled = (await store.get(handle.id))!;
		expect(settled.state).toBe("aborted");
		expect(settled.abortReason).toBe("cancelled");
		expect(settled.confirmerPrivateKeyJwk).toBeNull();
		expect((await store.records())[0]!.reason).toBe("cancelled");
	});

	it("an expired verification is swept, recorded, and never offered", async () => {
		const store = createInMemorySasExchangeStore();
		await startExchange(store);
		const out = capture();
		await createAuthVerifyCommand({
			store,
			now: () => NOW + 10 * 60_000,
			operator: createScriptedOperatorChannel([true]),
			input: fakeStream(true),
			output: out.stream,
		}).parseAsync(["--policy", policyPath], { from: "user" });

		expect(out.text()).toContain("No verification is waiting");
		expect((await store.records())[0]!.reason).toBe("expired");
	});
});

describe("there is no way to skip the human comparison", () => {
	it("--json reports what is waiting and grants NOTHING", async () => {
		const store = createInMemorySasExchangeStore();
		const handle = await startExchange(store);
		const out = capture();
		await createAuthVerifyCommand({
			store,
			now: () => NOW,
			input: fakeStream(true),
			output: out.stream,
		}).parseAsync(["--policy", policyPath, "--json"], { from: "user" });

		const payload = JSON.parse(out.text()) as {
			ok: boolean;
			granted: boolean;
			detail: string;
			pending: { id: string; emoji: { emoji: string }[] }[];
		};
		expect(payload.ok).toBe(true);
		expect(payload.granted).toBe(false);
		expect(payload.pending).toHaveLength(1);
		expect(payload.pending[0]!.emoji.map((e) => e.emoji)).toEqual(
			handle.emoji.map((e) => e.emoji),
		);
		expect(payload.detail).toContain("There is no --yes");
		expect(fs.existsSync(policyPath)).toBe(false);
		expect((await store.get(handle.id))!.state).toBe("pending");
	});

	it("declares no --yes flag at all", () => {
		const flags = createAuthVerifyCommand()
			.options.map((option) => option.long);
		expect(flags).not.toContain("--yes");
		expect(flags).not.toContain("--force");
	});

	it("refuses to confirm without a terminal, rather than defaulting an answer", async () => {
		const store = createInMemorySasExchangeStore();
		await startExchange(store);
		const out = capture();
		const previousExit = process.exitCode;
		await createAuthVerifyCommand({
			store,
			now: () => NOW,
			input: fakeStream(false),
			output: out.stream,
		}).parseAsync(["--policy", policyPath], { from: "user" });

		expect(out.text()).toContain("not an interactive terminal");
		expect(process.exitCode).toBe(1);
		process.exitCode = previousExit;
		expect(fs.existsSync(policyPath)).toBe(false);
	});
});

describe("the scoped credential in auth list and auth revoke (S3)", () => {
	async function grant(store: SasExchangeStore, token: string): Promise<string> {
		await startExchange(store);
		await createAuthVerifyCommand({
			store,
			now: () => NOW,
			operator: createScriptedOperatorChannel([true]),
			input: fakeStream(true),
			output: capture().stream,
			mintToken: () => token,
		}).parseAsync(["--policy", policyPath], { from: "user" });
		const policy = JSON.parse(fs.readFileSync(policyPath, "utf8")) as Record<string, unknown>;
		return readScopedCredentials(policy).at(-1)!.id;
	}

	it("appears in `auth list` as its own entry, with its scope and its deadline", async () => {
		const store = createInMemorySasExchangeStore();
		const id = await grant(store, "token-a");
		const written: string[] = [];
		const original = process.stdout.write.bind(process.stdout);
		(process.stdout as { write: unknown }).write = (chunk: string) => {
			written.push(String(chunk));
			return true;
		};
		try {
			await createAuthListCommand({ now: () => NOW }).parseAsync(["--policy", policyPath], {
				from: "user",
			});
		} finally {
			(process.stdout as { write: unknown }).write = original;
		}
		const text = written.join("");
		expect(text).toContain("Scoped credentials");
		expect(text).toContain(id);
		expect(text).toContain(SCOPE_ANSWER_PROMPTS);
		expect(text).toContain("expires in 1 hour");
		expect(text).toContain("NOT device credentials");
	});

	it("`auth list --json` keeps `identities` meaning devices, and adds `scoped`", async () => {
		const store = createInMemorySasExchangeStore();
		const id = await grant(store, "token-a");
		const written: string[] = [];
		const original = process.stdout.write.bind(process.stdout);
		(process.stdout as { write: unknown }).write = (chunk: string) => {
			written.push(String(chunk));
			return true;
		};
		try {
			await createAuthListCommand({ now: () => NOW }).parseAsync(
				["--policy", policyPath, "--json"],
				{ from: "user" },
			);
		} finally {
			(process.stdout as { write: unknown }).write = original;
		}
		const payload = JSON.parse(written.join("")) as {
			identities: string[];
			scoped: { id: string; expired: boolean; scope: string[] }[];
		};
		expect(payload.identities).toEqual([]);
		expect(payload.scoped.map((s) => s.id)).toEqual([id]);
		expect(payload.scoped[0]!.expired).toBe(false);
		expect(payload.scoped[0]!.scope).toEqual([SCOPE_ANSWER_PROMPTS]);
	});

	it("`auth revoke <id>` cuts off ONE session and nothing else", async () => {
		const store = createInMemorySasExchangeStore();
		const first = await grant(store, "token-a");
		const second = await grant(store, "token-b");
		fs.writeFileSync(
			policyPath,
			JSON.stringify(
				{
					...(JSON.parse(fs.readFileSync(policyPath, "utf8")) as Record<string, unknown>),
					credentials: [{ identity: "my-phone", tokenSha256: sha256Hex("device-token") }],
				},
				null,
				2,
			),
		);

		const written: string[] = [];
		const original = process.stdout.write.bind(process.stdout);
		(process.stdout as { write: unknown }).write = (chunk: string) => {
			written.push(String(chunk));
			return true;
		};
		try {
			await createAuthRevokeCommand().parseAsync(["--policy", policyPath, first, "--json"], {
				from: "user",
			});
		} finally {
			(process.stdout as { write: unknown }).write = original;
		}

		const payload = JSON.parse(written.join("")) as { kind: string; remaining: string[] };
		expect(payload.kind).toBe("scoped");
		// The device it "sits behind" is untouched — S3's whole point.
		expect(payload.remaining).toEqual(["my-phone"]);
		const policy = JSON.parse(fs.readFileSync(policyPath, "utf8")) as Record<string, unknown>;
		expect(readScopedCredentials(policy).map((c) => c.id)).toEqual([second]);
		expect(authenticateScopedToken(policy, sha256Hex("token-a"), SCOPE_ANSWER_PROMPTS, NOW)).toBeNull();
		expect(authenticateScopedToken(policy, sha256Hex("token-b"), SCOPE_ANSWER_PROMPTS, NOW)).toBeTruthy();
	});
});

describe("small things that would be wrong quietly", () => {
	it("states a lifetime a human can judge", () => {
		expect(formatLifetime(3_600_000)).toBe("1 hour");
		expect(formatLifetime(90 * 60_000)).toBe("1.5 hours");
		expect(formatLifetime(15 * 60_000)).toBe("15 minutes");
		expect(formatLifetime(5_000)).toBe("5 seconds");
	});

	it("derives the exchange directory from the policy path, so --policy moves both", () => {
		expect(resolveSasDir("/tmp/x/auth-policy.json")).toBe(path.join("/tmp/x", "sas"));
	});
});

describe("the exchange survives a process boundary", () => {
	it("the CLI derives the row from the key on disk, matching the browser's", async () => {
		// `web serve` starts the exchange; the CLI confirms it. They are two processes,
		// so the row must survive a JSON round trip through the filesystem — if it did
		// not, every real verification would read as a mismatch.
		const store = createFilesystemSasExchangeStore(resolveSasDir(policyPath));
		const handle = await startExchange(store);
		const fresh = createFilesystemSasExchangeStore(resolveSasDir(policyPath));
		const { emojiForExchange } = await import("./auth-verify.js");
		const onDisk = await emojiForExchange((await fresh.get(handle.id))!);
		expect(onDisk.map((e) => e.index)).toEqual(handle.emoji.map((e) => e.index));
	});

	it("settles exactly once across two store handles (the O_EXCL claim)", async () => {
		const store = createFilesystemSasExchangeStore(resolveSasDir(policyPath));
		const handle = await startExchange(store);
		const other = createFilesystemSasExchangeStore(resolveSasDir(policyPath));
		const first = await store.settle(handle.id, { state: "aborted", at: NOW, abortReason: "mismatch" });
		const second = await other.settle(handle.id, { state: "granted", at: NOW });
		expect(first).toBeTruthy();
		expect(second).toBeNull();
	});

	it("the exchange file and its directory are not world-readable", async () => {
		const store = createFilesystemSasExchangeStore(resolveSasDir(policyPath));
		const handle = await startExchange(store);
		const sasDir = resolveSasDir(policyPath);
		expect(fs.statSync(sasDir).mode & 0o777).toBe(0o700);
		expect(fs.statSync(path.join(sasDir, `${handle.id}.json`)).mode & 0o777).toBe(0o600);
	});

	it("refuses an exchange id that could escape the directory", async () => {
		const store = createFilesystemSasExchangeStore(resolveSasDir(policyPath));
		await expect(store.get("../../etc/passwd")).rejects.toThrow(/unsafe exchange id/);
	});
});

describe("the HTTP surface is mounted where the page expects it", () => {
	it("uses the one base path constant", () => {
		expect(SAS_HTTP_BASE).toBe("/auth/sas");
	});
});
