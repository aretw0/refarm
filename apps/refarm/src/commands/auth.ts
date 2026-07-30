import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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
	replaceSourceCandidates,
	validateIdentityLabel,
	type IdentityCandidate,
	type IdentityCandidateReport,
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

/** Remove `identity`'s credential. PURE — returns a new policy, never mutates.
 * Throws when the identity is not enrolled: asking to cut off a device that was
 * never there is a mistaken belief about the world, and reporting success would
 * leave the operator believing a device is off when it may simply be spelled
 * differently. Everything else in the file — other credentials, and any Slice-2
 * workspaces/memberships — is carried through verbatim. */
export function removeCredential(policy: AuthPolicyFile, identity: string): AuthPolicyFile {
	const credentials = Array.isArray(policy.credentials) ? policy.credentials : [];
	const at = credentials.findIndex((c) => c.identity === identity);
	if (at < 0) {
		throw new Error(`identity "${identity}" is not enrolled — nothing to revoke`);
	}
	return { ...policy, credentials: credentials.filter((_, index) => index !== at) };
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
	discover?: boolean;
}

/** Sentinel select-option value for "enroll a new identity" — chosen so it can never
 * collide with a real (validated, non-control-character) identity label. */
const NEW_DEVICE_CHOICE = " new-device";

/** Sentinel prefix for "invoke this discovery source NOW". Same trick as
 * `NEW_DEVICE_CHOICE`: a leading space, so it can never collide with a validated
 * identity label. */
const DISCOVER_CHOICE_PREFIX = " discover:";

function discoverChoice(sourceId: string): string {
	return `${DISCOVER_CHOICE_PREFIX}${sourceId}`;
}

export interface PromptedIdentity {
	identity: string;
	/** Picking an already-enrolled identity always means rotating its token. */
	impliedRotate: boolean;
}

export interface PromptForIdentityOptions {
	/** Devices already discovered before the prompt opened — the `--discover`
	 * pre-population. Empty in the plain interactive case. */
	candidates?: readonly IdentityCandidate[];
	/** Discovery verbs the operator may INVOKE from inside the prompt. One entry
	 * each, labelled by the source. Empty ⇒ byte-identical canonical prompt. */
	sources?: readonly IdentityCandidateSource[];
	/** Sources already invoked before the prompt opened, so their entry reads
	 * "again" rather than pretending nothing has been asked yet. */
	alreadyDiscovered?: readonly string[];
	/** Where a notice raised by an in-prompt discovery goes. */
	writeNotice?: (notice: string) => void;
}

/** Ask the operator which identity to enroll when none was passed as a CLI argument.
 * An empty policy with nothing to discover goes straight to a label prompt; anything
 * else offers a choice between rotating an already-enrolled identity, enrolling a
 * discovered device, asking a source to look, or typing a new name.
 *
 * `sources` is the seam an EXTENDED flow plugs into (see identity-candidates.ts):
 * each one contributes ONE invocable entry, worded by the source. This function
 * does not know, and must never learn, what any source asks — with an empty list
 * its behaviour is byte-identical to the canonical flow.
 *
 * Rules the list obeys, whatever contributed to it:
 *   - C2.1 the operator picks ONE device per invocation; there is no "enroll all",
 *     and discovering is a separate act from enrolling.
 *   - C2.2 "A new device" (free text) is always the last option, never removed —
 *     including immediately after a discovery.
 *   - C3 nothing is queried until an entry is picked. Rendering the entry costs
 *     no spawn; the pick IS the operator's declaration of intent.
 *   - a candidate that is already enrolled appears ONCE, as a rotate — a source
 *     seeing a device does not make it fresh. */
