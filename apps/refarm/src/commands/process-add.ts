import {
	createFileOperationTrail,
	createNodeOperationFileSystem,
	type OperationFileSystem,
	type OperationTrail,
} from "@refarm.dev/operation-consent-v1";
import {
	parseProcessCatalog,
	type ProcessStatus,
	type RestartPolicy,
} from "@refarm.dev/process-contract-v1";
import {
	createStdioOperatorChannel,
	OperatorPromptCancelledError,
	type OperatorChannel,
	type SelectPrompt,
} from "@refarm.dev/prompt-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refarmCommand } from "../brand.js";
import {
	authorCatalogDeclaration,
	buildCatalogOperationRequest,
	catalogConfigPath,
	catalogTrailPath,
	planCatalogDeclaration,
	renderCatalogProposal,
	standingCatalogDecision,
	type CatalogDeclarationPlan,
} from "./catalog-authoring.js";
import { DEFAULT_WEB_SERVE_PORT } from "./web-serve.js";

/**
 * `refarm process add` — the AUTHORING half of `refarm process`.
 *
 * Design: `docs/superpowers/specs/2026-07-31-declaring-is-authoring-design.md` (the seam), and
 * `docs/superpowers/specs/2026-07-30-declared-processes-design.md` (what a declaration means).
 *
 * WHAT FORCED THIS. The `processes` slice shipped `list | status | install | uninstall | linger` —
 * the whole operation surface — and no way to WRITE a declaration. So the first thing the operator
 * met was:
 *
 *     $ refarm process install web-serve
 *     ✗  processes."web-serve" is not declared in .refarm/config.json
 *
 * and the only path from there was hand-editing JSON. That is exactly the gap "declaring is
 * authoring" exists to close, and `refarm delivery add` is the proven precedent.
 *
 * THE DIFFERENCE FROM `delivery add`, AND IT IS THE POINT. `delivery add` had to interrogate,
 * because only the operator knows their `chatId` — refarm cannot derive a fact about a third
 * party's chat. **This command has no such excuse.** For `web serve`, refarm already knows the
 * command (its own launcher, plus the argv `refarm dist publish` prints), the working directory
 * (the sovereign root) and the port (the constant the installer is baked with). Asking for those
 * would be interrogation dressed as consent.
 *
 * So a declaration arrives as a PROPOSAL TO AUTHORISE OR EDIT:
 *
 *  · every field refarm can derive is derived, shown, AND SOURCED — the operator reads where each
 *    value came from, so accepting is a check rather than a leap of faith;
 *  · the proposal can be adjusted before it is written, which is the "or edit" half — a proposal
 *    you can only accept whole is a form with one field;
 *  · only what cannot be derived is asked. For `web serve` that is exactly one thing: `restart`.
 *
 * A3 OF THE DESIGN IS NOT BROKEN BY THIS, and the distinction is worth stating because it looks
 * close. A3 refuses SYNTHESIS: writing what the operator "must have meant" and telling them after.
 * Deriving a value, showing it beside its source, and applying it only through the same consent
 * journey is the opposite — the operator still decides every value; refarm just stops making them
 * type what it already knows. What is never derived is the field the contract itself refuses to
 * guess: `restart` is asked, every time, in terms a person can answer, and there is no flag-free
 * path that fills it in.
 *
 * THE COMMAND IS THE OPERATOR'S OWN ARGV, so it gets more care than a delivery channel's options.
 * A supervisor execs a program; it does not run a shell. `command[0]` must be absolute (systemd
 * does not search `PATH`) and a shell line is not a command. Both rules already exist in the
 * contract — this surfaces them as QUESTIONS while the operator is still typing, instead of as a
 * validation error after they thought they were done.
 *
 * IT ENDS BY VERIFYING, NOT CLAIMING: the declaration is read back with the real `process status`,
 * and what is handed over is the activation line — never a `systemctl` this command ran. That is
 * the boundary `cert trust` and `process install` already draw.
 */

/** The catalog block this writes. The SAME `.refarm/config.json` the parser reads; there is no
 *  second store, and a hand-written block is the input, not an obstacle. */
export const PROCESS_BLOCK = "processes" as const;

const PROCESS_ADD_COMMAND = refarmCommand(["process", "add"]);
const PROCESS_LIST_COMMAND = refarmCommand(["process", "list", "--json"]);

/** What the operator runs next to have this supervised. Named, never run. */
export function processInstallCommand(name: string): string {
	return refarmCommand(["process", "install", name]);
}

export function processStatusCommand(name: string): string {
	return refarmCommand(["process", "status", name, "--json"]);
}

// ── Refusals ──────────────────────────────────────────────────────────────────

/** A refusal the command turns into the repo's envelope, carrying its own handoff — a wizard with
 *  no terminal and a wizard with an unusable command need different next steps. */
export class ProcessAddRefusal extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly nextCommands: string[] = [PROCESS_LIST_COMMAND],
	) {
		super(message);
		this.name = "ProcessAddRefusal";
	}
}

// ── What was derived, and from where ──────────────────────────────────────────

