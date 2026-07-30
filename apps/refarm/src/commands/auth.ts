import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
	createAutoOperatorChannel,
	createStdioOperatorChannel,
	OperatorPromptCancelledError,
	type OperatorChannel,
} from "@refarm.dev/prompt-contract-v1";
import { Command } from "commander";

import { refarmCommand } from "../brand.js";
import {
	collectIdentityCandidates,
	NO_IDENTITY_CANDIDATES,
	validateIdentityLabel,
	type IdentityCandidate,
	type IdentityCandidateSource,
} from "./identity-candidates.js";
import { defaultIdentityCandidateSources } from "./identity-sources.js";

// Re-exported so `validateIdentityLabel` stays part of this command's public
// surface (its callers and tests import it from here). It LIVES in
// identity-candidates.ts because the candidate sources need it too, and a source
// importing this file would close a cycle.
export { validateIdentityLabel } from "./identity-candidates.js";
export type { IdentityCandidate, IdentityCandidateSource } from "./identity-candidates.js";

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

export interface PromptedIdentity {
	identity: string;
	/** Picking an already-enrolled identity always means rotating its token. */
	impliedRotate: boolean;
}

/** Ask the operator which identity to enroll when none was passed as a CLI argument.
 * An empty policy goes straight to a label prompt; a populated one offers a choice
 * between rotating an already-enrolled identity or enrolling a new one.
 *
 * `candidates` is the seam an EXTENDED flow plugs into (see
 * identity-candidates.ts): devices some source can already see and propose a name
 * for. This function does not know, and must never learn, what any source is —
 * with an empty list its behaviour is byte-identical to the canonical flow.
 *
 * Three rules the list obeys, whatever contributed to it:
 *   - C2.1 the operator picks ONE device per invocation; there is no "enroll all".
 *   - C2.2 "A new device" (free text) is always the last option, never removed.
 *   - a candidate that is already enrolled appears ONCE, as a rotate — a source
 *     seeing a device does not make it fresh. */
export async function promptForIdentity(
	operator: OperatorChannel,
	enrolledIdentities: string[],
	candidates: readonly IdentityCandidate[] = [],
): Promise<PromptedIdentity> {
	if (enrolledIdentities.length === 0 && candidates.length === 0) {
		const identity = await operator.ask({
			type: "text",
			question: "Label for the new device (e.g. my-phone)",
		});
		return { identity, impliedRotate: false };
	}

	const enrolled = new Set(enrolledIdentities);
	const byValue = new Map(candidates.map((c) => [c.value, c]));
	// Enrolled first (a candidate that matches one is folded into it, never listed
	// twice), then the fresh candidates, then always "A new device".
	const options = [
		...enrolledIdentities.map((id) => ({
			value: id,
			label: id,
			description: withAction(byValue.get(id)?.description, "rotate its token"),
		})),
		...candidates
			.filter((c) => !enrolled.has(c.value))
			.map((c) => ({
				value: c.value,
				label: c.label,
				description: withAction(c.description, "enroll it"),
			})),
		{ value: NEW_DEVICE_CHOICE, label: "A new device", description: "enroll a new identity" },
	];

	const choice = await operator.ask({
		type: "select",
		question: "Which device?",
		default: NEW_DEVICE_CHOICE,
		options,
	});

	if (choice === NEW_DEVICE_CHOICE) {
		const identity = await operator.ask({
			type: "text",
			question: "Label for the new device (e.g. my-phone)",
		});
		return { identity, impliedRotate: false };
	}
	if (enrolled.has(choice)) return { identity: choice, impliedRotate: true };

	const candidate = byValue.get(choice);
	if (candidate?.needsConfirmation) {
		// The source had to repair this name to make it a usable label. Show the
		// operator the original and let them accept or edit the repair — a
		// credential's identity is theirs to choose, never something discovery
		// rewrites behind their back.
		const identity = await operator.ask({
			type: "text",
			question: `Label for "${candidate.rawName ?? choice}" (adjusted to a usable label — accept or edit)`,
			default: candidate.value,
		});
		return { identity, impliedRotate: false };
	}
	return { identity: choice, impliedRotate: false };
}

