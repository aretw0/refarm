import type {
	CapabilityDescriptor,
	CapabilityEnvelope,
	CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import {
	createReferenceRecordsFixture,
	stringifyRecordsYamlLdFrontMatter,
} from "@refarm.dev/records-contract-v1";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { submitEffortViaSidecar } from "./dispatch-submit.js";
import {
	discoverVaultProviders,
	type VaultDiscoveryResult,
} from "./vault-discovery.js";

/**
 * The `vault` command as a multi-surface CapabilityGroup — the host seam that
 * makes vault:v1 providers VISIBLE across surfaces. A plugin advertising vault
 * verbs (`<key>:search`/`extract`/`organize`/`profile`) now surfaces on `vault
 * list`, the REPL `/vault` slash, the TUI menu, and to the agent from ONE
 * declaration.
 *
 * This slice lists + inspects providers (list/show). It NEVER loads or runs a
 * vault surface — discovery reads a plugin's advertised `provides`, nothing more.
 * DISPATCHING a verb through the WASM component (submit → runtime → instance.call)
 * is the separate "loop" slice; making providers visible is pure, safe metadata.
 *
 * `deps.discover` is injected (defaults to scanning `<refarm-home>/plugins`) so
 * run() stays testable and never touches the filesystem directly.
 */
export interface VaultCommandDeps {
	/** Discover installed vault providers. Defaults to the refarm plugins dir. */
	discover: () => VaultDiscoveryResult;
	/** Submit a dispatch effort to the runtime. Defaults to the sidecar HTTP sink;
	 * injectable so `dispatch`'s run() is testable without a running daemon. */
	submitEffort: (effort: Effort) => Promise<string>;
	/** A UUID source for effort/task ids — injectable for deterministic tests. */
	newId: () => string;
}

export function defaultVaultDeps(): VaultCommandDeps {
	return {
		discover: () => discoverVaultProviders(),
		submitEffort: submitEffortViaSidecar,
		newId: () => crypto.randomUUID(),
	};
}

export function createVaultCapabilityGroup(
	deps: VaultCommandDeps = defaultVaultDeps(),
): CapabilityGroup {
	const list: CapabilityDescriptor = {
		name: "list",
		summary: "List vault:v1 providers contributed by installed plugins",
		run() {
			const { providers, rejected } = deps.discover();
			return buildJsonSuccessEnvelope({
				command: "vault",
				operation: "list",
				extra: {
					providers: providers.map((p) => ({
						pluginId: p.pluginId,
						pluginKey: p.pluginKey,
						verbs: p.verbs,
					})),
					rejected,
					count: providers.length,
				},
			});
		},
	};

	const show: CapabilityDescriptor = {
		name: "show",
		summary: "Show one vault provider by plugin id",
		args: [{ name: "id", required: true }],
		run(input) {
			const id = input.args.id as string;
			const { providers } = deps.discover();
			const provider = providers.find((p) => p.pluginId === id);
			if (!provider) {
				return buildJsonErrorEnvelope({
					command: "vault",
					operation: "show",
					error: "vault-provider-not-found",
					message: `No installed plugin advertises vault verbs under "${id}".`,
					nextAction: "Run `vault list` to see vault providers.",
				});
			}
			return buildJsonSuccessEnvelope({
				command: "vault",
				operation: "show",
				extra: {
					provider: {
						pluginId: provider.pluginId,
						pluginKey: provider.pluginKey,
						verbs: provider.verbs,
						targets: provider.targets,
					},
				},
			});
		},
	};

	const dispatch: CapabilityDescriptor = {
		name: "dispatch",
		summary: "Dispatch a vault verb to a loaded vault plugin via the runtime",
		args: [
			{ name: "verb", required: true },
			{ name: "note", required: true },
			{ name: "plugin", required: false },
		],
		async run(input) {
			const verb = input.args.verb as string;
			const notePath = input.args.note as string;
			// Default target is `vault`; an operator can point at another provider.
			const pluginId = (input.args.plugin as string | undefined) ?? "vault";

			// The effort's fn is the verb; the sidecar routes it as `<plugin>:dispatch`
			// carrying {verb, ...args} to the subscribed plugin. Correlate the async
			// result by the effort id (the replyRef the plugin stamps on its node).
			const effortId = deps.newId();
			const effort: Effort = {
				id: effortId,
				direction: "dispatch",
				tasks: [
					{
						id: deps.newId(),
						pluginId,
						fn: verb,
						args: { note: { path: notePath }, replyRef: effortId },
					},
				],
				source: "refarm-vault-dispatch",
				submittedAt: new Date().toISOString(),
			};

			try {
				const returnedId = await deps.submitEffort(effort);
				return buildJsonSuccessEnvelope({
					command: "vault",
					operation: "dispatch",
					extra: {
						effortId: returnedId,
						pluginId,
						verb,
						// The result lands asynchronously as a refarm:DispatchResult node
						// keyed by this replyRef — the caller reads it back by effortId.
						replyRef: effortId,
					},
					nextAction: `The vault result will be stored as a dispatch-result node keyed by replyRef "${effortId}".`,
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "vault",
					operation: "dispatch",
					error: "vault-dispatch-failed",
					message: `Could not submit the vault dispatch: ${String(error)}`,
					nextAction:
						"Is the runtime daemon up? Run `refarm runtime status`. Is a vault plugin loaded? Run `vault list`.",
				});
			}
		},
	};

	const init: CapabilityDescriptor = {
		name: "init",
		summary:
			"Start a notes vault from 0 — seed a directory with Obsidian-ready records",
		args: [{ name: "dir", required: true }],
		options: [
			{
				name: "empty",
				kind: "boolean",
				summary: "Create the vault empty (skip the seed records)",
			},
		],
		async run(input): Promise<CapabilityEnvelope> {
			const dir = input.args.dir as string;
			try {
				if (existsSync(dir)) {
					return buildJsonErrorEnvelope({
						command: "vault",
						operation: "init",
						error: "vault_dir_exists",
						message: `Refusing to init a vault over an existing path: ${dir}.`,
						nextAction: "Point at a new directory, or remove the existing one.",
					});
				}
				await mkdir(dir, { recursive: true });

				const seeded: string[] = [];
				if (input.options.empty !== true) {
					// Seed with the reference records rendered as Obsidian markdown
					// (YAML-LD front matter + body) — the vault IS just markdown files a
					// user opens in their own Obsidian; no plugin code, secrecy-safe.
					const manifest = createReferenceRecordsFixture();
					for (const record of manifest.records) {
						const body =
							record.sections?.map((s) => s.content).join("\n\n") ?? "";
						const markdown = stringifyRecordsYamlLdFrontMatter(record, body);
						const fileName = `${record.id.replace(/[^a-zA-Z0-9._-]+/g, "-")}.md`;
						await writeFile(path.join(dir, fileName), markdown, "utf-8");
						seeded.push(fileName);
					}
				}

				return buildJsonSuccessEnvelope({
					command: "vault",
					operation: "init",
					nextCommand: "requirements pull",
					nextCommands: ["requirements pull", "records list"],
					extra: {
						dir,
						empty: input.options.empty === true,
						seededFiles: seeded,
						seededCount: seeded.length,
					},
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return buildJsonErrorEnvelope({
					command: "vault",
					operation: "init",
					error: "vault_init_failed",
					message,
					nextAction: "Check write permissions for the target directory.",
				});
			}
		},
	};

	return {
		name: "vault",
		summary: "Inspect and dispatch vault:v1 verbs, and init a notes vault",
		actions: { list, show, dispatch, init },
		defaultAction: "list",
		transports: {
			cli: {},
			repl: { slashAliases: ["vaults"] },
			http: { method: "GET", path: "/vault" },
		},
		renderers: { tui: { section: "extensions" } },
	};
}
