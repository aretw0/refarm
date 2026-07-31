import { randomBytes } from "node:crypto";
import path from "node:path";

import { buildJsonErrorEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import {
	isScopedCredentialExpired,
	readScopedCredentials,
	removeScopedCredential,
	type ScopedCredential,
} from "@refarm.dev/emoji-sas-v1";
import {
	createAutoOperatorChannel,
	createStdioOperatorChannel,
	OperatorPromptCancelledError,
	type OperatorChannel,
} from "@refarm.dev/prompt-contract-v1";
import { Command } from "commander";

import { refarmCommand } from "../brand.js";
import {
	readPolicy,
	sha256Hex,
	writePolicy,
	type AuthCredential,
	type AuthPolicyFile,
} from "./auth-policy-file.js";
import { createAuthRemoteCommand } from "./auth-remote.js";
import { createAuthVerifyCommand, formatLifetime } from "./auth-verify.js";
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

// The file contract moved to `auth-policy-file.ts` so `auth verify` can write the same
// file without closing an import cycle with this module (which registers it as a
// subcommand). Re-exported here because this IS the credential command's public
// surface, and its callers and tests have always imported them from here.
export { sha256Hex } from "./auth-policy-file.js";
export type { AuthCredential, AuthPolicyFile } from "./auth-policy-file.js";

/**
 * `refarm auth enroll` — mint a per-device credential and write it into the
 * sidecar's auth policy, so the operator can turn the gate on without
 * hand-crafting JSON. The policy stores only each token's SHA-256 (never the raw
 * token); the token is printed ONCE for the device to carry as FARM_TOKEN. See
 * docs/superpowers/specs/2026-07-24-sovereign-auth-workspaces-design.md.
 */

const DEFAULT_POLICY_PATH = ".refarm/auth-policy.json";

/** The handoffs a refused credential command carries. `auth list` names identities and never
 *  tokens, so it is always safe to send an operator (or an agent) there. */
const AUTH_LIST_HINT = refarmCommand(["auth", "list"]);
const ENROLL_LABEL_HINT = refarmCommand(["auth", "enroll", "my-phone"]);
const REVOKE_LABEL_HINT = refarmCommand(["auth", "revoke", "my-phone"]);

/**
 * A refusal that respects `--json`.
 *
 * Both credential commands refused correctly for a human — one sentence on stderr, exit 1 —
 * and gave a `--json` consumer that same sentence with NOTHING on stdout: no envelope, no
 * error code, no handoff. The human text is unchanged, byte for byte; this only adds the
 * machine-readable half that was missing.
 *
 * TWO invariants, because this is the credential path:
 *
 *  - the envelope NEVER carries token material. It names the identity and the policy PATH;
 *    a minted token is printed exactly once, on the success path, and never here.
 *  - every call site sits BEFORE the policy write. A refused enrol or revoke leaves
 *    `auth-policy.json` exactly as it found it — there is no half-written policy to undo.
 */
function refuseAuth(input: {
	json: boolean;
	operation: "enroll" | "revoke";
	error: string;
	/** The envelope `message` — the same sentence the human mode prints, without its layout. */
	message: string;
	/** The exact stderr text human mode has always printed. */
	text: string;
	nextAction: string;
	nextCommand: string;
}): void {
	if (input.json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "auth",
				operation: input.operation,
				error: input.error,
				message: input.message,
				nextAction: input.nextAction,
				nextCommand: input.nextCommand,
				nextCommands: [input.nextCommand],
			}),
		);
	} else {
		console.error(input.text);
	}
	process.exitCode = 1;
}

/** Where `@refarm.dev/farm-client`'s cold-bootstrap (`bootstrap/install.mjs`)
 * puts the zero-dependency kit on a device: `~/.refarm/kit/farm-client`. Spelled
 * out in full — never elided to `.../` — because this is a line an operator
 * copies onto a phone while holding a one-shot token. */
const FARM_CLIENT_ASK_PATH = "~/.refarm/kit/farm-client/bin/farm-ask.mjs";