/**
 * One value refarm worked out for itself, with its PROVENANCE.
 *
 * The source is not decoration. A proposal the operator cannot check is a proposal they can only
 * trust, and "authorise or edit" needs the first half to be real: `command` derived from
 * `REFARM_COMMAND` and `command` derived from a `PATH` walk are different claims about their
 * machine, and only one of them survives the launcher being reinstalled somewhere else.
 */
export interface DerivedField {
	/** The declaration key, or a value that feeds one (`port`, `directory`). */
	key: string;
	value: string;
	/** Where it came from, in the operator's terms. */
	source: string;
}

// ── The invocation of THIS refarm ─────────────────────────────────────────────

export interface RefarmInvocation {
	/** The argv prefix that runs refarm, absolute from the first element. */
	argv: string[];
	source: string;
}

/** Absolute in the sense a supervisor means it: no lookup will happen. */
function isAbsolute(value: string): boolean {
	return value.startsWith("/");
}

/** `execvp`'s search, minus the `exec` — a bare name resolved by walking `PATH` and looking for a
 *  regular file with an executable bit, which is exactly what the shell does before it runs one. */
export function resolveOnPath(
	name: string,
	env: NodeJS.ProcessEnv,
	isExecutable: (candidate: string) => boolean = defaultIsExecutable,
): string | null {
	if (name.includes("/")) return null;
	for (const dir of (env.PATH ?? "").split(path.delimiter)) {
		if (!dir) continue;
		const candidate = path.join(dir, name);
		if (isExecutable(candidate)) return candidate;
	}
	return null;
}

function defaultIsExecutable(candidate: string): boolean {
	try {
		const stats = fs.statSync(candidate);
		return stats.isFile() && (stats.mode & 0o111) !== 0;
	} catch {
		return false;
	}
}

export interface InvocationSource {
	env: NodeJS.ProcessEnv;
	execPath?: string;
	entrypoint?: string | null;
	isExecutable?: (candidate: string) => boolean;
}

/**
 * How to spell "run refarm" in a unit file, DERIVED — never a literal path.
 *
 * A hardcoded `/usr/local/bin/refarm` is right on exactly one machine. Three sources, in the order
 * that survives longest:
 *
 *  1. `REFARM_COMMAND` — the launcher shim exports its OWN absolute path before it execs Node, so
 *     this is refarm saying where refarm is. It keeps pointing at the operator's launcher after a
 *     rebuild moves `dist/`, which a pinned entrypoint would not.
 *  2. a `PATH` walk for the canonical binary name — the same answer a shell would give.
 *  3. this process's interpreter + entrypoint, both absolute. Last because it names a build
 *     artifact rather than the operator's launcher; still correct, and the only thing available
 *     when refarm was started as `node …/dist/index.js` directly.
 *
 * `null` when the process cannot describe itself, and then the wizard ASKS rather than inventing.
 */
export function deriveRefarmInvocation(source: InvocationSource): RefarmInvocation | null {
	const launcher = source.env.REFARM_COMMAND?.trim();
	if (launcher && isAbsolute(launcher)) {
		return { argv: [launcher], source: "REFARM_COMMAND — o launcher que te trouxe até aqui" };
	}
	const onPath = resolveOnPath("refarm", source.env, source.isExecutable);
	if (onPath) return { argv: [onPath], source: `PATH — o mesmo "refarm" que seu shell acha` };
	const execPath = source.execPath ?? process.execPath;
	const entrypoint =
		source.entrypoint === undefined ? (process.argv[1] ?? null) : source.entrypoint;
	if (entrypoint && isAbsolute(execPath) && isAbsolute(entrypoint)) {
		return { argv: [execPath, entrypoint], source: "o processo em execução (node + entrypoint)" };
	}
	return null;
}

// ── A command line is not a command ───────────────────────────────────────────

export interface ParsedCommandLine {
	argv: string[];
	/** Shell operators found OUTSIDE quotes. Non-empty means the operator typed a shell LINE, and
	 *  a supervisor has no shell to give it to. */
	shellOperators: string[];
}

const SHELL_OPERATOR_CHARS = new Set(["|", "&", ";", "<", ">", "`", "*"]);

/**
 * Split what the operator typed into an argv, and NOTICE when it was never an argv at all.
 *
 * The contract refuses `"command": "refarm web serve ."` outright, for a good reason: every
 * splitter is a quoting bug waiting for a filename with a space in it. But a person at a prompt
 * types a line, so the line has to be met somewhere — here, where it can be turned into a
 * QUESTION ("this is a shell line; a supervisor runs a program") instead of a validation error
 * after they believed they were finished.
 *
 * Quotes are honoured and operators are detected only OUTSIDE them, so the deliberate escape
 * hatch — `/bin/sh -c "a | b"` — reads as what it is: an explicit request for a shell, with the
 * shell named in `command[0]` where the operator can see it.
 */
