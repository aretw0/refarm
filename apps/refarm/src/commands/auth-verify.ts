import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

import {
	addScopedCredential,
	deriveSasEmoji,
	describeScopeForOperator,
	formatSasRow,
	importSasPrivateKey,
	SCOPED_CREDENTIAL_WIRE,
	sealSasPayload,
	toVerificationRecord,
	type SasEmoji,
	type SasExchange,
	type SasExchangeStore,
	type ScopedCredential,
} from "@refarm.dev/emoji-sas-v1";
import {
	createStdioOperatorChannel,
	OperatorPromptCancelledError,
	type OperatorChannel,
} from "@refarm.dev/prompt-contract-v1";
import { Command } from "commander";

import { refarmCommand } from "../brand.js";
import { readPolicy, sha256Hex, writePolicy } from "./auth-policy-file.js";
import { createFilesystemSasExchangeStore, resolveSasDir } from "./sas-store.js";

/**
 * `refarm auth verify` — S4. The operator compares two rows of seven emoji and
 * confirms HERE, on a surface that already holds authority.
 *
 * ── WHAT THIS COMMAND SHOWS BEFORE IT ASKS, AND WHY THAT IS THE DESIGN ───────────
 *
 * S4 is explicit that a confirmation prompt showing only emoji "has told the operator
 * to compare pictures without telling them what they are agreeing to". So the prompt
 * names the surface, the scope in words, the lifetime, and what the credential
 * explicitly cannot do — and only then shows the row.
 *
 * ── WHY THERE IS NO `--yes`, AND NO `--json` CONFIRMATION ────────────────────────
 *
 * Every other destructive command here grew a non-interactive escape hatch, and this
 * one must not. The human comparison IS the mechanism; a flag that skips it does not
 * automate the verification, it removes it and leaves the ceremony behind. `--json`
 * therefore REPORTS what is waiting (including the row, so an attending surface can
 * render it) and confirms nothing — the same shape `auth enroll --discover` uses when
 * it reports devices and mints nothing.
 *
 * ── S5, WHICH IS THE POINT ───────────────────────────────────────────────────────
 *
 * "No" aborts the exchange permanently and writes a record. It is never offered as a
 * retry, and the wording says so. A mismatch is the one signal this whole mechanism
 * exists to produce; treating it as a transient error to try again discards exactly
 * the information that was worth having. Cancelling (Ctrl+C) also SETTLES — as
 * `cancelled`, recorded — because an unanswered comparison left approvable on disk is
 * a comparison somebody else can answer later.
 */

const DEFAULT_POLICY_PATH = ".refarm/auth-policy.json";
const LIST_HINT = refarmCommand(["auth", "list"]);
const VERIFY_HINT = refarmCommand(["auth", "verify"]);

interface VerifyOptions {
	policy?: string;
	sasDir?: string;
	json?: boolean;
}

export interface AuthVerifyDeps {
	/** Pre-built operator channel — tests inject `createScriptedOperatorChannel(...)`. */
	operator?: OperatorChannel;
	input?: NodeJS.ReadStream;
	output?: NodeJS.WriteStream;
	/** Injected by tests so the store can be exercised without the filesystem. */
	store?: SasExchangeStore;
	now?: () => number;
	/** The token minter, so a test can assert what was written without guessing. */
	mintToken?: () => string;
}

