import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { refarmCommand } from "../brand.js";

/**
 * `refarm auth enroll` — mint a per-device credential and write it into the
 * sidecar's auth policy, so the operator can turn the gate on without
 * hand-crafting JSON. The policy stores only each token's SHA-256 (never the raw
 * token); the token is printed ONCE for the device to carry as FARM_TOKEN. See
 * docs/superpowers/specs/2026-07-24-sovereign-auth-workspaces-design.md.
 */

const DEFAULT_POLICY_PATH = ".refarm/auth-policy.json";

/** SHA-256 as lowercase hex — the exact digest the daemon (auth.rs) matches. */
export function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

export interface AuthCredential {
	identity: string;
	tokenSha256: string;
}

export interface AuthPolicyFile {
	credentials: AuthCredential[];
	// workspaces/memberships (Slice 2) are preserved verbatim if present.
	[key: string]: unknown;
}

/** Add or rotate a credential for `identity`. PURE — returns a new policy, never
 * mutates. Throws if the identity is already enrolled and `rotate` is false, so a
 * device is never silently clobbered. */
export function upsertCredential(
	policy: AuthPolicyFile,
	identity: string,
	tokenSha256: string,
	rotate: boolean,
): AuthPolicyFile {
	const credentials = Array.isArray(policy.credentials) ? policy.credentials : [];
	const at = credentials.findIndex((c) => c.identity === identity);
	if (at >= 0 && !rotate) {
		throw new Error(`identity "${identity}" is already enrolled — pass --rotate to replace its token`);
	}
	const entry: AuthCredential = { identity, tokenSha256 };
	const next = at >= 0 ? credentials.map((c, i) => (i === at ? entry : c)) : [...credentials, entry];
	return { ...policy, credentials: next };
}

/** Read the policy file, tolerant of a missing file (→ empty policy) but NOT of a
 * corrupt one (a present-but-broken policy must not be silently overwritten). */
async function readPolicy(policyPath: string): Promise<AuthPolicyFile> {
	let raw: string;
	try {
		raw = await readFile(policyPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { credentials: [] };
		throw error;
	}
	const parsed = JSON.parse(raw) as AuthPolicyFile;
	return { ...parsed, credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [] };
}

interface EnrollOptions {
	policy?: string;
	rotate?: boolean;
	json?: boolean;
}

export function createAuthEnrollCommand(): Command {
	return new Command("enroll")
		.description("Mint a per-device credential and write it into the sidecar auth policy")
		.argument("<identity>", "A label for the device/identity, e.g. arthur-phone")
		.option("--policy <path>", "Auth policy file to write", DEFAULT_POLICY_PATH)
		.option("--rotate", "Replace the token if this identity is already enrolled")
		.option("--json", "Print the result as JSON")
		.action(async (identity: string, options: EnrollOptions) => {
			const policyPath = path.resolve(options.policy ?? DEFAULT_POLICY_PATH);
			const token = randomBytes(32).toString("base64url");
			const policy = await readPolicy(policyPath);
			const next = upsertCredential(policy, identity, sha256Hex(token), Boolean(options.rotate));
			await mkdir(path.dirname(policyPath), { recursive: true });
			await writeFile(policyPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });

			const enableHint = `REFARM_AUTH_POLICY=${options.policy ?? DEFAULT_POLICY_PATH}`;
			if (options.json) {
				process.stdout.write(
					`${JSON.stringify({ ok: true, identity, token, policy: policyPath, enable: enableHint })}\n`,
				);
				return;
			}
			process.stdout.write(
				`🔑 enrolled "${identity}"\n\n` +
					`   TOKEN (shown once — save it on the device):\n     ${token}\n\n` +
					`   On the device:  FARM_TOKEN=${token} ${refarmCommand(["ask", '"olá"'])}\n` +
					`                   (or: FARM_TOKEN=… node .../farm-ask.mjs "…")\n` +
					`   Turn the gate on (restart the daemon with):\n     ${enableHint}\n` +
					`   Policy: ${policyPath} (mode 0600; only the token's sha256 is stored)\n`,
			);
		});
}

interface ListOptions {
	policy?: string;
	json?: boolean;
}

export function createAuthListCommand(): Command {
	return new Command("list")
		.description("List enrolled identities (never the tokens)")
		.option("--policy <path>", "Auth policy file to read", DEFAULT_POLICY_PATH)
		.option("--json", "Print the result as JSON")
		.action(async (options: ListOptions) => {
			const policyPath = path.resolve(options.policy ?? DEFAULT_POLICY_PATH);
			const policy = await readPolicy(policyPath);
			const identities = (policy.credentials ?? []).map((c) => c.identity);
			if (options.json) {
				process.stdout.write(`${JSON.stringify({ ok: true, identities })}\n`);
				return;
			}
			if (identities.length === 0) {
				process.stdout.write(`No devices enrolled in ${policyPath}.\n`);
				return;
			}
			process.stdout.write(`Enrolled devices (${policyPath}):\n${identities.map((id) => `  • ${id}`).join("\n")}\n`);
		});
}

export function createAuthCommand(): Command {
	return new Command("auth")
		.description("Manage the sidecar auth gate — enroll device credentials")
		.addCommand(createAuthEnrollCommand())
		.addCommand(createAuthListCommand());
}

export const authCommand = createAuthCommand();