export function parseCommandLine(raw: string): ParsedCommandLine {
	const argv: string[] = [];
	const operators = new Set<string>();
	let current = "";
	let started = false;
	let quote: '"' | "'" | null = null;

	for (let index = 0; index < raw.length; index += 1) {
		const char = raw[index]!;
		if (quote) {
			if (char === quote) {
				quote = null;
				continue;
			}
			current += char;
			started = true;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			started = true;
			continue;
		}
		if (char === "\\" && index + 1 < raw.length) {
			current += raw[index + 1];
			started = true;
			index += 1;
			continue;
		}
		if (/\s/.test(char)) {
			if (started) {
				argv.push(current);
				current = "";
				started = false;
			}
			continue;
		}
		if (char === "$" && raw[index + 1] === "(") operators.add("$(");
		else if (SHELL_OPERATOR_CHARS.has(char)) {
			const pair = raw.slice(index, index + 2);
			operators.add(pair === "&&" || pair === "||" ? pair : char);
		}
		current += char;
		started = true;
	}
	if (started) argv.push(current);
	return { argv, shellOperators: [...operators] };
}

/** `~/x` is a SHELL expansion; a supervisor passes it through literally. Expanded here because
 *  the operator typed what they type everywhere else, and the alternative is a unit that starts
 *  in a directory called `~`. */
export function expandHome(value: string, env: NodeJS.ProcessEnv): string {
	const home = env.HOME?.trim();
	if (!home) return value;
	if (value === "~") return home;
	if (value.startsWith("~/")) return path.join(home, value.slice(2));
	return value;
}

// ── The question the contract refuses to answer ───────────────────────────────

/**
 * `restart`, asked as what it MEANS.
 *
 * Not "declare a restart policy" — *if this dies, does it come back?* Each option states the
 * consequence, because the consequence is the whole content of the field, and an operator who
 * picks `never` for a server discovers it at the next reboot rather than here.
 *
 * NO `default`. Deliberately, and it is the one rule in this file worth breaking on purpose to
 * check the tests notice: the contract refuses to guess this, and a wizard that pre-answered it
 * would be guessing on the contract's behalf through a UI affordance.
 */
export function processRestartPrompt(name: string): SelectPrompt {
	return {
		type: "select",
		question: `Se "${name}" morrer, ele volta sozinho?`,
		options: [
			{
				value: "always",
				label: "Sempre — mesmo se sair limpo. É o que um servidor quer",
				description:
					"o supervisor sobe de novo depois de qualquer saída, e de novo depois de um reboot",
			},
			{
				value: "on-failure",
				label: "Só quando dá errado — saída não-zero ou sinal",
				description:
					"uma tarefa que pode legitimamente terminar; terminar bem não é motivo para subir de novo",
			},
			{
				value: "never",
				label: "Não — quando acabar, acabou",
				description: "sobe uma vez; se cair, fica caído até você mandar subir",
			},
		],
	};
}

const RESTART_POLICIES: readonly RestartPolicy[] = ["always", "on-failure", "never"];

function parseRestartFlag(raw: string): RestartPolicy {
	const value = raw.trim();
	if (!(RESTART_POLICIES as readonly string[]).includes(value)) {
		throw new ProcessAddRefusal(
			"process-add-invalid-restart",
			`--restart must be one of ${RESTART_POLICIES.map((policy) => `"${policy}"`).join(", ")} ` +
				`(got ${JSON.stringify(raw)}).`,
			[`${PROCESS_ADD_COMMAND} --help`],
		);
	}
	return value as RestartPolicy;
}

// ── Recipes: the processes refarm already knows how to describe ───────────────

export interface RecipeContext {
	root: string;
	env: NodeJS.ProcessEnv;
	invocation: RefarmInvocation;
	/** Injected so a test never needs a published dist tree. */
	exists(target: string): boolean;
	/** Operator-supplied narrowings, when they passed a flag instead of adjusting at the prompt. */
	overrides: { port?: number; directory?: string };
}

export interface ProcessProposal {
	name: string;
	description: string;
	command: string[];
	workingDirectory: string;
	derived: DerivedField[];
	/** What the operator has to know, printed and never performed. */
	preflight: string[];
	/** The fields this recipe lets the operator adjust before authorising. */
	adjustable: RecipeAdjustment[];
}

export interface RecipeAdjustment {
	key: "directory" | "port";
	question: string;
	current: string;
}

export interface ProcessRecipe {
	name: string;
	summary: string;
	propose(context: RecipeContext): ProcessProposal;
}

/**
 * `web serve` — the process whose absence started all of this.
 *
 * Every value below is a fact refarm already holds:
 *
 *  · the command is refarm's own launcher plus the argv `refarm dist publish` prints as
 *    "Serve on the mesh" — the same subcommand, the same directory, the same `--port`;
 *  · the directory is `dist publish`'s default `--out` (`.refarm/dist`) plus the `farm-client`
 *    subdirectory it assembles into, confirmed against the filesystem;
 *  · the port is `DEFAULT_WEB_SERVE_PORT`, the constant baked into every installer already handed
 *    to a device, which is precisely why it is not a taste question;
 *  · the working directory is the sovereign root — the directory whose `.refarm/config.json` this
 *    declaration is being written into.
 *
 * NOT derived: `restart`. Asked, always.
 */