export async function promptForIdentity(
	operator: OperatorChannel,
	enrolledIdentities: string[],
	options: PromptForIdentityOptions = {},
): Promise<PromptedIdentity> {
	const sources = options.sources ?? [];
	const writeNotice = options.writeNotice ?? ((notice: string) => emitNotice(notice));
	let candidates: readonly IdentityCandidate[] = options.candidates ?? [];
	const invoked = new Set<string>(options.alreadyDiscovered ?? []);

	// Loops because a discovery is not an answer: it re-renders the same question
	// with more (or different) devices on it. Every other choice returns.
	for (;;) {
		if (enrolledIdentities.length === 0 && candidates.length === 0 && sources.length === 0) {
			const identity = await operator.ask({
				type: "text",
				question: "Label for the new device (e.g. my-phone)",
			});
			return { identity, impliedRotate: false };
		}

		const enrolled = new Set(enrolledIdentities);
		const byValue = new Map(candidates.map((c) => [c.value, c]));
		// Enrolled first (a candidate that matches one is folded into it, never listed
		// twice), then the discovered candidates, then the discovery verbs, then
		// always "A new device".
		const promptOptions = [
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
			...sources.map((source) => discoveryOption(source, invoked.has(source.id))),
			{ value: NEW_DEVICE_CHOICE, label: "A new device", description: "enroll a new identity" },
		];

		const choice = await operator.ask({
			type: "select",
			question: "Which device?",
			default: NEW_DEVICE_CHOICE,
			options: promptOptions,
		});

		const invokedSource = sources.find((source) => discoverChoice(source.id) === choice);
		if (invokedSource) {
			// The query happens HERE, at the moment of the pick, and again on every
			// re-pick. Nothing is memoised: the answer is a snapshot of the world as
			// it is right now, which is the only reason "again" means anything.
			const report = await collectIdentityCandidates([invokedSource]);
			for (const notice of report.notices) writeNotice(notice);
			candidates = replaceSourceCandidates(candidates, invokedSource.id, report.candidates);
			invoked.add(invokedSource.id);
			continue;
		}

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
}

/** One source, one entry — worded by the source, laid out by the prompt. */
function discoveryOption(
	source: IdentityCandidateSource,
	alreadyInvoked: boolean,
): { value: string; label: string; description?: string } {
	const { label, againLabel, description, againDescription } = source.discovery;
	const qualifier = alreadyInvoked ? (againDescription ?? description) : description;
	return {
		value: discoverChoice(source.id),
		label: alreadyInvoked ? againLabel : label,
		...(qualifier === undefined ? {} : { description: qualifier }),
	};
}

/** Notices are the operator's channel, not a log: indented under the prompt, on
 * stdout, exactly as `runAuthEnroll` prints the ones raised before it opens. */
function emitNotice(notice: string): void {
	process.stdout.write(`  ${notice}\n`);
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
	/** Extended flows the operator may INVOKE from the interactive list. Defaults to
	 * `defaultIdentityCandidateSources()`. Registering a source costs nothing until
	 * its entry is picked — no source is consulted just for being registered. Pass
	 * `[]` to pin a test to the strictly canonical prompt. */
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
		.option(
			"--discover",
			"Ask every discovery source for devices. Interactively, the list arrives populated; " +
				"otherwise the candidates are printed and NOTHING is enrolled.",
		)
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

	const input = deps.input ?? process.stdin;
	const output = deps.output ?? process.stdout;
	const interactive = Boolean(input.isTTY && output.isTTY);
	// The prompt can only run when there is somewhere to prompt AND nothing has
	// already answered the question. Everything else is a non-interactive call.
	const canPrompt = !identityArg && !options.json && (interactive || Boolean(deps.operator));
	const sources = deps.identityCandidateSources ?? defaultIdentityCandidateSources();

	// `--discover` outside the interactive picker REPORTS and stops. Seeing a
	// device is not authorising it (C2.1): a script discovers here, then enrols by
	// explicit label in a second call. Exit 0 — nothing failed, nothing was minted.
	if (options.discover && !canPrompt) {
		await reportDiscovery(sources, Boolean(options.json));
		return;
	}

	if (!identity) {
		// --json is a non-interactive contract by nature — fail clearly rather than prompt.
		if (options.json) {
			console.error(
				"refarm auth enroll: an identity is required with --json (non-interactive; does not prompt)",
			);
			process.exitCode = 1;
			return;
		}

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

		// `--discover` only skips a keystroke: it runs, up front, exactly the query
		// the operator would otherwise invoke from the list. Without it NOTHING is
		// queried before the prompt — the entry is rendered, and picking it asks.
		const upFront =
			options.discover && sources.length > 0
				? await collectIdentityCandidates(sources)
				: NO_IDENTITY_CANDIDATES;
		// C2.3: a source that could not ask says so, in its own words — never by
		// rendering an empty list that reads as "you have no devices".
		for (const notice of upFront.notices) emitNotice(notice);

		const picked = await promptForIdentity(operator, enrolledIdentities, {
			candidates: upFront.candidates,
			sources,
			alreadyDiscovered: options.discover ? sources.map((source) => source.id) : [],
		});
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

	// The daemon DERIVES this path from the declaration: a surface declaring
	// `"gate": "device-token"` reads `<refarm-dir>/auth-policy.json` with no env at
	// all. `REFARM_AUTH_POLICY` is an override, so it is only worth mentioning when
	// the operator chose a path the derivation will not find. Deliberately does NOT
	// read the config to check whether a gate is declared — enrolment stopped
	// depending on the declaration, and re-introducing that read here would put the
	// coupling back one command over.
	const enableHint = `REFARM_AUTH_POLICY=${options.policy ?? DEFAULT_POLICY_PATH}`;
	// `--policy` carries DEFAULT_POLICY_PATH as its option default, so this is never
	// undefined: an unpassed flag compares equal and the override goes unmentioned.
	const enableRequired = options.policy !== DEFAULT_POLICY_PATH;
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ ok: true, identity: validIdentity, token, policy: policyPath, enable: enableHint, enableRequired })}\n`,
		);
		return;
	}
	const gateLine = enableRequired
		? `   Turn the gate on (restart the daemon with):\n     ${enableHint}\n` +
			`     (this path is not the derived default — the override is required)\n`
		: `   Restart the daemon to load it. A surface declaring "gate": "device-token"\n` +
			`   picks this file up automatically — no environment variable needed.\n`;
	process.stdout.write(
		`🔑 enrolled "${validIdentity}"\n\n` +
			`   TOKEN (shown once — save it on the device):\n     ${token}\n\n` +
			`   On the device:  FARM_TOKEN=${token} ${refarmCommand(["ask", '"olá"'])}\n` +
			`                   (or: FARM_TOKEN=… node .../farm-ask.mjs "…")\n` +
			gateLine +
			`   Policy: ${policyPath} (mode 0600; only the token's sha256 is stored)\n`,
	);
}

