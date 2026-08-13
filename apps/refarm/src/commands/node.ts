/**
 * `refarm node` — the node as a file you can read, commit and replay.
 *
 * This is the ONLY module in the group that touches disk or the operator. `node-seal.ts` and
 * `node-declaration.ts` are pure, in the same split `sovereign-layout.ts` / `sovereign-export.ts`
 * hold against `backup.ts`.
 *
 * `declare` WITHOUT `--out` IS READ-ONLY AND ASKS FOR NOTHING. That is what lets it be probed for
 * directory independence, and what lets an operator see the shape of his own node before deciding
 * to seal it.
 */
import fs from "node:fs";
import path from "node:path";

import { Command } from "commander";

import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { createStdioOperatorChannel, type OperatorChannel } from "@refarm.dev/prompt-contract-v1";

import { nodeNamespaces, readSiloSplit, surveyHome } from "./backup.js";
import {
	buildDeclaration,
	diffDeclarations,
	isSealedPath,
	summariseNotCarried,
	type NodeDeclaration,
} from "./node-declaration.js";
import { readSealState, sealPayload, unsealPayload } from "./node-seal.js";

/** Read every file the declaration seals, as base64. Absent files are simply absent. */
export function collectSealedFiles(home: string): { relative: string; base64: string }[] {
	const collected: { relative: string; base64: string }[] = [];
	const walk = (dir: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			const relative = path.relative(home, full).split(path.sep).join("/");
			if (isSealedPath(relative)) {
				collected.push({ relative, base64: fs.readFileSync(full).toString("base64") });
			}
		}
	};
	walk(path.join(home, ".refarm"));
	return collected;
}

/**
 * Ask for a passphrase, twice when it is about to seal.
 *
 * `REFARM_NODE_PASSPHRASE` exists for automation and tests. It is read ONCE and never confirmed:
 * an environment variable cannot be typo'd twice differently, and asking a script to repeat itself
 * would be ceremony without information.
 */
export async function resolvePassphrase(
	channel: OperatorChannel,
	env: NodeJS.ProcessEnv,
	confirm: boolean,
): Promise<string> {
	const fromEnv = env.REFARM_NODE_PASSPHRASE;
	if (fromEnv) return fromEnv;
	const first = await channel.ask({ type: "secret", question: "Passphrase for this declaration:" });
	if (!confirm) return first;
	const again = await channel.ask({ type: "secret", question: "Repeat it:" });
	if (first !== again) {
		// Refused rather than retried, and refused BEFORE anything is written. A sealed file whose
		// passphrase was mistyped is indistinguishable from a corrupt one, forever.
		throw new Error("the two passphrases did not match — nothing was written");
	}
	return first;
}