export const WEB_SERVE_RECIPE: ProcessRecipe = {
	name: "web-serve",
	summary:
		"web serve — o servidor da malha: é dele que um aparelho faz cold-bootstrap e é ele que " +
		"`farm-update` consulta.",
	propose(context) {
		const publishedRoot = path.join(context.root, ".refarm", "dist");
		const kitDir = path.join(publishedRoot, "farm-client");
		const directory =
			context.overrides.directory ?? (context.exists(kitDir) ? kitDir : publishedRoot);
		const port = context.overrides.port ?? DEFAULT_WEB_SERVE_PORT;
		const command = [...context.invocation.argv, "web", "serve", directory, "--port", String(port)];
		const published = context.exists(directory);
		return {
			name: "web-serve",
			description: "the mesh distribution server devices bootstrap and farm-update from",
			command,
			workingDirectory: context.root,
			derived: [
				{
					key: "command",
					value: command.join(" "),
					source: `${context.invocation.source} + o argv que \`${refarmCommand(["dist", "publish"])}\` imprime`,
				},
				{
					key: "directory",
					value: directory,
					source: context.overrides.directory
						? "--dir, o que você passou"
						: `o --out padrão de \`${refarmCommand(["dist", "publish"])}\` (.refarm/dist) + farm-client${
								published ? ", que existe aqui" : " — que ainda NÃO existe aqui"
							}`,
				},
				{
					key: "port",
					value: String(port),
					source: context.overrides.port
						? "--port, o que você passou"
						: "DEFAULT_WEB_SERVE_PORT — a mesma porta assada em todo installer já entregue a um aparelho",
				},
				{
					key: "workingDirectory",
					value: context.root,
					source: "a raiz soberana — o diretório cujo .refarm/config.json recebe esta declaração",
				},
			],
			preflight: published
				? [
						`${directory} existe — \`${refarmCommand(["dist", "publish"])}\` já rodou aqui.`,
						"Trocar a porta quebra os aparelhos já bootstrapados: eles consultam a porta assada no installer.",
					]
				: [
						`${directory} ainda não existe. Rode \`${refarmCommand(["dist", "publish"])}\` antes de ligar ` +
							"o serviço — a declaração pode ser escrita agora, o diretório só precisa existir na hora de servir.",
					],
			adjustable: [
				{
					key: "directory",
					question: "Qual diretório o servidor deve servir? (caminho absoluto)",
					current: directory,
				},
				{ key: "port", question: "Em qual porta ele escuta?", current: String(port) },
			],
		};
	},
};

const RECIPES: ReadonlyMap<string, ProcessRecipe> = new Map([
	[WEB_SERVE_RECIPE.name, WEB_SERVE_RECIPE],
]);

/** The recipe for a declared name, or `null` when refarm has nothing derived to offer and has to
 *  ask for everything — which is not a failure, only a different conversation. */
export function processRecipe(name: string): ProcessRecipe | null {
	return RECIPES.get(name) ?? null;
}

/** The names this command can propose whole. Printed in help and in the "what can I add?" line. */
export function processRecipeNames(): string[] {
	return [...RECIPES.keys()];
}

// ── The entry ─────────────────────────────────────────────────────────────────

export interface ProcessEntryInput {
	name: string;
	description: string;
	command: readonly string[];
	workingDirectory?: string;
	restart: RestartPolicy;
}

/**
 * The declaration entry, validated by the SAME parser that will read it back off disk.
 *
 * Not belt-and-braces: it means a declaration this wizard produces can never be one the node
 * would reject — including the two rules this command exists to surface early (a shell string is
 * not a command; `restart` is not optional).
 */
export function buildProcessEntry(input: ProcessEntryInput): Record<string, unknown> {
	const entry: Record<string, unknown> = {
		description: input.description,
		// PASSED THROUGH, never laundered. Spreading a string here would turn `"refarm web serve ."`
		// into an array of characters and hand the parser a shape it accepts — routing around the
		// exact refusal this call exists to respect.
		command: Array.isArray(input.command) ? [...input.command] : (input.command as unknown),
		...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
		restart: input.restart,
	};
	parseProcessCatalog({ [PROCESS_BLOCK]: { [input.name]: entry } });
	return entry;
}

// ── Options, result, deps ─────────────────────────────────────────────────────

export interface ProcessAddOptions {
	name?: string;
	description?: string;
	/** The command as the operator would type it. Parsed by `parseCommandLine`, held to the same
	 *  two rules the prompt is. */
	command?: string;
	workingDirectory?: string;
	restart?: string;
	/** Recipe narrowings. Present ⇒ the proposal shows YOUR value with "--dir/--port" as its source. */
	dir?: string;
	port?: string;
	/** "I know something is already there / already decided — ask me anyway." */
	replace?: boolean;
	/** "There is no terminal here, and that is fine — I am attending from another surface."
	 *  Never inferred: a publisher exists on every node since the pending-prompt bridge, so its
	 *  presence says nothing about whether a human is watching (`f9a0ad4f`). */
	attendedElsewhere?: boolean;
}

