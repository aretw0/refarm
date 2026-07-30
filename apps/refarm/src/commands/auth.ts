import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
	createAutoOperatorChannel,
	createStdioOperatorChannel,
	type OperatorChannel,
} from "@refarm.dev/prompt-contract-v1";
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
		throw new Error(
			`identity "${identity}" is already enrolled — pass --rotate to replace its token`,
		);
	}
	const entry: AuthCredential = { identity, tokenSha256 };
	const next =
		at >= 0 ? credentials.map((c, i) => (i === at ? entry : c)) : [...credentials, entry];
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

/** Sentinel select-option value for "enroll a new identity" — chosen so it can never
 * collide with a real (validated, non-control-character) identity label. */
const NEW_DEVICE_CHOICE = " new-device";

/** Validate a device/identity label, whether it came from the CLI argument or an
 * interactively typed prompt — both paths must reject the same malformed input.
 * PURE. Minimum bar: non-empty after trimming, no control characters. */
export function validateIdentityLabel(label: string): string {
	const trimmed = label.trim();
	if (!trimmed) {
		throw new Error("identity label must not be empty");
	}
	for (let i = 0; i < trimmed.length; i++) {
		const code = trimmed.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) {
			throw new Error("identity label must not contain control characters");
		}
	}
	return trimmed;
}

export interface PromptedIdentity {
	identity: string;
	/** Picking an already-enrolled identity always means rotating its token. */
	impliedRotate: boolean;
}

/** Ask the operator which identity to enroll when none was passed as a CLI argument.
 * An empty policy goes straight to a label prompt; a populated one offers a choice
 * between rotating an already-enrolled identity or enrolling a new one. */
export async function promptForIdentity(
	operator: OperatorChannel,
	enrolledIdentities: string[],
): Promise<PromptedIdentity> {
	if (enrolledIdentities.length === 0) {
		const identity = await operator.ask({
			type: "text",
			question: "Label for the new device (e.g. arthur-phone)",
		});
		return { identity, impliedRotate: false };
	}

	const choice = await operator.ask({
		type: "select",
		question: "Which device?",
		default: NEW_DEVICE_CHOICE,
		options: [
			...enrolledIdentities.map((id) => ({
				value: id,
				label: id,
				description: "rotate its token",
			})),
			{ value: NEW_DEVICE_CHOICE, label: "A new device", description: "enroll a new identity" },
		],
	});

	if (choice === NEW_DEVICE_CHOICE) {
		const identity = await operator.ask({
			type: "text",
			question: "Label for the new device (e.g. arthur-phone)",
		});
		return { identity, impliedRotate: false };
	}
	return { identity: choice, impliedRotate: true };
}

export interface AuthEnrollDeps {
	/** Pre-built operator channel — tests inject `createScriptedOperatorChannel(...)`
	 * to drive prompts without ever touching a TTY or stdin. When absent, the real
	 * command picks one by TTY detection: `input.isTTY && output.isTTY ? stdio : auto`. */
	operator?: OperatorChannel;
	input?: NodeJS.ReadStream;
	output?: NodeJS.WriteStream;
}

export function createAuthEnrollCommand(deps: AuthEnrollDeps = {}): Command {
	return new Command("enroll")
		.description("Mint a per-device credential and write it into the sidecar auth policy")
		.argument(
			"[identity]",
			"A label for the device/identity, e.g. arthur-phone. Omit to choose interactively.",
		)
		.option("--policy <path>", "Auth policy file to write", DEFAULT_POLICY_PATH)
		.option("--rotate", "Replace the token if this identity is already enrolled")
		.option("--json", "Print the result as JSON")
		.action(async (identityArg: string | undefined, options: EnrollOptions) => {
			const policyPath = path.resolve(options.policy ?? DEFAULT_POLICY_PATH);
			let identity = identityArg;
			let rotate = Boolean(options.rotate);

			if (!identity) {
				// --json is a non-interactive contract by nature — fail clearly rather than prompt.
				if (options.json) {
					console.error(
						"refarm auth enroll: an identity is required with --json (non-interactive; does not prompt)",
					);
					process.exitCode = 1;
					return;
				}

				const input = deps.input ?? process.stdin;
				const output = deps.output ?? process.stdout;
				const interactive = Boolean(input.isTTY && output.isTTY);

				// No TTY and no pre-built channel: never construct createAutoOperatorChannel()
				// here — it answers every prompt with a default, which for an identity label
				// would silently invent one. Fail with the usage message instead.
				if (!interactive && !deps.operator) {
					console.error(
						"error: missing required argument 'identity'\n" +
							"  (not running interactively — pass one explicitly, e.g. `refarm auth enroll arthur-phone`)",
					);
					process.exitCode = 1;
					return;
				}

				const operator: OperatorChannel =
					deps.operator ??
					(interactive
						? createStdioOperatorChannel({ input, output })
						: createAutoOperatorChannel());

				let existingPolicy: AuthPolicyFile;
				try {
					existingPolicy = await readPolicy(policyPath);
				} catch (error) {
					console.error((error as Error).message);
					process.exitCode = 1;
					return;
				}
				const enrolledIdentities = existingPolicy.credentials.map((c) => c.identity);

				const picked = await promptForIdentity(operator, enrolledIdentities);
				identity = picked.identity;
				rotate = rotate || picked.impliedRotate;
			}

			let validIdentity: string;
			try {
				validIdentity = validateIdentityLabel(identity);
			} catch (error) {
				console.error((error as Error).message);
				process.exitCode = 1;
				return;
			}

			const token = randomBytes(32).toString("base64url");
			let next: AuthPolicyFile;
			try {
				const policy = await readPolicy(policyPath);
				next = upsertCredential(policy, validIdentity, sha256Hex(token), rotate);
			} catch (error) {
				console.error((error as Error).message);
				process.exitCode = 1;
				return;
			}
			await mkdir(path.dirname(policyPath), { recursive: true });
			await writeFile(policyPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });

			const enableHint = `REFARM_AUTH_POLICY=${options.policy ?? DEFAULT_POLICY_PATH}`;
			if (options.json) {
				process.stdout.write(
					`${JSON.stringify({ ok: true, identity: validIdentity, token, policy: policyPath, enable: enableHint })}\n`,
				);
				return;
			}
			process.stdout.write(
				`🔑 enrolled "${validIdentity}"\n\n` +
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
			process.stdout.write(
				`Enrolled devices (${policyPath}):\n${identities.map((id) => `  • ${id}`).join("\n")}\n`,
			);
		});
}

export function createAuthCommand(): Command {
	return new Command("auth")
		.description("Manage the sidecar auth gate — enroll device credentials")
		.addCommand(createAuthEnrollCommand())
		.addCommand(createAuthListCommand());
}

export const authCommand = createAuthCommand();