/** Compose a source's qualifier ("on your tailnet") with the canonical action
 * ("rotate its token"), so the canonical wording stays canonical and a source
 * never has to spell out what picking its candidate will do. */
function withAction(qualifier: string | undefined, action: string): string {
	return qualifier ? `${qualifier} — ${action}` : action;
}

export interface AuthEnrollDeps {
	/** Pre-built operator channel — tests inject `createScriptedOperatorChannel(...)`
	 * to drive prompts without ever touching a TTY or stdin. When absent, the real
	 * command picks one by TTY detection: `input.isTTY && output.isTTY ? stdio : auto`. */
	operator?: OperatorChannel;
	input?: NodeJS.ReadStream;
	output?: NodeJS.WriteStream;
	/** Extended flows that may CONTRIBUTE devices to the interactive list. Defaults
	 * to `defaultIdentityCandidateSources()`; each source gates itself on an
	 * operator declaration, so the default contributes nothing unless something was
	 * declared. Pass `[]` to pin a test to the strictly canonical flow. */
	identityCandidateSources?: readonly IdentityCandidateSource[];
}

export function createAuthEnrollCommand(deps: AuthEnrollDeps = {}): Command {
	return new Command("enroll")
		.description("Mint a per-device credential and write it into the sidecar auth policy")
		.argument(
			"[identity]",
			"A label for the device/identity, e.g. my-phone. Omit to choose interactively.",
		)
		.option("--policy <path>", "Auth policy file to write", DEFAULT_POLICY_PATH)
		.option("--rotate", "Replace the token if this identity is already enrolled")
		.option("--json", "Print the result as JSON")
		.action(async (identityArg: string | undefined, options: EnrollOptions) => {
			try {
				await runAuthEnroll(deps, identityArg, options);
			} catch (error) {
				// Interactive-only: an operator cancelling the device-label prompt (Ctrl+C
				// or Ctrl+D) is a normal exit, not a crash. Mirrors sow.ts's handling.
				if (!(error instanceof OperatorPromptCancelledError)) throw error;
				console.log("\n  Cancelled.");
				process.exitCode = 130;
			}
		});
}

async function runAuthEnroll(
	deps: AuthEnrollDeps,
	identityArg: string | undefined,
	options: EnrollOptions,
): Promise<void> {
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
					"  (not running interactively — pass one explicitly, e.g. `refarm auth enroll my-phone`)",
			);
			process.exitCode = 1;
			return;
		}

		const operator: OperatorChannel =
			deps.operator ??
			(interactive ? createStdioOperatorChannel({ input, output }) : createAutoOperatorChannel());

		let existingPolicy: AuthPolicyFile;
		try {
			existingPolicy = await readPolicy(policyPath);
		} catch (error) {
			console.error((error as Error).message);
			process.exitCode = 1;
			return;
		}
		const enrolledIdentities = existingPolicy.credentials.map((c) => c.identity);

		// Extended flows get their say HERE and only here — after --json and the
		// no-TTY guard have already returned, so neither ever queries anything, and
		// before the prompt, which only ever sees plain candidates.
		const sources = deps.identityCandidateSources ?? defaultIdentityCandidateSources();
		const contributed =
			sources.length === 0 ? NO_IDENTITY_CANDIDATES : await collectIdentityCandidates(sources);
		// C2.3: a source that could not ask says so, in its own words, BEFORE the
		// prompt — never by rendering an empty list that reads as "you have no
		// devices". Then the canonical prompt runs regardless.
		for (const notice of contributed.notices) {
			process.stdout.write(`  ${notice}\n`);
		}

		const picked = await promptForIdentity(operator, enrolledIdentities, contributed.candidates);
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
