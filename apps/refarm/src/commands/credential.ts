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
	isRefusal,
	LEGACY_REF_PREFIX,
	resolveModelAccount,
	type AccountView,
	type ModelAccountBinding,
	type ModelAccountDescriptor,
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

function defaultDeps(): CredentialDeps {
	// The DECLARED home, which is the only reading that honours REFARM_HOME (ISS-139).
	const homeOf = () => resolveRefarmHome();
	return {
		homeOf,
		siloOf: () => new SiloCore() as unknown as CredentialSilo,
		viewOf: () =>
			loadAccountView({ home: homeOf(), silo: new SiloCore() as unknown as AccountViewSilo }),
		catalogOf: () => readCatalog(homeOf()),
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
				const accounts = (await loadAccounts()).map(safeRow);
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
							extra: { accounts, ...(identityNotice ? { identityNotice } : {}) },
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
						.join("") + (identityNotice ? `\n  ${identityNotice}\n` : ""),
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
		.command("bind")
		.argument("<workspace>", "Workspace id, as declared in .refarm/config.json")
		.argument("<credentialId>", "The OPAQUE id — never the alias, which may be renamed")
		.description("Bind a workspace to one model account")
		.option("--json", "Output machine-readable result")
		.action(async (workspace: string, credentialId: string, options: { json?: boolean }) =>
			guarded("bind", options, async () => {
				const accounts = await loadAccounts();
				if (!accounts.some((a) => a.credentialId === credentialId && a.health === "healthy")) {
					throw new Error(
						`model_credential_none: no eligible account on this node carries the id ${credentialId}`,
					);
				}
				const configPath = path.join(deps.homeOf(), "config.json");
				const config = readJson<Record<string, unknown>>(configPath, {});
				// PERSISTS THE OPAQUE ID, NEVER THE ALIAS (D2). An alias may be renamed, and every
				// binding written against it would then point at nothing — or at whatever took the name.
				const bindings = { ...((config.modelBindings as Record<string, string>) ?? {}) };
				bindings[workspace] = credentialId;
				fs.writeFileSync(
					configPath,
					`${JSON.stringify({ ...config, modelBindings: bindings }, null, 2)}\n`,
				);
				const extra = { workspace, credentialId };
				if (options.json) {
					printJson(buildJsonSuccessEnvelope({ command: "credential", operation: "bind", extra }));
				} else {
					process.stdout.write(`${workspace} → ${credentialId}\n`);
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