export type ProcessAddResult =
	| {
			status: "declared";
			process: string;
			description: string;
			command: string[];
			workingDirectory: string | null;
			restart: RestartPolicy;
			configPath: string;
			recordId: string;
			undoCommand: string;
			replaced: boolean;
			/** What refarm worked out for itself, with provenance — the "authorise" half, in the result. */
			derived: DerivedField[];
			/** The declaration keys the operator was actually asked about. */
			asked: string[];
			/** VERIFIED, not claimed: the real `process status`, read back after the write. */
			statuses: ProcessStatus[];
			/** Handed over, never run. */
			installCommand: string;
	  }
	| { status: "declined"; process: string; recordId: string }
	/** "Agora não" — nothing recorded, the question comes back next run. */
	| { status: "deferred"; process: string }
	/** Ctrl+C / EOF mid-wizard. Nothing asked after it, nothing written. */
	| { status: "cancelled"; process: string | null }
	| { status: "unchanged"; process: string; reason: "already-declared" | "already-decided" };

export interface ProcessAddDeps {
	root?: string;
	env?: NodeJS.ProcessEnv;
	/** Is there a human at a terminal? Defaults to real TTY detection. */
	interactive?: boolean;
	operator?: OperatorChannel;
	trail?: OperationTrail;
	fs?: OperationFileSystem;
	now?: () => string;
	decidedBy?: string;
	host?: string;
	announce?: (line: string) => void;
	/** Seamed so a test never needs a published dist tree. */
	exists?: (target: string) => boolean;
	/** Seamed so a test never needs the operator's real launcher on PATH. */
	invocation?: RefarmInvocation | null;
	/** How a `PATH` entry is judged runnable. Seamed for the same reason. */
	isExecutable?: (candidate: string) => boolean;
	/**
	 * How the wizard proves what it wrote.
	 *
	 * Lazily imported by default, so this module never sits in an import cycle with the command
	 * that hosts it — and injectable, so a test can assert the verification happens without a
	 * systemd anywhere.
	 */
	verify?: (name: string, root: string) => Promise<ProcessStatus[]>;
}

async function defaultVerify(name: string, root: string): Promise<ProcessStatus[]> {
	const { runProcessStatus } = await import("./process.js");
	return (await runProcessStatus([name], { root })).statuses;
}

function undoCommandFor(recordId: string): string {
	return refarmCommand(["config", "history", "undo", recordId, "--local"]);
}

const MAX_COMMAND_ATTEMPTS = 3;

// ── The wizard ────────────────────────────────────────────────────────────────

/**
 * Ask what cannot be derived, propose the rest, show the exact JSON, write only after a yes.
 *
 * Reading order: the gates (nowhere to ask, already declared, already decided), then the proposal,
 * then the one question the contract refuses to answer, then the consent journey, then the
 * verification. Every write in here happens after the authorisation, which is what makes
 * cancellation at any point leave nothing half-written.
 */
