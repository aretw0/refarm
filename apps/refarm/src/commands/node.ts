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
	isSealedPath,
	summariseNotCarried,
	type NodeDeclaration,
} from "./node-declaration.js";
import { sealPayload } from "./node-seal.js";

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

	return node;
}

export const nodeCommand = createNodeCommand();