/** A human duration, because "3600000" is not a lifetime anyone can judge. */
export function formatLifetime(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))} seconds`;
	if (minutes < 60) return `${minutes} minutes`;
	const hours = ms / 3_600_000;
	const rounded = Math.round(hours * 10) / 10;
	return rounded === 1 ? "1 hour" : `${rounded} hours`;
}

/** How long ago, for "is this the exchange I just started?". */
function formatAge(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	return `${Math.round(seconds / 60)}m ago`;
}

/** Derive the row for an exchange, from ITS OWN private key.
 *
 *  Deliberately re-derived rather than read off the record: the confirming side is the
 *  authority, and an authority that displays a row somebody else computed is verifying
 *  that other party's arithmetic, not the exchange. */
export async function emojiForExchange(exchange: SasExchange): Promise<SasEmoji[]> {
	if (!exchange.confirmerPrivateKeyJwk) {
		throw new Error(`this verification has already settled — there is nothing left to compare`);
	}
	const privateKey = await importSasPrivateKey(exchange.confirmerPrivateKeyJwk);
	return deriveSasEmoji({
		privateKey,
		peerPublicKey: exchange.initiatorPublicKey,
		transcript: {
			sessionId: exchange.id,
			initiatorPublicKey: exchange.initiatorPublicKey,
			confirmerPublicKey: exchange.confirmerPublicKey,
		},
	});
}

/**
 * WHAT IS BEING AUTHORISED, in full, as the operator reads it before answering (S4).
 * PURE, and exported so the wording is testable without a terminal.
 */
export function describeGrant(exchange: SasExchange, now: number): string[] {
	const lines = [
		`   Surface     ${exchange.surface} — this node's web listener`,
		`   Client      ${exchange.client}  (the caller's own claim, not a fact)`,
	];
	for (const scope of describeScopeForOperator(exchange.scope)) {
		lines.push(`   Scope       ${scope}`);
	}
	lines.push(
		`               NOT a device credential — the runtime's sidecar gate will refuse it.`,
		`   Lifetime    ${formatLifetime(exchange.lifetimeMs)}, then it stops working on its own`,
		`   Revoke      ${refarmCommand(["auth", "revoke", "<id>"])} — its own entry, not the device's`,
		`   Started     ${formatAge(now - exchange.createdAt)}`,
	);
	return lines;
}