export async function runProcessAdd(
	options: ProcessAddOptions,
	deps: ProcessAddDeps = {},
): Promise<ProcessAddResult> {
	const env = deps.env ?? process.env;
	const root = deps.root ?? process.cwd();
	const say = deps.announce ?? ((line: string) => console.log(line));
	const exists = deps.exists ?? ((target: string) => fs.existsSync(target));

	// Answerable from the ARGUMENTS ALONE — refused before anybody is disturbed. Walking an
	// operator (or a device that had to be attended for the questions to arrive at all) through a
	// conversation only to reject a flag they passed at the start is the wrong order.
	const restartFromFlag = options.restart ? parseRestartFlag(options.restart) : null;
	const portFromFlag = parsePortFlag(options.port);

	// NOWHERE TO ASK ⇒ NO PROMPT, AND NO HANG. A declaration is the operator's; with nobody to ask
	// there is nobody to author it. A terminal is the default evidence, and being attended from
	// elsewhere is DECLARED by the caller that knows it — a publisher merely EXISTING is not
	// evidence that anyone is watching (`f9a0ad4f`), which is the lesson `delivery add` paid for.
	const atTerminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
	const interactive = deps.interactive ?? (atTerminal || Boolean(options.attendedElsewhere));
	if (!interactive) {
		throw new ProcessAddRefusal(
			"process-add-not-interactive",
			"Declaring a process is your authorisation, and there is nowhere to ask you — no terminal " +
				"here, and no surface attending this node. Run this from an interactive shell, attend " +
				`the node from a device, or write the "processes" block into ` +
				`${catalogConfigPath(root, env)} by hand — hand-editing is still a first-class path, ` +
				"and this command reads what you wrote.",
			[PROCESS_ADD_COMMAND, PROCESS_LIST_COMMAND],
		);
	}
	const operator = deps.operator ?? createStdioOperatorChannel();

	let processName: string | null = null;
	try {
		// ── 1. Which process ──────────────────────────────────────────────────────
		processName = (options.name ?? "").trim();
		if (!processName) {
			const known = processRecipeNames();
			processName = (
				await operator.ask({
					type: "text",
					question: `Qual processo? (refarm já sabe propor: ${known.join(", ")})`,
					default: known[0] ?? "",
					placeholder: known[0] ?? "meu-servico",
				})
			).trim();
		}
		if (!processName) {
			throw new ProcessAddRefusal(
				"process-add-invalid-name",
				"A process name must not be blank — it is how you will refer to it, and it becomes the " +
					"stem of the unit's filename.",
			);
		}

		// ── 2. Is something already there, or already decided? ────────────────────
		const configPath = catalogConfigPath(root, env);
		const trail =
			deps.trail ??
			createFileOperationTrail(
				catalogTrailPath(configPath),
				deps.fs ?? createNodeOperationFileSystem(),
			);
		const alreadyDeclared = readDeclaredNames(configPath).includes(processName);
		const prior = await standingCatalogDecision(trail, PROCESS_BLOCK, processName);

		if ((alreadyDeclared || prior) && !options.replace) {
			// RE-RUNNING NEVER DUPLICATES AND NEVER CLOBBERS. A catalog is keyed, so a duplicate is
			// impossible by construction; a SILENT OVERWRITE is the thing that is possible, and this
			// gate is what stops it. R4 covers the other half: a standing decision is not re-asked by
			// accident, even when the entry was later hand-removed.
			const question = alreadyDeclared
				? `Já existe um processo chamado "${processName}". Quero substituir a declaração dele?`
				: `Você já decidiu sobre "${processName}" (${prior?.decision}, em ${prior?.decidedAt}). Quero decidir de novo?`;
			const again = await operator.ask({ type: "confirm", question, default: false });
			if (!again) {
				return {
					status: "unchanged",
					process: processName,
					reason: alreadyDeclared ? "already-declared" : "already-decided",
				};
			}
		}

		// ── 3. The proposal — derived where refarm can, asked where it cannot ─────
		const invocation =
			deps.invocation === undefined
				? deriveRefarmInvocation({
						env,
						...(deps.isExecutable ? { isExecutable: deps.isExecutable } : {}),
					})
				: deps.invocation;
		const recipe = processRecipe(processName);
		const asked: string[] = [];

		let description: string;
		let command: string[];
		let workingDirectory: string | null;
		let derived: DerivedField[] = [];

		if (recipe && invocation) {
			const proposal = recipe.propose({
				root,
				env,
				invocation,
				exists,
				overrides: {
					...(portFromFlag === null ? {} : { port: portFromFlag }),
					...(options.dir ? { directory: expandHome(options.dir.trim(), env) } : {}),
				},
			});
			say(recipe.summary);
			for (const line of proposal.preflight) say(`  · ${line}`);
			say("");
			say("Isto é uma PROPOSTA. Cada valor abaixo veio de algum lugar, e está dito de onde:");
			for (const field of proposal.derived) {
				say(`  ${field.key}: ${field.value}`);
				say(`      ← ${field.source}`);
			}

			// THE "OR EDIT" HALF. A proposal you can only accept whole is a form with one field.
			const decision = await operator.ask({
				type: "select",
				question: "Uso esta proposta?",
				options: [
					{
						value: "accept",
						label: "Uso assim",
						description: "os valores acima entram na declaração exatamente como estão",
					},
					{
						value: "adjust",
						label: "Quero ajustar antes",
						description: "eu pergunto cada valor derivado, já preenchido com o que está acima",
					},
				],
				default: "accept",
			});

			let adjusted = proposal;
			if (decision === "adjust") {
				const overrides: { port?: number; directory?: string } = {
					...(portFromFlag === null ? {} : { port: portFromFlag }),
					...(options.dir ? { directory: expandHome(options.dir.trim(), env) } : {}),
				};
				for (const adjustment of proposal.adjustable) {
					const answer = (
						await operator.ask({
							type: "text",
							question: adjustment.question,
							default: adjustment.current,
						})
					).trim();
					asked.push(adjustment.key);
					const value = answer || adjustment.current;
					if (adjustment.key === "port") {
						overrides.port = parsePortAnswer(value);
					} else {
						overrides.directory = requireAbsoluteDirectory(expandHome(value, env));
					}
				}
				adjusted = recipe.propose({ root, env, invocation, exists, overrides });
			}

			description = adjusted.description;
			command = adjusted.command;
			workingDirectory = adjusted.workingDirectory;
			derived = adjusted.derived;
		} else {
			// Nothing to propose — refarm asks for everything, which is not a failure, only a
			// different conversation. A recipe would make this one shorter; its absence never makes
			// the declaration impossible, because hand-editing is the path that must never break and
			// this is the guided version of it.
			if (recipe && !invocation) {
				say(
					`Não consegui derivar como te invocar (nem REFARM_COMMAND, nem PATH, nem o processo ` +
						`atual sabem dizer). Vou perguntar o comando inteiro.`,
				);
			}
			description = (
				options.description?.trim() ||
				(await (async () => {
					asked.push("description");
					return operator.ask({
						type: "text",
						question: `Para que serve "${processName}"? (uma linha; vira a Description da unit)`,
						default: processName!,
					});
				})())
			).trim();

			command = await askForCommand({
				name: processName,
				operator,
				env,
				supplied: options.command,
				asked,
				say,
				isExecutable: deps.isExecutable,
			});

			const suppliedDirectory = options.workingDirectory?.trim();
			if (suppliedDirectory) {
				workingDirectory = requireAbsoluteDirectory(expandHome(suppliedDirectory, env));
			} else {
				asked.push("workingDirectory");
				const answer = (
					await operator.ask({
						type: "text",
						question:
							"De qual diretório ele roda? (absoluto — um supervisor começa no diretório DELE, " +
							"não onde você digitou)",
						default: root,
					})
				).trim();
				workingDirectory = requireAbsoluteDirectory(expandHome(answer || root, env));
			}
			derived = [];
		}

		// ── 4. The one thing refarm refuses to guess ──────────────────────────────
		//
		// There is no code path that fills this in. A flag replaces the QUESTION; nothing replaces
		// the ANSWER, and no branch above or below supplies a fallback.
		let restart: RestartPolicy;
		if (restartFromFlag) {
			restart = restartFromFlag;
		} else {
			asked.push("restart");
			restart = (await operator.ask(processRestartPrompt(processName))) as RestartPolicy;
			if (!(RESTART_POLICIES as readonly string[]).includes(restart)) {
				throw new ProcessAddRefusal(
					"process-add-invalid-restart",
					`"${restart}" is not a restart policy. Whether this comes back after it dies is the one ` +
						"thing refarm may not guess, so nothing was written.",
					[PROCESS_ADD_COMMAND],
				);
			}
		}

		// ── 5. The exact JSON, then the decision ──────────────────────────────────
		const entry = buildProcessEntry({
			name: processName,
			description,
			command,
			...(workingDirectory ? { workingDirectory } : {}),
			restart,
		});

		const plan: CatalogDeclarationPlan = planCatalogDeclaration({
			block: PROCESS_BLOCK,
			name: processName,
			entry,
			root,
			env,
		});

		const notes = [
			`Isto DECLARA o processo. Nada é supervisionado ainda e nenhum systemctl roda: ` +
				`\`${processInstallCommand(processName)}\` é o próximo passo, e ele também mostra o ` +
				`arquivo antes de escrever.`,
			"stopTimeoutSeconds e restartDelaySeconds ficam de fora e valem os padrões do contrato " +
				"(20s e 5s) — declare-os à mão se quiser outros.",
			...derived.map((field) => `${field.key} veio de: ${field.source}`),
		];

		const request = buildCatalogOperationRequest({
			plan,
			title: `${PROCESS_ADD_COMMAND} ${processName}`,
			purpose:
				`Declarar o processo "${processName}" (${description}) para que este host possa ` +
				`supervisioná-lo — ${restartDescription(restart)}.`,
			requester: PROCESS_ADD_COMMAND,
			requestedAt: (deps.now ?? (() => new Date().toISOString()))(),
			notes,
		});

		// R2 — the operator authorises a SPECIFIC diff, so they see all of it.
		for (const line of renderCatalogProposal(request)) say(line);

		const outcome = await authorCatalogDeclaration({
			request,
			channel: operator,
			trail,
			...(deps.fs ? { fs: deps.fs } : {}),
			...(deps.now ? { now: deps.now } : {}),
			...(deps.decidedBy ? { decidedBy: deps.decidedBy } : {}),
			host: deps.host ?? os.hostname(),
			...(prior ? { revisit: true } : {}),
		});

		if (outcome.status === "declined") {
			return { status: "declined", process: processName, recordId: outcome.record.id };
		}
		if (outcome.status !== "authorized") {
			return { status: "deferred", process: processName };
		}

		// ── 6. Verify, do not claim ───────────────────────────────────────────────
		const statuses = await (deps.verify ?? defaultVerify)(processName, root);

		return {
			status: "declared",
			process: processName,
			description,
			command,
			workingDirectory,
			restart,
			configPath: plan.configPath,
			recordId: outcome.record.id,
			undoCommand: undoCommandFor(outcome.record.id),
			replaced: plan.replaced,
			derived,
			asked,
			statuses,
			installCommand: processInstallCommand(processName),
		};
	} catch (error) {
		if (error instanceof OperatorPromptCancelledError) {
			// Cancellation SETTLES: nothing applied, nothing recorded, because the consent journey
			// writes only after an answer and every write above happens after that.
			return { status: "cancelled", process: processName };
		}
		throw error;
	}
}

