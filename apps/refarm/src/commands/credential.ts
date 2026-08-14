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
	resolveModelAccount,
	type AccountView,
	type ModelAccountBinding,
	type ModelAccountDescriptor,
} from "@refarm.dev/model-account-contract-v1";
import { SiloCore } from "@refarm.dev/silo";

import { loadAccountView, type AccountViewSilo } from "../credentials/account-view-loader.js";
import { emitCommandRefusal } from "./command-refusal.js";

interface CredentialSilo {
	loadTokens(): Promise<unknown>;
	saveTokens(tokens: Record<string, unknown>): Promise<unknown>;
}

export interface CredentialDeps {
	homeOf: () => string;
	siloOf: () => CredentialSilo;
	/** The one snapshot this command answers from. Built by the loader that owns the I/O. */
	viewOf: () => Promise<AccountView>;
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
	const homeOf = () => process.env.HOME ?? "";
	return {
		homeOf,
		siloOf: () => new SiloCore() as unknown as CredentialSilo,
		viewOf: () =>
			loadAccountView({ home: homeOf(), silo: new SiloCore() as unknown as AccountViewSilo }),
		bindingsOf: () =>
			Object.entries(
				readJson<{ modelBindings?: Record<string, string> }>(
					path.join(homeOf(), ".refarm", "config.json"),
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
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "credential",
							operation: "list",
							extra: { accounts },
						}),
					);
					return;
				}
				if (accounts.length === 0) {
					process.stdout.write("no model account is registered on this node\n  refarm sow\n");
					return;
				}
				process.stdout.write(
					accounts
						.map(
							(a) =>
								`  ${a.provider.padEnd(18)}${a.alias.padEnd(16)}${a.health.padEnd(12)}${a.identity}\n`,
						)
						.join(""),
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
				const configPath = path.join(deps.homeOf(), ".refarm", "config.json");
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

	return credential;
}

export const credentialCommand = createCredentialCommand();