/** The scoped credential an approval mints. PURE. */
export function buildScopedCredential(input: {
	exchange: SasExchange;
	tokenSha256: string;
	now: number;
	id?: string;
}): ScopedCredential {
	const id = input.id ?? `sas-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
	return {
		wire: SCOPED_CREDENTIAL_WIRE,
		id,
		// Structural, never taken from the client's self-description: a label an
		// untrusted caller chooses is a label it can use to impersonate another entry
		// in the very list the operator revokes from.
		identity: `web-session-${id.slice(4, 10)}`,
		tokenSha256: input.tokenSha256,
		scope: [...input.exchange.scope],
		surface: input.exchange.surface,
		issuedVia: "emoji-sas.v1",
		issuedAt: input.now,
		expiresAt: input.now + input.exchange.lifetimeMs,
	};
}

/** Sweep whatever timed out while nobody was looking, recording each (S5 applies to an
 *  expiry too — it is an outcome, not a disappearance). Returns what survived. */
async function sweep(store: SasExchangeStore, now: number): Promise<SasExchange[]> {
	const live: SasExchange[] = [];
	for (const exchange of await store.list()) {
		if (exchange.state !== "pending") {
			// A settled exchange whose outcome the browser never collected. It is not
			// confirmable and must not be offered; the HTTP surface removes it when the
			// caller finally polls, or it ages out with the directory.
			continue;
		}
		if (exchange.expiresAt <= now) {
			const settled = await store.settle(exchange.id, {
				state: "aborted",
				at: now,
				abortReason: "expired",
			});
			if (settled) await store.record(toVerificationRecord(settled, now));
			continue;
		}
		live.push(exchange);
	}
	return live;
}

export function createAuthVerifyCommand(deps: AuthVerifyDeps = {}): Command {
	return new Command("verify")
		.description(
			"Compare a surface's seven emoji and grant it a scoped, expiring credential (emoji SAS)",
		)
		.argument("[id]", "The verification to answer. Omit to choose from what is waiting.")
		.option("--policy <path>", "Auth policy file to write", DEFAULT_POLICY_PATH)
		.option("--sas-dir <path>", "Where pending verifications live (defaults beside the policy)")
		.option("--json", "Report what is waiting, and confirm NOTHING")
		.action(async (idArg: string | undefined, options: VerifyOptions) => {
			try {
				await runAuthVerify(deps, idArg, options);
			} catch (error) {
				if (!(error instanceof OperatorPromptCancelledError)) throw error;
				// Handled inside `runAuthVerify` (which settles the exchange first); this
				// is the belt for a cancellation raised before one was selected.
				console.log("\n  Cancelled. Nothing was granted.");
				process.exitCode = 130;
			}
		});
}

async function runAuthVerify(
	deps: AuthVerifyDeps,
	idArg: string | undefined,
	options: VerifyOptions,
): Promise<void> {
	const now = deps.now ?? (() => Date.now());
	const policyPath = path.resolve(options.policy ?? DEFAULT_POLICY_PATH);
	const sasDir = options.sasDir ? path.resolve(options.sasDir) : resolveSasDir(policyPath);
	const store = deps.store ?? createFilesystemSasExchangeStore(sasDir);
	const output = deps.output ?? process.stdout;
	const input = deps.input ?? process.stdin;
	const interactive = Boolean(input.isTTY && output.isTTY);

	const waiting = await sweep(store, now());

	if (options.json) {
		// REPORTS, and confirms nothing. Deliberately includes the row: an attending
		// surface must be able to render the same seven, and they are not a secret —
		// they are shown on two screens by design.
		const entries = [];
		for (const exchange of waiting) {
			entries.push({
				id: exchange.id,
				surface: exchange.surface,
				client: exchange.client,
				scope: exchange.scope,
				lifetimeMs: exchange.lifetimeMs,
				startedAt: exchange.createdAt,
				expiresAt: exchange.expiresAt,
				emoji: (await emojiForExchange(exchange)).map((e) => ({
					index: e.index,
					emoji: e.emoji,
					description: e.description,
				})),
			});
		}
		output.write(
			`${JSON.stringify({
				ok: true,
				// Named rather than left implicit: a consumer must see, in the payload,
				// that reporting granted nothing.
				granted: false,
				pending: entries,
				detail:
					"A verification is confirmed by a human comparing two rows. There is no --yes: " +
					"skipping the comparison would not automate it, it would remove it.",
				nextCommand: VERIFY_HINT,
				nextCommands: [VERIFY_HINT],
			})}\n`,
		);
		return;
	}

	if (waiting.length === 0) {
		output.write(
			`No verification is waiting in ${sasDir}.\n\n` +
				`   A surface starts one by calling POST /auth/sas/start on this node's web listener.\n`,
		);
		return;
	}

	const operator: OperatorChannel =
		deps.operator ?? (interactive ? createStdioOperatorChannel({ input, output }) : undefined!);
	if (!operator) {
		// Never `createAutoOperatorChannel()`: it answers every prompt with a default,
		// and the default for "do these match?" would grant a credential nobody looked at.
		output.write(
			`error: ${waiting.length} verification(s) waiting, but this is not an interactive terminal.\n` +
				`  A verification is confirmed by a human comparing two rows — run \`${VERIFY_HINT}\` at a terminal,\n` +
				`  or \`${VERIFY_HINT} --json\` to see what is waiting without answering.\n`,
		);
		process.exitCode = 1;
		return;
	}

	let exchange = idArg ? waiting.find((entry) => entry.id === idArg) : undefined;
	if (idArg && !exchange) {
		output.write(`No verification "${idArg}" is waiting. Run \`${VERIFY_HINT}\` to see what is.\n`);
		process.exitCode = 1;
		return;
	}
	if (!exchange) {
		if (waiting.length === 1) {
			exchange = waiting[0]!;
		} else {
			const chosen = await operator.ask({
				type: "select",
				question: "Which verification?",
				options: waiting.map((entry) => ({
					value: entry.id,
					label: entry.client,
					description: `${entry.surface} — started ${formatAge(now() - entry.createdAt)}`,
				})),
			});
			exchange = waiting.find((entry) => entry.id === chosen)!;
		}
	}

	const emoji = await emojiForExchange(exchange);
	output.write(
		`\n🔐 A surface is asking this node to vouch for it.\n\n` +
			`${describeGrant(exchange, now()).join("\n")}\n\n` +
			`   Compare these seven, IN THIS ORDER, with the ones on that screen:\n\n` +
			`     ${formatSasRow(emoji)}\n\n` +
			`   If they differ in any way — one emoji, or the order — answer no. That aborts this\n` +
			`   verification for good; it is never retried.\n\n`,
	);

	let confirmed: boolean;
	try {
		confirmed = await operator.ask({
			type: "confirm",
			question: "Do all seven match, in the same order?",
			default: false,
		});
	} catch (error) {
		if (!(error instanceof OperatorPromptCancelledError)) throw error;
		// CANCELLATION SETTLES. An unanswered comparison left approvable on disk is a
		// comparison somebody else can answer later, from a different chair.
		await abort(store, exchange, "cancelled", now());
		output.write(
			`\n  Cancelled — this verification is aborted and recorded. Nothing was granted.\n`,
		);
		process.exitCode = 130;
		return;
	}

	if (!confirmed) {
		await abort(store, exchange, "mismatch", now());
		// LOUD, and on stderr as well as stdout: this is the one signal the mechanism
		// exists to produce, and a quiet line is how it gets scrolled past.
		output.write(
			`\n🚨 MISMATCH — the verification is aborted and recorded.\n\n` +
				`   Something between that surface and this node presented a different key. It is\n` +
				`   NOT retried: whatever is on the other side must start over from nothing, and if\n` +
				`   the rows differ again, the surface is not talking to this node.\n\n` +
				`   Recorded in ${path.join(sasDir, "verification-log.ndjson")}\n`,
		);
		process.stderr.write(`refarm auth verify: emoji mismatch on ${exchange.id} — aborted.\n`);
		process.exitCode = 1;
		return;
	}

	// ── Approved. Mint, write, seal, settle — in that order. ────────────────────────
	const at = now();
	const token = (deps.mintToken ?? (() => randomBytes(32).toString("base64url")))();
	const credential = buildScopedCredential({ exchange, tokenSha256: sha256Hex(token), now: at });
	// The policy is written BEFORE the exchange is settled: a credential the browser
	// holds but the policy does not know is a credential that authenticates nothing,
	// and it would be indistinguishable from a compromise.
	await writePolicy(policyPath, addScopedCredential(await readPolicy(policyPath), credential));

	if (!exchange.confirmerPrivateKeyJwk) throw new Error("this verification has already settled");
	const sealed = await sealSasPayload({
		privateKey: await importSasPrivateKey(exchange.confirmerPrivateKeyJwk),
		peerPublicKey: exchange.initiatorPublicKey,
		transcript: {
			sessionId: exchange.id,
			initiatorPublicKey: exchange.initiatorPublicKey,
			confirmerPublicKey: exchange.confirmerPublicKey,
		},
		plaintext: token,
	});
	const settled = await store.settle(exchange.id, {
		state: "granted",
		at,
		sealed,
		credentialId: credential.id,
	});
	if (!settled) {
		// Something else settled it between the comparison and the write — a deadline,
		// or another confirmation. The credential exists but nobody can collect it, so
		// take it back rather than leave a token nothing will ever hold.
		const { removeScopedCredential } = await import("@refarm.dev/emoji-sas-v1");
		await writePolicy(policyPath, removeScopedCredential(await readPolicy(policyPath), credential.id).policy);
		output.write(
			`\n  This verification settled elsewhere before the grant landed. Nothing was granted.\n`,
		);
		process.exitCode = 1;
		return;
	}
	await store.record(toVerificationRecord(settled, at));

	// The TOKEN is never printed. It is sealed to the surface's own key and travels
	// there — E3's whole improvement over carrying a secret by hand. Printing it here
	// would reintroduce, on this terminal, exactly the exposure the operator rejected.
	output.write(
		`\n✅ verified — "${credential.identity}" may now answer prompts.\n\n` +
			`   Credential  ${credential.id}\n` +
			`   Scope       ${credential.scope.join(", ")} (not a device credential)\n` +
			`   Expires     ${formatLifetime(exchange.lifetimeMs)} from now\n` +
			`   The token was sealed to that surface's key — it is not printed here, and it never\n` +
			`   crossed in plaintext.\n\n` +
			`   See it:     ${LIST_HINT}\n` +
			`   Cut it off: ${refarmCommand(["auth", "revoke", credential.id])}\n` +
			`   Policy:     ${policyPath} (mode 0600; only the token's sha256 is stored)\n`,
	);
}

/** Abort and record, in that order, and only ever once. */
async function abort(
	store: SasExchangeStore,
	exchange: SasExchange,
	reason: "mismatch" | "cancelled",
	at: number,
): Promise<void> {
	const settled = await store.settle(exchange.id, { state: "aborted", at, abortReason: reason });
	if (settled) await store.record(toVerificationRecord(settled, at));
}
