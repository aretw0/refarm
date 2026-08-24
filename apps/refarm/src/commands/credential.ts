/**
 * `refarm credential` — which model accounts this node holds, which one a workspace spends, and
 * how to bind them.
 *
 * A PROJECTION, NEVER A SECOND RESOLVER. D3 of the account-aware design puts model-account
 * resolution below every operator surface: this command submits the same inputs any other surface
 * would and prints what comes back. It implements no precedence of its own, which is what makes
 * `ask`, `chat` and this agree by construction rather than by review.
 *
 * NOTHING PRINTED HERE IS A SECRET. Descriptors carry a `secretRef` — a location, never material —
 * and the listing is built from `listSecretDescriptors`, not from Silo's value-returning
 * `listSecrets` (D2).
 */
import fs from "node:fs";
import path from "node:path";

import { Command } from "commander";

import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import {
	authorizedAccounts,
	authorizedProviders,
	describeAuthorization,
	isRefusal,
	LEGACY_REF_PREFIX,
	MODEL_AUTHORIZATION_KEY,
	readModelAuthorization,
	resolveModelAccount,
	type AccountView,
	type ModelAccountBinding,
	type ModelAccountDescriptor,
	type StoredModelBindings,
} from "@refarm.dev/model-account-contract-v1";
import { SiloCore } from "@refarm.dev/silo";

import {
	CATALOG_FILE,
	loadAccountCredentials,
	loadAccountView,
	MODEL_NAMESPACE,
	readCatalog,
	type AccountViewSilo,
} from "../credentials/account-view-loader.js";
import {
	describeCopilotIdentity,
	resolveCopilotIdentity,
} from "../credentials/oauth/index.js";
import { resolveRefarmHome } from "../utils/refarm-home.js";
import { emitCommandRefusal } from "./command-refusal.js";
import { exhaustedMeters, formatQuotaRows, readQuotaRows } from "./credential-quota.js";

interface CredentialSilo {
	loadTokens(): Promise<unknown>;
	saveTokens(tokens: Record<string, unknown>): Promise<unknown>;
	removeSecret?(namespace: string, id: string): Promise<unknown>;
}

export interface CredentialDeps {
	homeOf: () => string;
	siloOf: () => CredentialSilo;
	/** The one snapshot this command answers from. Built by the loader that owns the I/O. */
	viewOf: () => Promise<AccountView>;
	/** The STORED records, which are not what the view answers from — see `forget` and ISS-133. */
	catalogOf: () => readonly ModelAccountDescriptor[];
	/** Each account's stored credential, by OPAQUE id — for asking a PROVIDER about one account. */
	credentialsOf: () => Promise<ReadonlyMap<string, unknown>>;
	/** Today, as an ISO date. Injected because a declaration records WHEN it was given, and a test
	 *  that reads the real clock cannot assert the record it writes. */
	todayOf: () => string;
	writeCatalog: (catalog: readonly ModelAccountDescriptor[]) => void;
	bindingsOf: () => ModelAccountBinding[];
}

function readJson<T>(file: string, fallback: T): T {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch {
		return fallback;
	}
}

