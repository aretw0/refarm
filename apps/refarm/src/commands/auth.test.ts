import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createScriptedOperatorChannel } from "@refarm.dev/prompt-contract-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthPolicyFile } from "./auth.js";
import {
	createAuthEnrollCommand,
	promptForIdentity,
	sha256Hex,
	upsertCredential,
	validateIdentityLabel,
} from "./auth.js";

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
});

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
});