/**
 * How the DEVICE spends the token it was just handed.
 *
 * The zero-dependency form leads. This node cannot know what the other machine
 * has, and must not guess: the device that most needs a credential is precisely
 * the one carrying only the `farm-client` kit (a phone in Termux — `node` and
 * nothing else), so instructing it with THIS node's CLI name produced a literal
 * `No command refarm found`. Both forms are printed, honestly, cheapest-to-
 * satisfy first — the CLI form is the alternative, not the headline.
 */
export function deviceInstructionLines(token: string): string {
	return (
		`   On the device — with the zero-dependency kit (needs only node):\n` +
		`     FARM_TOKEN=${token} node ${FARM_CLIENT_ASK_PATH} "olá"\n` +
		`   On a device that has the CLI installed:\n` +
		`     FARM_TOKEN=${token} ${refarmCommand(["ask", '"olá"'])}\n`
	);
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
			refuseAuth({
				json: true,
				operation: "enroll",
				error: "identity-required",
				message: "an identity is required with --json (non-interactive; does not prompt)",
				text: "refarm auth enroll: an identity is required with --json (non-interactive; does not prompt)",
				nextAction: `Pass the device label explicitly, e.g. \`${ENROLL_LABEL_HINT}\`.`,
				nextCommand: ENROLL_LABEL_HINT,
			});
			return;
		}

		// No TTY and no pre-built channel: never construct createAutoOperatorChannel()
		// here — it answers every prompt with a default, which for an identity label
		// would silently invent one. Fail with the usage message instead.
		if (!interactive && !deps.operator) {
			refuseAuth({
				json: false,
				operation: "enroll",
				error: "identity-required",
				message: "missing required argument 'identity'",
				text:
					"error: missing required argument 'identity'\n" +
					"  (not running interactively — pass one explicitly, e.g. `refarm auth enroll my-phone`)",
				nextAction: `Pass the device label explicitly, e.g. \`${ENROLL_LABEL_HINT}\`.`,
				nextCommand: ENROLL_LABEL_HINT,
			});
			return;
		}

		const operator: OperatorChannel =
			deps.operator ??
			(interactive ? createStdioOperatorChannel({ input, output }) : createAutoOperatorChannel());

		let existingPolicy: AuthPolicyFile;
		try {
			existingPolicy = await readPolicy(policyPath);
		} catch (error) {
			refuseAuth({
				json: Boolean(options.json),
				operation: "enroll",
				error: "auth-policy-unreadable",
				message: (error as Error).message,
				text: (error as Error).message,
				nextAction: `Inspect or repair the auth policy at ${policyPath}.`,
				nextCommand: AUTH_LIST_HINT,
			});
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
		refuseAuth({
			json: Boolean(options.json),
			operation: "enroll",
			error: "invalid-identity",
			message: (error as Error).message,
			text: (error as Error).message,
			nextAction: `Pass an accepted device label, e.g. \`${ENROLL_LABEL_HINT}\`.`,
			nextCommand: ENROLL_LABEL_HINT,
		});
		return;
	}

	const token = randomBytes(32).toString("base64url");
	let next: AuthPolicyFile;
	try {
		const policy = await readPolicy(policyPath);
		next = upsertCredential(policy, validIdentity, sha256Hex(token), rotate);
	} catch (error) {
		// Nothing has been written yet, and the token minted above is discarded unprinted:
		// a refused enrol leaves the policy — and the device — exactly as they were.
		refuseAuth({
			json: Boolean(options.json),
			operation: "enroll",
			error: "enroll-refused",
			message: (error as Error).message,
			text: (error as Error).message,
			nextAction: `Inspect what is enrolled with \`${AUTH_LIST_HINT}\`, then re-run with --rotate to replace a token.`,
			nextCommand: AUTH_LIST_HINT,
		});
		return;
	}
	await writePolicy(policyPath, next);

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
			deviceInstructionLines(token) +
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

/**
 * One line per scoped credential. PURE, and exported so the wording is testable.
 *
 * S3 requires a browser session to appear here "as its own entry rather than hiding
 * behind the device that opened it", which means the line has to carry the three facts
 * that distinguish it from a device: what it may do, and until when — and its ID, since
 * that is what `auth revoke` takes.
 */