/**
 * WHAT `forget` CANNOT DO, said where an operator is about to assume otherwise.
 *
 * MEASURED 2026-08-24 against the live API, with a token that does not exist so the experiment
 * could revoke nothing:
 *
 *     DELETE /applications/<client_id>/token
 *       no auth                          -> 401 {"message":"Requires authentication"}
 *       Basic client_id:invented_secret  -> 401 {"message":"Bad credentials"}
 *
 * The message CHANGES between the two, which proves the endpoint evaluates the Basic pair rather
 * than ignoring it: revocation requires a real `client_secret`. `credentials/github.ts:10` records
 * why this node has none — "Device flow does not use a client_secret" — and being a public client
 * is exactly what lets the client id live in the repository and every node use it with no secret
 * to distribute. So this node can ACQUIRE a credential it cannot DISPOSE of, and the previous
 * prompt ("deleted and cannot be recovered") was true about this node and read as finality.
 *
 * THE ORDER IS LOAD-BEARING, and it is why this says `quota` BEFORE `sow`. Re-authenticating
 * replaces the stored token, so a check run afterwards asks about the NEW credential and answers
 * `read` — saying nothing about the one that was revoked. The proof exists only in the window
 * between revoking and logging in again.
 *
 * NO NEW VERDICT IS INVENTED. `credential quota` already asks the provider and already returns
 * `rejected` for 401/403, with its own note that "401/403 is the CREDENTIAL, and conflating it
 * with quota is the whole trap". Nothing pointed an operator at it for this question. And nothing
 * here claims WHY a credential is refused: GitHub answers an identical `401 Bad credentials` for a
 * revoked, an invalid and a malformed token — measured the same day — so a `revoked` verdict would
 * be a distinction the provider does not make.
 *
 * @param provider the account's provider, which decides only whether a URL is known
 */
/**
 * The human rendering. Kept beside the pure reading so the two cannot drift, and written to be
 * read TOP TO BOTTOM as a procedure: where, then the proof, then the ordering that makes the
 * proof possible at all.
 */
export function formatRevocationEntries(entries: readonly RevocationEntry[]): string {
	if (entries.length === 0) {
		return "This node holds no model accounts, so there is nothing to revoke.\n";
	}
	const lines = ["This node CANNOT revoke a provider authorization — a human must, in a browser.", ""];
	for (const entry of entries) {
		lines.push(`${entry.alias}  (${entry.provider})`);
		lines.push(entry.url ? `  Revoke at:  ${entry.url}` : `  Revoke at:  ${entry.because}`);
		lines.push(
			entry.verifiable
				? `  Then prove it:  ${entry.verifyCommand}  ->  this account should answer \`rejected\``
				: `  Cannot be proven from here: nothing on this node can ask ${entry.provider} about a credential.`,
		);
		lines.push("");
	}
	lines.push("Run the check BEFORE `refarm sow`: logging in again replaces the token it asks about.");
	return `${lines.join("\n")}\n`;
}

/**
 * Providers this node can ASK about a credential, which is narrower than the ones it holds.
 *
 * `credential quota` is the only surface that interrogates a stored credential, and its reader is
 * Copilot's. Anything else answers `cannot-ask` — a shrug, not a verdict.
 */
const PROVIDERS_WITH_QUOTA_READER = new Set(["github-copilot"]);

/** One account's revocation coordinates: where a human must go, and what proves they went. */
export interface RevocationEntry {
	readonly credentialId: string;
	readonly alias: string;
	readonly provider: string;
	/** The page that revokes this provider's authorization, or null where none was established. */
	readonly url: string | null;
	/** Why there is no url, when there is none. */
	readonly because: string | null;
	/** The command that asks the provider whether this credential is still accepted. */
	readonly verifyCommand: string;
	/** False when this node holds no secret to test — the grant may live on, unprovably from here. */
	readonly verifiable: boolean;
}

/**
 * PURE. Where each account this node holds must be revoked, and what proves it landed.
 *
 * THE NODE CANNOT REVOKE, measured 2026-08-24 with a token belonging to nobody so the probe could
 * revoke nothing: `DELETE /applications/<client_id>/token` answers 401 "Requires authentication"
 * unauthenticated and 401 "Bad credentials" under Basic auth with an invented secret. The message
 * CHANGES, which proves the endpoint evaluates the pair — revocation needs a real `client_secret`,
 * and `credentials/github.ts:10` records why this node has none: "Device flow does not use a
 * client_secret". Being a public client is exactly what lets the client id live in the repository
 * and every node use it with nothing to distribute.
 *
 * So the honest division is: a human REVOKES, and this node SAYS WHERE and PROVES WHETHER.
 *
 * A URL IS GIVEN ONLY WHERE MEASURED. Sending an operator to a page nobody confirmed is worse than
 * sending them nowhere — they arrive, find nothing, and doubt the rest of the instruction.
 */