// ── The command question, and the two rules it surfaces ───────────────────────

interface CommandQuestion {
	name: string;
	operator: OperatorChannel;
	env: NodeJS.ProcessEnv;
	supplied: string | undefined;
	asked: string[];
	say: (line: string) => void;
	isExecutable: ((candidate: string) => boolean) | undefined;
}

/**
 * Ask for the argv, and hold it to the two rules WHILE THE OPERATOR IS STILL TYPING.
 *
 * A shell line is met with a question, not a rejection: the operator is told what a supervisor
 * actually does with a command and asked again, with `/bin/sh -c "…"` named as the explicit way
 * to mean what they meant. A relative `command[0]` is resolved on `PATH` and the ABSOLUTE result
 * is offered for confirmation, because `command -v node` is a step refarm can take for them —
 * what it may not do is pick silently.
 */
async function askForCommand(question: CommandQuestion): Promise<string[]> {
	let attempt = 0;
	let raw = question.supplied?.trim() ?? "";
	while (true) {
		if (!raw) {
			question.asked.push("command");
			raw = (
				await question.operator.ask({
					type: "text",
					question: `Qual comando é "${question.name}"? (o executável e seus argumentos)`,
					placeholder: "/usr/bin/node /srv/app/server.js",
				})
			).trim();
		}
		attempt += 1;
		const parsed = parseCommandLine(raw);

		if (parsed.shellOperators.length > 0) {
			if (attempt >= MAX_COMMAND_ATTEMPTS) {
				throw new ProcessAddRefusal(
					"process-add-shell-command",
					`"${raw}" is a shell LINE (${parsed.shellOperators.join(" ")}), and a supervisor execs a ` +
						"program rather than handing it to a shell. Nothing was written. If you do want a " +
						'shell, say so out loud: /bin/sh -c "…" as the command.',
					[PROCESS_ADD_COMMAND],
				);
			}
			question.say(
				`  · Isso é uma linha de shell (${parsed.shellOperators.join(" ")}). Um supervisor executa ` +
					"um PROGRAMA — não existe shell ali para expandir isso.",
			);
			question.say(
				'  · Se você quer mesmo um shell, diga isso em voz alta: /bin/sh -c "…" como comando.',
			);
			raw = "";
			continue;
		}
		if (parsed.argv.length === 0) {
			if (attempt >= MAX_COMMAND_ATTEMPTS) {
				throw new ProcessAddRefusal(
					"process-add-empty-command",
					"A process with no command is not a process. Nothing was written.",
					[PROCESS_ADD_COMMAND],
				);
			}
			raw = "";
			continue;
		}

		const head = expandHome(parsed.argv[0]!, question.env);
		if (isAbsolute(head)) return [head, ...parsed.argv.slice(1)];

		const resolved = resolveOnPath(head, question.env, question.isExecutable);
		if (!resolved) {
			throw new ProcessAddRefusal(
				"process-add-relative-command",
				`command[0] must be an ABSOLUTE path — a supervisor does not search PATH — and I could ` +
					`not find "${head}" on yours either. \`command -v ${head}\` prints the path to use. ` +
					"Nothing was written.",
				[PROCESS_ADD_COMMAND],
			);
		}
		question.asked.push("command[0]");
		const accepted = await question.operator.ask({
			type: "confirm",
			question: `"${head}" está em ${resolved}. Uso esse caminho absoluto? (um supervisor não procura no PATH)`,
			default: true,
		});
		if (accepted) return [resolved, ...parsed.argv.slice(1)];
		raw = "";
		if (attempt >= MAX_COMMAND_ATTEMPTS) {
			throw new ProcessAddRefusal(
				"process-add-relative-command",
				`command[0] must be an ABSOLUTE path, and "${head}" is not one. \`command -v ${head}\` ` +
					"prints the path to use. Nothing was written.",
				[PROCESS_ADD_COMMAND],
			);
		}
	}
}