/**
 * `--discover` outside the interactive picker: ask every source, print what came
 * back, mint NOTHING.
 *
 * This is C2.1 held at the machine boundary. Interactively, "I can see eight
 * devices" is prevented from becoming "enrol eight devices" by the list being a
 * single-select; non-interactively there is no operator to pick, so the only
 * honest thing to return is the list. A script that wants a credential asks for
 * one by name in a second call, which is an explicit authorisation of exactly one
 * device. Exit code stays 0: discovering nothing is an answer, not a failure.
 */
async function reportDiscovery(
	sources: readonly IdentityCandidateSource[],
	json: boolean,
): Promise<void> {
	const report: IdentityCandidateReport =
		sources.length === 0 ? NO_IDENTITY_CANDIDATES : await collectIdentityCandidates(sources);
	const enrollHint = refarmCommand(["auth", "enroll", "<label>"]);

	if (json) {
		process.stdout.write(
			`${JSON.stringify({
				ok: true,
				// Named `enrolled: false` rather than left implicit: a consumer must be
				// able to see, in the payload itself, that discovery minted nothing.
				enrolled: false,
				discovered: report.candidates.map((candidate) => ({
					identity: candidate.value,
					source: candidate.source ?? null,
					description: candidate.description ?? null,
					needsConfirmation: Boolean(candidate.needsConfirmation),
					rawName: candidate.rawName ?? null,
				})),
				notices: report.notices,
				nextCommand: enrollHint,
				nextCommands: [enrollHint],
			})}\n`,
		);
		return;
	}

	for (const notice of report.notices) emitNotice(notice);
	if (report.candidates.length === 0) {
		process.stdout.write(`No devices discovered. Nothing was enrolled.\n`);
		return;
	}
	const lines = report.candidates.map((candidate) => {
		const qualifier = candidate.description ? ` — ${candidate.description}` : "";
		return `  • ${candidate.value}${qualifier}`;
	});
	process.stdout.write(
		`Discovered devices (nothing was enrolled):\n${lines.join("\n")}\n\n` +
			`   Enrol one by name:  ${enrollHint}\n`,
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

interface RevokeOptions {
	policy?: string;
	json?: boolean;
	yes?: boolean;
}

export interface AuthRevokeDeps {
	/** Pre-built operator channel — tests inject `createScriptedOperatorChannel(...)`
	 * to drive the picker and the confirmation without ever touching a TTY. */
	operator?: OperatorChannel;
	input?: NodeJS.ReadStream;
	output?: NodeJS.WriteStream;
}

/**
 * Ask WHICH enrolled device to cut off.
 *
 * A deliberate sibling of `promptForIdentity` rather than a reuse of it: that
 * prompt's list always ends in "A new device", and every enrolled entry there is
 * described as "rotate its token". Both are exactly wrong here — you cannot
 * revoke a device that was never enrolled, and picking one must not read as
 * rotating it. What IS shared is the contract: one `OperatorChannel`, one
 * single-select, one device per invocation.
 *
 * There is no "revoke all" entry, and there must never be one. A list is a
 * convenience for finding the right name; cutting off every device at once is a
 * different act with a different blast radius, and it does not get to be one
 * keystroke away from the common case.
 */
export async function promptForIdentityToRevoke(
	operator: OperatorChannel,
	enrolledIdentities: readonly string[],
): Promise<string> {
	return operator.ask({
		type: "select",
		question: "Which device's credential should stop working?",
		options: enrolledIdentities.map((identity) => ({
			value: identity,
			label: identity,
			description: "revoke its credential",
		})),
	});
}

export function createAuthRevokeCommand(deps: AuthRevokeDeps = {}): Command {
	return new Command("revoke")
		.description("Remove a device's credential from the sidecar auth policy")
		.argument(
			"[identity]",
			"The enrolled identity to cut off, e.g. my-phone. Omit to choose interactively.",
		)
		.option("--policy <path>", "Auth policy file to update", DEFAULT_POLICY_PATH)
		.option("--json", "Print the result as JSON")
		.option("--yes", "Skip the confirmation (requires the identity as an argument)")
		.action(async (identityArg: string | undefined, options: RevokeOptions) => {
			try {
				await runAuthRevoke(deps, identityArg, options);
			} catch (error) {
				// Interactive-only: cancelling the picker or the confirmation (Ctrl+C /
				// Ctrl+D) is a normal exit, not a crash — and it must leave the policy
				// untouched, which it does because nothing is written before both
				// prompts have returned. Mirrors `createAuthEnrollCommand`.
				if (!(error instanceof OperatorPromptCancelledError)) throw error;
				console.log("\n  Cancelled. Nothing was revoked.");
				process.exitCode = 130;
			}
		});
}

async function runAuthRevoke(
	deps: AuthRevokeDeps,
	identityArg: string | undefined,
	options: RevokeOptions,
): Promise<void> {
	const policyPath = path.resolve(options.policy ?? DEFAULT_POLICY_PATH);
	const input = deps.input ?? process.stdin;
	const output = deps.output ?? process.stdout;
	const interactive = Boolean(input.isTTY && output.isTTY);
	// There is somewhere to ask only when a real terminal (or an injected channel)
	// is present. `--json` and `--yes` are non-interactive contracts by nature, so
	// both forfeit prompting entirely — including the picker.
	const mayAsk = !options.json && !options.yes && (interactive || Boolean(deps.operator));
	// Built at most once, and only on a path where prompting is legitimate — never
	// `createAutoOperatorChannel()`, which would answer a destructive question with
	// a default.
	let channel: OperatorChannel | undefined;
	const operatorChannel = (): OperatorChannel =>
		(channel ??= deps.operator ?? createStdioOperatorChannel({ input, output }));

	let policy: AuthPolicyFile;
	try {
		policy = await readPolicy(policyPath);
	} catch (error) {
		console.error((error as Error).message);
		process.exitCode = 1;
		return;
	}
	const enrolled = policy.credentials.map((c) => c.identity);

	let identity = identityArg;
	if (!identity) {
		if (!mayAsk) {
			// Never construct `createAutoOperatorChannel()` on this path: it answers
			// every prompt with a default, which for a select over enrolled devices
			// would silently pick the first one and revoke it. Destructive work does
			// not get a default.
			console.error(
				options.json
					? `${refarmCommand(["auth", "revoke"])}: an identity is required with --json (non-interactive; does not prompt)`
					: "error: missing required argument 'identity'\n" +
							`  (not running interactively — pass one explicitly, e.g. \`${refarmCommand(["auth", "revoke", "my-phone"])}\`)`,
			);
			process.exitCode = 1;
			return;
		}
		if (enrolled.length === 0) {
			console.error(`No devices are enrolled in ${policyPath} — nothing to revoke.`);
			process.exitCode = 1;
			return;
		}
		identity = await promptForIdentityToRevoke(operatorChannel(), enrolled);
	}

	// Deliberately NOT validated with `validateIdentityLabel`: revocation must be
	// able to remove whatever is actually in the file. A label that today's
	// validator would reject (written by an older version, or by hand) is exactly
	// the credential an operator most needs to be able to cut off.
	if (mayAsk) {
		const confirmed = await operatorChannel().ask({
			type: "confirm",
			question: `Revoke "${identity}"? Its token stops working and cannot be recovered.`,
			default: false,
		});
		if (!confirmed) {
			process.stdout.write("  Nothing was revoked.\n");
			return;
		}
	}

	// Re-read at the moment of the write, exactly as enrolment does: the file may
	// have changed while a human was reading the confirmation.
	let next: AuthPolicyFile;
	try {
		next = removeCredential(await readPolicy(policyPath), identity);
	} catch (error) {
		console.error((error as Error).message);
		process.exitCode = 1;
		return;
	}
	await mkdir(path.dirname(policyPath), { recursive: true });
	await writeFile(policyPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
	// `mode` on `writeFile` only applies when the file is CREATED, and a revoke by
	// definition rewrites one that exists — so state the mode explicitly rather
	// than inheriting whatever the file happened to carry.
	await chmod(policyPath, 0o600);

	const remaining = next.credentials.map((c) => c.identity);
	const listHint = refarmCommand(["auth", "list"]);
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ ok: true, identity, revoked: true, policy: policyPath, remaining, nextCommand: listHint, nextCommands: [listHint] })}\n`,
		);
		return;
	}
	const remainingLine =
		remaining.length === 0
			? `   No devices remain enrolled — this policy now matches no token.\n`
			: `   Still enrolled: ${remaining.join(", ")}\n`;
	process.stdout.write(
		`🗝  revoked "${identity}"\n\n` +
			remainingLine +
			`   Policy: ${policyPath} (mode 0600)\n` +
			`   Confirm with:  ${listHint}\n`,
	);
}

export function createAuthCommand(): Command {
	return new Command("auth")
		.description("Manage the sidecar auth gate — enroll, list and revoke device credentials")
		.addCommand(createAuthEnrollCommand())
		.addCommand(createAuthListCommand())
		.addCommand(createAuthRevokeCommand());
}

export const authCommand = createAuthCommand();