export function revocationGuidance(
	accounts: readonly ModelAccountDescriptor[],
): RevocationEntry[] {
	return accounts.map((account) => {
		const provider = account.provider.trim().toLowerCase();
		const known = provider === "github-copilot" || provider === "github";
		return {
			credentialId: account.credentialId,
			alias: account.alias,
			provider: account.provider,
			url: known ? "https://github.com/settings/applications" : null,
			because: known
				? null
				: `no revocation page has been established for ${account.provider} — it is not known whether one is reachable by a public client`,
			verifyCommand: "refarm credential quota",
			// TWO THINGS ARE NEEDED TO PROVE IT, and having only one is what made the first draft
			// lie. An `incomplete` account has no secret on this node, so nothing can ask; and a
			// provider with no quota reader cannot be asked even holding one — measured the same
			// day, `credential quota` answers openai-codex with `cannot-ask`, "this node has no
			// quota reader for openai-codex, so it did not ask."
			//
			// The grant may be live in both cases, which is exactly why the PAGE still matters
			// while the PROOF does not exist. Promising it would send an operator to run a check
			// that returns a shrug and read the shrug as a failure to revoke.
			verifiable: account.health === "healthy" && PROVIDERS_WITH_QUOTA_READER.has(provider),
		};
	});
}

function revocationNotice(provider: string): string {
	// THE FACT IS CONSTANT, THE URL IS APPENDED. Splicing the address in PLACE of "the provider"
	// produced "does NOT revoke anything at https://github.com/settings/applications" — naming the
	// page the operator must visit as the place where nothing happens. Read off the live output;
	// an assertion that merely found the URL passed on that text.
	//
	// NAMED ONLY WHERE MEASURED: github-copilot's grant is revoked from the OAuth applications
	// page. Whether OpenAI offers a public-client revocation path was NOT established, so codex
	// gets the fact and no link rather than one nobody confirmed (ISS-162).
	const where =
		provider.trim().toLowerCase() === "github-copilot"
			? ": https://github.com/settings/applications"
			: ".";
	return (
		`  This does NOT revoke anything at the provider: the authorization stays live until you\n` +
		`  revoke it there${where}\n` +
		"  To prove a revocation landed, run `refarm credential quota` BEFORE `refarm sow` — the\n" +
		"  provider answers `rejected` for a credential it no longer accepts, and logging in again\n" +
		"  replaces the token that check would ask about.\n"
	);
}

function defaultDeps(): CredentialDeps {
	// The DECLARED home, which is the only reading that honours REFARM_HOME (ISS-139).
	const homeOf = () => resolveRefarmHome();
	return {
		homeOf,
		siloOf: () => new SiloCore() as unknown as CredentialSilo,
		viewOf: () =>
			loadAccountView({ home: homeOf(), silo: new SiloCore() as unknown as AccountViewSilo }),
		catalogOf: () => readCatalog(homeOf()),
		todayOf: () => new Date().toISOString().slice(0, 10),
		credentialsOf: () =>
			loadAccountCredentials({ home: homeOf(), silo: new SiloCore() as unknown as AccountViewSilo }),
		writeCatalog: (catalog) => {
			const file = path.join(homeOf(), CATALOG_FILE);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
		},
		bindingsOf: () =>
			Object.entries(
				readJson<{ modelBindings?: Record<string, string> }>(
					path.join(homeOf(), "config.json"),
					{},
				).modelBindings ?? {},
			).map(([workspaceId, credentialId]) => ({ workspaceId, credentialId })),
	};
}