// ── Small pure helpers ────────────────────────────────────────────────────────

function restartDescription(restart: RestartPolicy): string {
	switch (restart) {
		case "always":
			return "volta sozinho depois de qualquer saída";
		case "on-failure":
			return "volta sozinho só quando termina mal";
		case "never":
			return "não volta sozinho";
	}
}

function parsePortFlag(raw: string | undefined): number | null {
	if (raw === undefined) return null;
	return parsePortAnswer(raw);
}

function parsePortAnswer(raw: string): number {
	const port = Number.parseInt(raw.trim(), 10);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new ProcessAddRefusal(
			"process-add-invalid-port",
			`A port must be a whole number between 1 and 65535 (got ${JSON.stringify(raw)}).`,
			[`${PROCESS_ADD_COMMAND} --help`],
		);
	}
	return port;
}

function requireAbsoluteDirectory(value: string): string {
	if (!isAbsolute(value)) {
		throw new ProcessAddRefusal(
			"process-add-relative-directory",
			`"${value}" is not an absolute path. A supervisor starts a process from its OWN directory, ` +
				"not from wherever you happened to type the command, so a relative path here means " +
				"something different every time. Nothing was written.",
			[PROCESS_ADD_COMMAND],
		);
	}
	return value;
}

/** The names already declared, read from EXACTLY what is on disk — the same file the wizard
 *  writes, so a hand-written block is seen, not overwritten. */
function readDeclaredNames(configPath: string): string[] {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		return [...parseProcessCatalog(parsed).keys()];
	} catch {
		// Missing, unparseable, or a malformed `processes` block: `planCatalogDeclaration` refuses
		// an unreadable config with a better message than this gate could, so nothing is claimed here.
		return [];
	}
}