function readJsonFile(file: string): Record<string, unknown> | null {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function createNodeCommand(
	homeOf = () => process.env.HOME ?? "",
	channelOf = (): OperatorChannel => createStdioOperatorChannel(),
): Command {
	const node = new Command("node").description(
		"Declare this node as one portable file, compare a node against one, and replay it",
	);

	node
		.command("declare")
		.description("Show what this node would declare, or write it sealed with --out")
		.option("--json", "Output machine-readable result")
		.option("--out <file>", "Write the sealed declaration to this path")
		.option("--force", "Overwrite an existing declaration at --out")
		.option("--governance <mode>", "Who is authoritative for this node: local or repo", "local")
		.action(
			async (options: { json?: boolean; out?: string; force?: boolean; governance?: string }) => {
				const home = homeOf();
				const config = readJsonFile(path.join(home, ".refarm", "config.json")) ?? {};
				const authPolicy = readJsonFile(path.join(home, ".refarm", "auth-policy.json"));
				const silo = readSiloSplit(home);
				const declared = nodeNamespaces(home);
				const { plan } = surveyHome(home, declared.namespaces[0] ?? null);
				const sealedFiles = collectSealedFiles(home);
				const relativeOf = (file: string) => path.relative(home, file).split(path.sep).join("/");
				const notCarried = summariseNotCarried(
					plan.carry.map((entry) => ({ relative: relativeOf(entry.file), bytes: entry.bytes ?? 0 })),
				);
				// `undecidable` is the export plan's name for a path NO LAYOUT ENTRY COVERS. Reported in
				// the preview and refused at seal time: a declaration written over a gap in the layout is
				// a declaration that quietly excludes whatever lives in that gap.
				const unregistered = plan.undecidable.map((entry) => relativeOf(entry.file));

				if (!options.out) {
					const preview = {
						governance: options.governance ?? "local",
						decisionKeys: Object.keys(config).sort(),
						sealed: sealedFiles.map((file) => file.relative).sort(),
						reAuthenticate: silo.reAuthenticate,
						notCarried,
						unregistered,
						namespaces: declared,
					};
					if (options.json) {
						printJson(
							buildJsonSuccessEnvelope({ command: "node", operation: "declare", extra: preview }),
						);
						return;
					}
					process.stdout.write(
						`Declaration preview (nothing written)\n\n` +
							`  decisions   ${preview.decisionKeys.length} key(s): ${preview.decisionKeys.join(", ") || "(none)"}\n` +
							`  sealed      ${preview.sealed.length} identity file(s)\n` +
							preview.sealed.map((file) => `                ${file}\n`).join("") +
							`  re-auth     ${silo.reAuthenticate.join(", ") || "(none)"}\n` +
							`  NOT carried ${notCarried.history} history + ${notCarried.storage} storage file(s), ` +
							`${notCarried.bytes} bytes — history is lost, storage replicates\n` +
							(unregistered.length > 0
								? `  UNREGISTERED ${unregistered.length} path(s) — declaring is refused until the layout describes them\n`
								: "") +
							`\n  write it:   refarm node declare --out <file>\n`,
					);
					return;
				}

				if (unregistered.length > 0) {
					throw new Error(
						`refusing to declare: ${unregistered.length} path(s) are unregistered — no layout entry covers them:\n  ` +
							`${unregistered.slice(0, 10).join("\n  ")}\n` +
							`  Add entries to sovereign-layout.ts deliberately, then declare.`,
					);
				}
				if (fs.existsSync(options.out) && !options.force) {
					throw new Error(`${options.out} already exists — pass --force to overwrite it`);
				}
				const passphrase = await resolvePassphrase(channelOf(), process.env, true);
				const declaration: NodeDeclaration = buildDeclaration({
					nodeName: String((config.node as { name?: unknown } | undefined)?.name ?? "unnamed"),
					declaredAt: new Date().toISOString(),
					governance: options.governance === "repo" ? "repo" : "local",
					config,
					authPolicy,
					seal: sealPayload(
						{ files: Object.fromEntries(sealedFiles.map((file) => [file.relative, file.base64])) },
						passphrase,
					),
					reAuthenticate: silo.reAuthenticate,
					notCarried,
				});
				fs.writeFileSync(options.out, `${JSON.stringify(declaration, null, 2)}\n`);
				const result = {
					out: options.out,
					bytes: fs.statSync(options.out).size,
					sealed: sealedFiles.length,
					reAuthenticate: silo.reAuthenticate,
				};
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({ command: "node", operation: "declare", extra: result }),
					);
				} else {
					process.stdout.write(
						`declared ${options.out} — ${result.bytes} bytes, ${result.sealed} identity file(s) sealed\n` +
							`  The passphrase is the ONLY thing that opens this file. Nothing else can.\n` +
							`  re-authenticate after applying: ${silo.reAuthenticate.join(", ") || "(none)"}\n`,
					);
				}
			},
		);

	node
		.command("diff")
		.argument("<file>", "A declaration written by `refarm node declare --out`")
		.description("Compare this node against a declaration, key by key")
		.option("--json", "Output machine-readable result")
		.action((file: string, options: { json?: boolean }) => {
			const home = homeOf();
			const declaration = readJsonFile(file) as NodeDeclaration | null;
			if (!declaration) throw new Error(`${file} is not a readable declaration`);
			const config = readJsonFile(path.join(home, ".refarm", "config.json")) ?? {};
			const diff = diffDeclarations(config, declaration);
			const seal = readSealState(declaration.seal);
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "node",
						operation: "diff",
						extra: { file, diff, seal, governance: declaration.governance },
					}),
				);
			} else {
				const label: Record<string, string> = {
					aligned: "=",
					"node-only": "> only on this node",
					"source-only": "< only in the file",
					divergent: "! different",
				};
				process.stdout.write(
					`${file} (governance: ${declaration.governance})\n` +
						diff.keys.map((entry) => `  ${entry.key.padEnd(20)} ${label[entry.verdict]}\n`).join("") +
						`  ${"identity".padEnd(20)} ${diff.identity}` +
						(seal.state === "openable" ? "\n" : ` — ${(seal as { reason: string }).reason}\n`),
				);
			}
			// NON-ZERO ON DIVERGENCE, so this can be a gate rather than a report.
			if (!diff.aligned) process.exitCode = 1;
		});

	node
		.command("apply")
		.argument("<file>", "A declaration written by `refarm node declare --out`")
		.description("Write a declaration's decisions and identity onto this node")
		.option("--json", "Output machine-readable result")
		.option("--yes", "Skip the confirmation — for automation, never for a first run")
		.action(async (file: string, options: { json?: boolean; yes?: boolean }) => {
			const home = homeOf();
			const declaration = readJsonFile(file) as NodeDeclaration | null;
			if (!declaration) throw new Error(`${file} is not a readable declaration`);
			const seal = readSealState(declaration.seal);
			if (seal.state !== "openable") {
				throw new Error(`cannot apply ${file}: ${(seal as { reason: string }).reason}`);
			}

			const channel = channelOf();
			// THE DIFF IS SHOWN BEFORE THE PASSPHRASE IS ASKED FOR. An operator who sees the change is
			// wrong should not have had to type a secret to learn it.
			const current = readJsonFile(path.join(home, ".refarm", "config.json")) ?? {};
			const diff = diffDeclarations(current, declaration);
			if (!options.yes) {
				const changing = diff.keys.filter((entry) => entry.verdict !== "aligned");
				channel.say?.(
					`Applying ${file} will change ${changing.length} key(s): ` +
						`${changing.map((entry) => entry.key).join(", ") || "(none)"}`,
				);
				const confirmed = await channel.ask({
					type: "confirm",
					question: "Write these declarations and this identity onto this node?",
				});
				if (!confirmed) {
					process.stdout.write("nothing written\n");
					return;
				}
			}

			const passphrase = await resolvePassphrase(channel, process.env, false);
			// UNSEALED BEFORE ANYTHING IS WRITTEN. A wrong passphrase must leave the node exactly as it
			// was, not half-applied.
			const opened = unsealPayload(declaration.seal, passphrase) as {
				files?: Record<string, string>;
			};

			fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
			fs.writeFileSync(
				path.join(home, ".refarm", "config.json"),
				`${JSON.stringify(declaration.declarations, null, 2)}\n`,
			);
			if (declaration.authPolicy) {
				fs.writeFileSync(
					path.join(home, ".refarm", "auth-policy.json"),
					`${JSON.stringify(declaration.authPolicy, null, 2)}\n`,
				);
			}
			const written: string[] = [];
			for (const [relative, base64] of Object.entries(opened.files ?? {})) {
				const target = path.join(home, relative);
				fs.mkdirSync(path.dirname(target), { recursive: true });
				fs.writeFileSync(target, Buffer.from(base64, "base64"));
				written.push(relative);
			}

			// THREE STATES, and today the operator's answer is the middle one. Replication is not
			// attempted by this slice, so it reports `not-attempted` rather than inventing a peer
			// count — and the human output says "not replicated" in the same breath, because a silent
			// success would read as a complete node.
			const replication = { state: "not-attempted" as const, peers: 0 };
			const result = {
				file,
				keys: Object.keys(declaration.declarations ?? {}).length,
				identityFiles: written.length,
				reAuthenticate: declaration.reAuthenticate,
				replication,
			};
			if (options.json) {
				printJson(buildJsonSuccessEnvelope({ command: "node", operation: "apply", extra: result }));
			} else {
				process.stdout.write(
					`applied ${file}\n` +
						`  ✓ ${result.keys} declaration key(s), ${written.length} identity file(s)\n` +
						`  → data: not replicated — this slice does not sync, and a node with no peer has\n` +
						`    nobody to sync from. History and storage did NOT come back.\n` +
						`    until a second node exists:  refarm backup create <destination>\n` +
						`  re-authenticate: ${declaration.reAuthenticate.join(", ") || "(none)"}\n`,
				);
			}
		});

	return node;
}

export const nodeCommand = createNodeCommand();