/** REFUSALS, NOT ESCAPING EXCEPTIONS — `cli-refusal-conformance` probes every command. */
function guarded(
	operation: string,
	options: { json?: boolean },
	body: () => Promise<void> | void,
): Promise<void> | void {
	const fail = (error: unknown) =>
		emitCommandRefusal({
			command: "credential",
			operation,
			options,
			error: `credential-${operation}-refused`,
			message: error instanceof Error ? error.message : String(error),
			nextAction: "Run `refarm credential --help` to see the accepted arguments.",
			nextCommands: ["refarm credential --help"],
		});
	try {
		const result = body();
		return result instanceof Promise ? result.catch(fail) : result;
	} catch (error) {
		fail(error);
	}
}

/** SAFE. The only fields that may leave this command. */
const safeRow = (entry: ModelAccountDescriptor) => ({
	credentialId: entry.credentialId,
	provider: entry.provider,
	alias: entry.alias,
	health: entry.health,
	identity: entry.identity.status,
	revision: entry.revision,
});

export function createCredentialCommand(deps: CredentialDeps = defaultDeps()): Command {
	const credential = new Command("credential").description(
		"Model accounts this node holds, and which one a workspace spends",
	);

	/**
	 * ONE VIEW PER INVOCATION, from the loader that owns the I/O. This command used to assemble the
	 * picture itself, which meant a second consumer would have assembled it slightly differently.
	 */
	const loadAccounts = async (): Promise<ModelAccountDescriptor[]> =>
		[...(await deps.viewOf()).accounts];

	credential
		.command("list")
		.description("Every model account this node holds — ids, aliases and health, never secrets")
		.option("--json", "Output machine-readable result")
		.action(async (options: { json?: boolean }) =>
			guarded("list", options, async () => {
				const all = await loadAccounts();
				const accounts = all.map(safeRow);
				// THE ABSENCE IS SHOWN WHERE HE ALREADY LOOKS. A node that has not declared what it may
				// spend is not faulty and is not finished either, and the listing is the surface an
				// operator reaches for when asking "what does this node have?" — which is the same
				// question one step before "and what may it spend?" (ISS-131 tier 3).
				const authorization = readModelAuthorization(
					readJson<unknown>(path.join(deps.homeOf(), "config.json"), undefined),
				);
				const authorizationNotice = describeAuthorization(
					authorization,
					authorizedAccounts(authorization, all),
				);
				// A NODE THAT IMITATES IN SILENCE is a node nobody knows will break. The identity
				// profile is reported wherever credentials are, so the choice stays visible long after
				// whoever made it has forgotten.
				const identityNotice = describeCopilotIdentity(
					resolveCopilotIdentity(
						readJson<unknown>(path.join(deps.homeOf(), "config.json"), undefined),
					),
				);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "credential",
							operation: "list",
							extra: {
								accounts,
								authorization,
								...(identityNotice ? { identityNotice } : {}),
								...(authorizationNotice ? { authorizationNotice } : {}),
							},
						}),
					);
					return;
				}
				if (accounts.length === 0) {
					// THE NOTICE STILL PRINTS. A declared identity profile is true whether or not a
					// credential exists yet — and the moment it matters most is the login that has not
					// happened, because that is the one the profile will govern.
					process.stdout.write(
						"no model account is registered on this node\n  refarm sow\n" +
							(identityNotice ? `\n  ${identityNotice}\n` : ""),
					);
					return;
				}
				process.stdout.write(
					accounts
						.map(
							(a) =>
								`  ${a.provider.padEnd(18)}${a.alias.padEnd(16)}${a.health.padEnd(12)}${a.identity}\n`,
						)
						.join("") +
						(authorizationNotice ? `\n  ${authorizationNotice}\n` : "") +
						(identityNotice ? `\n  ${identityNotice}\n` : ""),
				);
			}),
		);

	credential
		.command("current")
		.description("Which account a dispatch would spend, and why that one")
		.option("--json", "Output machine-readable result")
		.option("--provider <id>", "Resolve for this provider")
		.option("--workspace <id>", "Resolve as this workspace would")
		.action(async (options: { json?: boolean; provider?: string; workspace?: string }) =>
			guarded("current", options, async () => {
				const accounts = await loadAccounts();
				const provider = options.provider ?? accounts[0]?.provider;
				if (!provider) throw new Error("no model account is registered on this node");
				const result = resolveModelAccount({
					provider,
					accounts,
					bindings: deps.bindingsOf(),
					workspaceId: options.workspace ?? null,
				});
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "credential",
							operation: "current",
							extra: { result },
						}),
					);
				} else if (isRefusal(result)) {
					process.stdout.write(
						`${result.code}: ${result.message}\n` +
							result.candidates.map((c) => `  ${c.alias}  ${c.credentialId}\n`).join(""),
					);
				} else {
					process.stdout.write(
						`${result.provider} · ${result.credentialAlias} · via ${result.source}\n` +
							`  ${result.credentialId}  ${result.credentialRevision}\n`,
					);
				}
				// NON-ZERO ON REFUSAL, so this can be a gate rather than a report.
				if (isRefusal(result)) process.exitCode = 1;
			}),
		);

	credential
		.command("renew")
		.description(
			"Renew what has lapsed and hand it to the running node — no restart, no work lost",
		)
		.option("--json", "Output machine-readable result")
		.action(async (options: { json?: boolean }) =>
			guarded("renew", options, async () => {
				// THE THIRD PATH, COMPLETED. The host reads a credential FILE it re-reads per
				// dispatch (5791626c), so a renewal reaches a live runtime. What was missing is
				// something that renews when the operator is not typing: `ask` covers the terminal
				// and nothing covers a dispatch arriving from a phone, a PWA or an automation.
				//
				// This is that something, as a command rather than a daemon — the node already
				// supervises declared processes, and WHICH cadence to run it at is the operator's
				// declaration, not a hardcoded timer.
				const { refreshLiveCredentialsForDispatch } = await import("./ask-allowance.js");
				const outcome = await refreshLiveCredentialsForDispatch();
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "credential",
							operation: "renew",
							extra: { ...outcome },
							nextAction:
								outcome.kind === "could-not-renew"
									? "Re-authenticate the account the provider refused: `refarm sow`."
									: null,
							nextCommands: [],
						}),
					);
					return;
				}
				console.log(
					outcome.kind === "none-stale"
						? "Nothing had lapsed — no provider was asked."
						: outcome.kind === "refreshed"
							? "Renewed, and the running node was handed it. No restart."
							: `Could not renew: ${outcome.because}`,
				);
			}),
		);

	credential
		.command("quota")
		.description("What each account has left, asked of the providers — never declared here")
		.option("--json", "Output machine-readable result")
		.action(async (options: { json?: boolean }) =>
			guarded("quota", options, async () => {
				const accounts = await loadAccounts();
				const rows = await readQuotaRows(accounts, await deps.credentialsOf(), {
					fetch: globalThis.fetch,
				});
				const exhausted = exhaustedMeters(rows);
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "credential",
							operation: "quota",
							extra: { accounts: rows, exhausted },
							...(exhausted.length > 0
								? {
										nextAction: `${exhausted.map((e) => `${e.alias}/${e.meter}`).join(", ")} is out. Bind the workspaces that spend it elsewhere, or wait for the reset.`,
									}
								: {}),
						}),
					);
					return;
				}
				process.stdout.write(formatQuotaRows(rows));
			}),
		);

	credential
		.command("revocation")
		.description("Where to revoke this node's authorizations — refarm cannot do it for you")
		.option("--json", "Output machine-readable result")
		.action(async (options: { json?: boolean }) =>
			guarded("revocation", options, async () => {
				const entries = revocationGuidance(await loadAccounts());
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "credential",
							operation: "revocation",
							extra: { accounts: entries },
							// THE ORDER IS THE INSTRUCTION. `sow` replaces the stored token, so a check
							// run afterwards asks about the NEW credential and answers `read` — saying
							// nothing about the one that was revoked. The proof exists only in the
							// window between revoking and logging in again.
							nextAction:
								"Revoke in the browser, then `refarm credential quota` BEFORE `refarm sow`.",
							nextCommands: ["refarm credential quota"],
						}),
					);
					return;
				}
				process.stdout.write(formatRevocationEntries(entries));
			}),
		);

	credential
		.command("authorize")
		.argument("[credentialIds...]", "The OPAQUE ids this node may spend — never aliases (D2)")
		.description("Declare what this node is authorised to spend, or show what it has declared")
		.option("--all", "Approve every account this node holds, now and later")
		.option("--none", "Declare explicitly that nothing beyond the configured route is approved")
		.option("--json", "Output machine-readable result")
		.action(async (credentialIds: string[], options: { all?: boolean; none?: boolean; json?: boolean }) =>
			guarded("authorize", options, async () => {
				const accounts = await loadAccounts();
				const configPath = path.join(deps.homeOf(), "config.json");
				const config = readJson<Record<string, unknown>>(configPath, {});

				// READ-ONLY WITH NO ARGUMENTS. `authorize` with nothing to say must not be a way to
				// accidentally declare something — the surface that shows a declaration and the one
				// that makes it cannot be the same keystroke.
				const declaring = Boolean(options.all || options.none || credentialIds.length > 0);
				if (!declaring) {
					const current = readModelAuthorization(config);
					const resolved = authorizedAccounts(current, accounts);
					const notice = describeAuthorization(current, resolved);
					if (options.json) {
						printJson(
							buildJsonSuccessEnvelope({
								command: "credential",
								operation: "authorize",
								extra: {
									authorization: current,
									authorized: resolved.authorized.map(safeRow),
									unknown: resolved.unknown,
									unusable: resolved.unusable,
									providers: authorizedProviders(resolved),
									...(notice ? { notice } : {}),
								},
							}),
						);
						return;
					}
					// THE COMMAND IS RENDERED HERE (brand guard). The contract states the FACT — this
					// node has not declared — and naming a CLI verb inside a generic package would
					// make it unusable by any other surface.
					process.stdout.write(
						`  scope: ${current.scope}\n` +
							resolved.authorized
								.map((a) => `    ${a.provider.padEnd(18)}${a.alias}\n`)
								.join("") +
							(notice
							? `\n  ${notice}\n` +
								"  refarm credential authorize --all   (or: refarm credential authorize <credentialId...>)\n"
							: ""),
					);
					return;
				}

				if ([options.all, options.none, credentialIds.length > 0].filter(Boolean).length > 1) {
					throw new Error(
						"--all, --none and a list of ids say three different things; name exactly one",
					);
				}

				// REFUSED, as `bind` refuses: an authorization naming an account this node does not hold
				// is stale the moment it is written, and writing it would put a stale declaration on
				// disk with the operator believing he had approved something.
				const held = new Set(accounts.map((a) => a.credentialId));
				const missing = credentialIds.filter((id) => !held.has(id));
				if (missing.length > 0) {
					throw new Error(
						`no account on this node carries ${missing.join(", ")} — see \`refarm credential list\``,
					);
				}

				const authorization = options.all
					? { scope: "all" as const, declaredAt: deps.todayOf() }
					: { scope: "declared" as const, accounts: credentialIds, declaredAt: deps.todayOf() };
				fs.writeFileSync(
					configPath,
					`${JSON.stringify({ ...config, [MODEL_AUTHORIZATION_KEY]: authorization }, null, 2)}\n`,
				);

				const resolved = authorizedAccounts(authorization, accounts);
				const extra = {
					authorization,
					authorized: resolved.authorized.map(safeRow),
					providers: authorizedProviders(resolved),
				};
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({ command: "credential", operation: "authorize", extra }),
					);
					return;
				}
				process.stdout.write(
					`  declared: ${authorization.scope}\n` +
						resolved.authorized.map((a) => `    ${a.provider.padEnd(18)}${a.alias}\n`).join("") +
						"\n  The runtime reads this at start; restart it to apply: refarm runtime restart\n",
				);
			}),
		);

	credential
		.command("bind")
		.argument("<workspace>", "Workspace id, as declared in .refarm/config.json")
		.argument(
			"<credentialId...>",
			"The OPAQUE ids — never aliases, which may be renamed. More than one declares a fallback order.",
		)
		.description("Bind a workspace to one model account, or to several in priority order")
		.option("--json", "Output machine-readable result")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm credential bind refarm model-account:K4NX…",
				"  $ refarm credential bind refarm model-account:K4NX… model-account:54BG…",
				"",
				"Notes:",
				"  The ORDER is the instruction: the first usable seat pays, and nothing outside the",
				"  list is ever spent. Declaring the fallback once is what replaces deciding it at",
				"  every refusal.",
			].join("\n"),
		)
		.action(async (workspace: string, credentialIds: string[], options: { json?: boolean }) =>
			guarded("bind", options, async () => {
				const accounts = await loadAccounts();
				for (const credentialId of credentialIds) {
					if (!accounts.some((a) => a.credentialId === credentialId && a.health === "healthy")) {
						throw new Error(
							`model_credential_none: no eligible account on this node carries the id ${credentialId}`,
						);
					}
				}
				// REFUSED HERE, WITH THE OPERATOR WATCHING, rather than deduped on read. A repeated id
				// in a fallback order means a seat that could never be reached, and silently editing a
				// declaration is worse than refusing to write one.
				const seen = new Set<string>();
				const repeated = credentialIds.filter((id) => !seen.add(id));
				if (repeated.length > 0) {
					throw new Error(
						`model_credential_none: ${repeated[0]} appears twice in the order, and a seat ` +
							"cannot fall back to itself.",
					);
				}
				// ONE PROVIDER PER ORDER, refused here rather than skipped at dispatch.
				//
				// The route — provider, base URL, auth shape — is resolved ONCE before a dispatch is
				// submitted. Falling back to a seat of another provider would leave the route naming
				// the first one, so the walk would either send to the wrong endpoint or have to
				// rebuild the route mid-flight. Refusing the declaration removes the class instead of
				// carrying a skip rule nobody can see. Bind different providers to different
				// workspaces, which is what the route already expresses.
				const providers = [
					...new Set(
						credentialIds.map(
							(id) => accounts.find((a) => a.credentialId === id)?.provider ?? "unknown",
						),
					),
				];
				if (providers.length > 1) {
					throw new Error(
						`model_credential_none: a fallback order must name seats of ONE provider, and ` +
							`this names ${providers.join(", ")}. A fallback that changes provider changes ` +
							"the route, which is resolved before the dispatch is submitted.",
					);
				}
				const configPath = path.join(deps.homeOf(), "config.json");
				const config = readJson<Record<string, unknown>>(configPath, {});
				// PERSISTS THE OPAQUE ID, NEVER THE ALIAS (D2). An alias may be renamed, and every
				// binding written against it would then point at nothing — or at whatever took the name.
				const bindings = { ...((config.modelBindings as StoredModelBindings) ?? {}) };
				// A single id stays a STRING: every node that exists today keeps the shape it has, and
				// a diff of this file shows a list only where the operator actually declared one.
				bindings[workspace] = credentialIds.length === 1 ? credentialIds[0]! : credentialIds;
				fs.writeFileSync(
					configPath,
					`${JSON.stringify({ ...config, modelBindings: bindings }, null, 2)}\n`,
				);
				const extra = { workspace, credentialIds };
				if (options.json) {
					printJson(buildJsonSuccessEnvelope({ command: "credential", operation: "bind", extra }));
				} else {
					process.stdout.write(`${workspace} → ${credentialIds.join(" → ")}\n`);
				}
			}),
		);

	credential
		.command("forget")
		.argument("<credentialId>", "The OPAQUE id, as shown by `refarm credential list`")
		.description("Remove one model account: its descriptor and its secret")
		.option("--json", "Output machine-readable result")
		.option("--yes", "Skip the confirmation — for automation, never for a first run")
		.action(async (credentialId: string, options: { json?: boolean; yes?: boolean }) =>
			guarded("forget", options, async () => {
				const accounts = await loadAccounts();
				const target = accounts.find((entry) => entry.credentialId === credentialId);
				if (!target) {
					throw new Error(
						`model_credential_none: no account on this node carries the id ${credentialId}`,
					);
				}
				// REFUSED WHILE BOUND. A workspace binding persists the opaque id, so removing the
				// account underneath it would leave the binding pointing at nothing — and the dispatch
				// that discovers it would be the operator's work, not a check.
				const bound = deps.bindingsOf().filter((b) => b.credentialId === credentialId);
				if (bound.length > 0) {
					throw new Error(
						`this account is bound to ${bound.map((b) => b.workspaceId).join(", ")}. ` +
							"Bind those workspaces elsewhere first, or the binding would point at nothing.",
					);
				}
				// REFUSED, NOT HALF-PERFORMED — but only while there is something here to fail to
				// remove. A legacy account's secret is the flat token entry that produced its
				// descriptor, and this command touches the namespaced store and the catalog, neither
				// of which holds it; it used to run to completion and print success having removed
				// nothing.
				//
				// AN `incomplete` LEGACY RECORD IS THE OPPOSITE CASE and must not be caught by the
				// same refusal. Its secret is already gone — that is what `incomplete` means since
				// ISS-132 — so the record is all that is left, and this command owns the catalog. A
				// blanket refusal here would leave the operator's node with a phantom account no
				// command could remove: `forget` declines it and `sow` keeps it, correctly, because
				// nothing proves whose it was.
				if (target.secretRef.startsWith(LEGACY_REF_PREFIX) && target.health === "healthy") {
					throw new Error(
						`${credentialId} is a legacy account: its secret lives in the silo's flat token map, ` +
							"which this command does not touch. Re-authenticate with `refarm sow` to migrate it " +
							"out of that store, which is the act that retires it.",
					);
				}
				if (!options.yes) {
					process.stdout.write(
						`forget ${target.provider} "${target.alias}" (${credentialId})?\n` +
							"  The secret is deleted and cannot be recovered; logging in again creates a new one.\n" +
							revocationNotice(target.provider) +
							"  Re-run with --yes to do it.\n",
					);
					return;
				}

				// The SECRET first, then the descriptor. A failure between them leaves an `incomplete`
				// entry the operator can see and repair; the reverse order would leave an `unclaimed`
				// secret nothing describes.
				const silo = deps.siloOf();
				const prefix = `${MODEL_NAMESPACE}/`;
				if (target.secretRef.startsWith(prefix) && typeof silo.removeSecret === "function") {
					await silo.removeSecret(MODEL_NAMESPACE, target.secretRef.slice(prefix.length));
				}
				// THE CATALOG, NOT THE VIEW. `accounts` is the reconciled view — stored descriptors
				// MERGED with ones synthesised from the flat token map — and writing it back promotes
				// those synthetic readings into stored records (ISS-133). That is the derived
				// observation overwriting the model: the flat map then changes and the record does not.
				deps.writeCatalog(deps.catalogOf().filter((entry) => entry.credentialId !== credentialId));

				const extra = { credentialId, provider: target.provider, alias: target.alias };
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({ command: "credential", operation: "forget", extra }),
					);
				} else {
					process.stdout.write(`forgot ${target.provider} "${target.alias}"\n`);
				}
			}),
		);

	return credential;
}

export const credentialCommand = createCredentialCommand();
