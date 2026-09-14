import { OperatorPromptCancelledError, type OperatorChannel } from "@refarm.dev/prompt-contract-v1";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createAuthEnrollCommand,
	promptForIdentity,
	sha256Hex,
	upsertCredential,
	validateIdentityLabel,
	type AuthPolicyFile,
} from "../../src/commands/auth.js";

describe("upsertCredential", () => {
	it("adds a new credential to an empty policy", () => {
		const policy: AuthPolicyFile = { credentials: [] };
		const next = upsertCredential(policy, "my-phone", "abc123", false);
		expect(next.credentials).toEqual([{ identity: "my-phone", tokenSha256: "abc123" }]);
		// Pure — the input policy is untouched.
		expect(policy.credentials).toEqual([]);
	});

	it("throws when the identity is already enrolled and rotate is false", () => {
		const policy: AuthPolicyFile = {
			credentials: [{ identity: "my-phone", tokenSha256: "old" }],
		};
		expect(() => upsertCredential(policy, "my-phone", "new", false)).toThrow(/already enrolled/);
	});

	it("replaces the token when rotate is true", () => {
		const policy: AuthPolicyFile = {
			credentials: [{ identity: "my-phone", tokenSha256: "old" }],
		};
		const next = upsertCredential(policy, "my-phone", "new", true);
		expect(next.credentials).toEqual([{ identity: "my-phone", tokenSha256: "new" }]);
	});

	it("preserves unrelated top-level fields (workspaces/memberships)", () => {
		const policy: AuthPolicyFile = { credentials: [], workspaces: [{ id: "personal" }] };
		const next = upsertCredential(policy, "my-phone", "abc", false);
		expect(next.workspaces).toEqual([{ id: "personal" }]);
	});
});

describe("validateIdentityLabel", () => {
	it("trims surrounding whitespace", () => {
		expect(validateIdentityLabel("  my-phone  ")).toBe("my-phone");
	});

	it("rejects an empty (or whitespace-only) label", () => {
		expect(() => validateIdentityLabel("   ")).toThrow(/must not be empty/);
	});

	it("rejects control characters", () => {
		expect(() => validateIdentityLabel("myphone")).toThrow(/control characters/);
	});
});

describe("promptForIdentity", () => {
	it("goes straight to a text prompt when no identity is enrolled yet", async () => {
		const ask = vi.fn().mockResolvedValue("my-phone");
		const operator: OperatorChannel = { ask } as unknown as OperatorChannel;

		const result = await promptForIdentity(operator, []);

		expect(result).toEqual({ identity: "my-phone", impliedRotate: false });
		expect(ask).toHaveBeenCalledWith(expect.objectContaining({ type: "text" }));
	});

	it("offers a select between rotating an enrolled identity and a new device", async () => {
		const ask = vi.fn().mockResolvedValue("laptop-work");
		const operator: OperatorChannel = { ask } as unknown as OperatorChannel;

		const result = await promptForIdentity(operator, ["laptop-work"]);

		expect(result).toEqual({ identity: "laptop-work", impliedRotate: true });
		expect(ask).toHaveBeenCalledWith(expect.objectContaining({ type: "select" }));
	});
});

describe("createAuthEnrollCommand — cancellation", () => {
	let originalLog: typeof console.log;
	let logged: string[];

	beforeEach(() => {
		logged = [];
		originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logged.push(args.map(String).join(" "));
		};
	});

	afterEach(() => {
		console.log = originalLog;
		process.exitCode = undefined;
	});

	it("prints a calm message and exits 130 when the device-label prompt is cancelled (Ctrl+C/Ctrl+D)", async () => {
		const operator: OperatorChannel = {
			ask: vi.fn().mockRejectedValue(new OperatorPromptCancelledError()),
		} as unknown as OperatorChannel;
		const input = { isTTY: true } as NodeJS.ReadStream;
		const output = { isTTY: true } as NodeJS.WriteStream;

		const command = createAuthEnrollCommand({ operator, input, output });

		// Cancellation must resolve `parseAsync` cleanly — never reject/throw, and
		// never leave an unsettled promise behind (that unsettled-await warning is
		// exactly the defect this fix closes). If this rejected, `await` itself
		// would fail the test.
		await command.parseAsync([], { from: "user" });

		expect(process.exitCode).toBe(130);
		expect(logged.some((line) => line.includes("Cancelled"))).toBe(true);
	});

	it("does not swallow a non-cancellation error from the operator", async () => {
		const boom = new Error("boom");
		const operator: OperatorChannel = {
			ask: vi.fn().mockRejectedValue(boom),
		} as unknown as OperatorChannel;
		const input = { isTTY: true } as NodeJS.ReadStream;
		const output = { isTTY: true } as NodeJS.WriteStream;

		const command = createAuthEnrollCommand({ operator, input, output });

		await expect(command.parseAsync([], { from: "user" })).rejects.toThrow("boom");
		expect(process.exitCode).not.toBe(130);
	});
});

describe("createAuthEnrollCommand — help text", () => {
	it("does not use the operator's own name as the example device label", () => {
		const helpText = createAuthEnrollCommand().helpInformation();
		expect(helpText.toLowerCase()).not.toContain("arthur");
	});
});

describe("createAuthEnrollCommand — happy path", () => {
	let policyDir: string;
	let policyPath: string;

	beforeEach(async () => {
		policyDir = await mkdtemp(path.join(tmpdir(), "refarm-auth-test-"));
		policyPath = path.join(policyDir, "auth-policy.json");
	});

	afterEach(async () => {
		process.exitCode = undefined;
		await rm(policyDir, { recursive: true, force: true });
	});

	it("writes a policy entry with only the token's sha256 (never the raw token)", async () => {
		const command = createAuthEnrollCommand();
		await command.parseAsync(["my-phone", "--policy", policyPath, "--json"], { from: "user" });

		const written = JSON.parse(await readFile(policyPath, "utf8")) as AuthPolicyFile;
		expect(written.credentials).toHaveLength(1);
		const entry = written.credentials[0];
		expect(entry).toBeDefined();
		expect(entry?.identity).toBe("my-phone");
		expect(entry?.tokenSha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it("prints the same token whose sha256 was written to the policy", async () => {
		let stdout = "";
		const originalWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string) => {
			stdout += chunk;
			return true;
		}) as typeof process.stdout.write;

		try {
			const command = createAuthEnrollCommand();
			await command.parseAsync(["my-phone", "--policy", policyPath, "--json"], { from: "user" });
		} finally {
			process.stdout.write = originalWrite;
		}

		const result = JSON.parse(stdout) as { token: string };
		const written = JSON.parse(await readFile(policyPath, "utf8")) as AuthPolicyFile;
		expect(written.credentials[0]?.tokenSha256).toBe(sha256Hex(result.token));
	});
});