export function formatScopedCredentialLine(credential: ScopedCredential, now: number): string {
	const remaining = credential.expiresAt - now;
	const when = isScopedCredentialExpired(credential, now)
		? "EXPIRED (it authenticates nothing; revoke to tidy up)"
		: `expires in ${formatLifetime(remaining)}`;
	return `  • ${credential.id}  ${credential.identity} — ${credential.scope.join(", ")} on ${credential.surface} — ${when}`;
}

export function createAuthListCommand(deps: { now?: () => number } = {}): Command {
	return new Command("list")
		.description("List enrolled identities and scoped credentials (never the tokens)")
		.option("--policy <path>", "Auth policy file to read", DEFAULT_POLICY_PATH)
		.option("--json", "Print the result as JSON")
		.action(async (options: ListOptions) => {
			const now = (deps.now ?? (() => Date.now()))();
			const policyPath = path.resolve(options.policy ?? DEFAULT_POLICY_PATH);
			const policy = await readPolicy(policyPath);
			const identities = (policy.credentials ?? []).map((c) => c.identity);
			const scoped = readScopedCredentials(policy);
			if (options.json) {
				// `identities` keeps its exact shape and meaning — DEVICE credentials, the
				// ones the daemon's gate honours. Scoped credentials are a sibling key, not
				// entries mixed into that list: a consumer counting devices must not start
				// counting browser sessions because a new feature shipped.
				process.stdout.write(
					`${JSON.stringify({
						ok: true,
						identities,
						scoped: scoped.map((credential) => ({
							id: credential.id,
							identity: credential.identity,
							scope: credential.scope,
							surface: credential.surface,
							issuedVia: credential.issuedVia,
							issuedAt: credential.issuedAt,
							expiresAt: credential.expiresAt,
							expired: isScopedCredentialExpired(credential, now),
						})),
					})}\n`,
				);
				return;
			}
			if (identities.length === 0 && scoped.length === 0) {
				process.stdout.write(`No devices enrolled in ${policyPath}.\n`);
				return;
			}
			if (identities.length === 0) {
				process.stdout.write(`No devices enrolled in ${policyPath}.\n`);
			} else {
				process.stdout.write(
					`Enrolled devices (${policyPath}):\n${identities.map((id) => `  • ${id}`).join("\n")}\n`,
				);
			}
			if (scoped.length > 0) {
				process.stdout.write(
					`\nScoped credentials (${policyPath}):\n` +
						`${scoped.map((credential) => formatScopedCredentialLine(credential, now)).join("\n")}\n` +
						`  These are NOT device credentials — the runtime's sidecar gate never sees them.\n`,
				);
			}
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
	scoped: readonly ScopedCredential[] = [],
): Promise<string> {
	return operator.ask({
		type: "select",
		question: "Which credential should stop working?",
		options: [
			...enrolledIdentities.map((identity) => ({
				value: identity,
				label: identity,
				description: "revoke its credential",
			})),
			// S3: a browser session appears here as ITS OWN entry, keyed by its id. It is
			// listed after the devices and described differently, because revoking one is
			// a materially smaller act than cutting off a device and the list should not
			// make the two look interchangeable. With no scoped credentials present the
			// prompt is byte-identical to what it has always been.
			...scoped.map((credential) => ({
				value: credential.id,
				label: credential.id,
				description: `${credential.identity} — scoped ${credential.scope.join(", ")} on ${credential.surface}`,
			})),
		],
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
		refuseAuth({
			json: Boolean(options.json),
			operation: "revoke",
			error: "auth-policy-unreadable",
			message: (error as Error).message,
			text: (error as Error).message,
			nextAction: `Inspect or repair the auth policy at ${policyPath}.`,
			nextCommand: AUTH_LIST_HINT,
		});
		return;
	}
	const enrolled = policy.credentials.map((c) => c.identity);
	const scoped = readScopedCredentials(policy);

	let identity = identityArg;
	if (!identity) {
		if (!mayAsk) {
			// Never construct `createAutoOperatorChannel()` on this path: it answers
			// every prompt with a default, which for a select over enrolled devices
			// would silently pick the first one and revoke it. Destructive work does
			// not get a default.
			refuseAuth({
				json: Boolean(options.json),
				operation: "revoke",
				error: "identity-required",
				message: options.json
					? "an identity is required with --json (non-interactive; does not prompt)"
					: "missing required argument 'identity'",
				text: options.json
					? `${refarmCommand(["auth", "revoke"])}: an identity is required with --json (non-interactive; does not prompt)`
					: "error: missing required argument 'identity'\n" +
						`  (not running interactively — pass one explicitly, e.g. \`${REVOKE_LABEL_HINT}\`)`,
				nextAction: `Name the device to cut off explicitly, e.g. \`${REVOKE_LABEL_HINT}\`.`,
				nextCommand: AUTH_LIST_HINT,
			});
			return;
		}
		if (enrolled.length === 0 && scoped.length === 0) {
			refuseAuth({
				json: Boolean(options.json),
				operation: "revoke",
				error: "nothing-enrolled",
				message: `No devices are enrolled in ${policyPath} — nothing to revoke.`,
				text: `No devices are enrolled in ${policyPath} — nothing to revoke.`,
				nextAction: `Enrol a device first, e.g. \`${ENROLL_LABEL_HINT}\`.`,
				nextCommand: ENROLL_LABEL_HINT,
			});
			return;
		}
		identity = await promptForIdentityToRevoke(operatorChannel(), enrolled, scoped);
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
	let kind: "device" | "scoped" = "device";
	let revokedScoped: ScopedCredential | undefined;
	try {
		const current = await readPolicy(policyPath);
		// DEVICE FIRST, always. A device credential and a scoped one could in principle
		// carry the same string, and the device is the larger authority — resolving to it
		// means a revoke can never leave a device running because a browser session
		// happened to share its name.
		if (current.credentials.some((c) => c.identity === identity)) {
			next = removeCredential(current, identity);
		} else if (
			readScopedCredentials(current).some((c) => c.id === identity || c.identity === identity)
		) {
			const removal = removeScopedCredential(current, identity);
			next = removal.policy as AuthPolicyFile;
			revokedScoped = removal.removed;
			kind = "scoped";
		} else {
			// Nothing of either kind. Falls through to `removeCredential` so the refusal
			// is the one this command has always given, word for word.
			next = removeCredential(current, identity);
		}
	} catch (error) {
		// Before the write, so a refused revoke leaves every credential exactly as it was.
		refuseAuth({
			json: Boolean(options.json),
			operation: "revoke",
			error: "revoke-refused",
			message: (error as Error).message,
			text: (error as Error).message,
			nextAction: `Inspect what is enrolled with \`${AUTH_LIST_HINT}\`.`,
			nextCommand: AUTH_LIST_HINT,
		});
		return;
	}
	// `writePolicy` re-chmods after the write: `mode` on `writeFile` only applies when
	// the file is CREATED, and a revoke by definition rewrites one that exists.
	await writePolicy(policyPath, next);

	const remaining = next.credentials.map((c) => c.identity);
	const remainingScoped = readScopedCredentials(next).map((c) => c.id);
	const listHint = refarmCommand(["auth", "list"]);
	if (options.json) {
		// `remaining` still means DEVICE identities, unchanged. `kind` and
		// `remainingScoped` are additive: a consumer that never heard of a scoped
		// credential reads exactly what it always read.
		process.stdout.write(
			`${JSON.stringify({ ok: true, identity, kind, revoked: true, policy: policyPath, remaining, remainingScoped, nextCommand: listHint, nextCommands: [listHint] })}\n`,
		);
		return;
	}
	if (kind === "scoped") {
		process.stdout.write(
			`🗝  revoked scoped credential "${identity}"${revokedScoped ? ` (${revokedScoped.identity})` : ""}\n\n` +
				`   Every device credential is untouched — a scoped credential is its own entry.\n` +
				(remainingScoped.length === 0
					? `   No scoped credentials remain.\n`
					: `   Still scoped: ${remainingScoped.join(", ")}\n`) +
				`   Policy: ${policyPath} (mode 0600)\n` +
				`   Confirm with:  ${listHint}\n`,
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
		.description(
			"Manage the sidecar auth gate — enroll, list, verify and revoke device and scoped credentials",
		)
		.addCommand(createAuthEnrollCommand())
		.addCommand(createAuthListCommand())
		.addCommand(createAuthRemoteCommand())
		.addCommand(createAuthVerifyCommand())
		.addCommand(createAuthRevokeCommand());
}

export const authCommand = createAuthCommand();
