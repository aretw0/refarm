/**
 * EVERY NEXT STEP THIS CLI PRINTS MUST BE EXECUTABLE AS PRINTED.
 *
 * `refarm cert issue` finished, correctly identified its own next step, and told the operator:
 *
 *     Each device that will open the page must trust the CA first:
 *       refarm cert trust
 *
 * That step needs root — it writes into `/usr/local/share/ca-certificates`. So the operator ran
 * `sudo -E refarm cert trust` and got `sudo: refarm: comando não encontrado`. The launcher lives
 * in `~/.local/bin`, and `sudo` replaces `PATH` with `secure_path`, which omits per-user bin
 * directories. Nothing was broken: the install was right, sudoers was right, the operator was
 * right. The BUG is that a command which knew its next step needs `sudo` printed a bare `refarm`.
 *
 * This is the second failure of that shape in one day. The other: the browser surface shipped and
 * could not work, because `/attend` calls `crypto.subtle` and `crypto.subtle` refuses to exist
 * outside a secure context. Neither is a logic error. Both are ENVIRONMENT TRUTHS — facts about
 * the machine the guidance will land on. The suite tests logic exhaustively; nothing tested
 * situation, which is why both shipped green.
 *
 * ── The contract ────────────────────────────────────────────────────────────────────────────
 * A `nextCommand` / `nextCommands` / `nextAction` — or any line of printed guidance — that names
 * a refarm invocation must:
 *   1. RESOLVE — the head token is something a shell would actually find from where that step
 *      will run (see "reachability, without executing anything" below);
 *   2. EXIST — the subcommand path it names is a command `program` actually has, and the options
 *      it passes are options that command actually declares;
 *   3. CARRY AN ABSOLUTE PATH WHEN PRIVILEGED — when the printed text says `sudo`, or the step is
 *      declared privileged in `src/privileged-steps.ts`, the binary must be named by absolute
 *      path, because `secure_path` drops `~/.local/bin`;
 *   4. DERIVE that path, never hardcode it — a literal `/home/<someone>` is right on exactly one
 *      machine.
 *
 * ── Reachability, without executing anything ────────────────────────────────────────────────
 * NOTHING HERE RUNS AN EMITTED COMMAND. Not in a sandbox, not with `--dry-run`, not at all: half
 * of what is checked is privileged, and a harness that proves `sudo cert trust` works by running
 * it has installed a CA on the operator's machine to make a test green.
 *
 * Reachability is proven by doing what the shell's own `execvp` does BEFORE it executes — the
 * lookup, and only the lookup:
 *   · a bare name is resolved by walking `PATH` entry by entry and `stat`-ing `<dir>/<name>` for a
 *     regular file with an executable bit. That is `execvp`'s search, minus the `exec`. It answers
 *     "would a shell find this?" without a process ever being created.
 *   · an absolute path needs no search at all — that is the whole point of requiring one for a
 *     privileged step — so it is checked for shape, and `stat`-ed when it happens to exist here.
 *   · "from where that step will run" is the part that matters: for a privileged step the search
 *     is NOT the caller's `PATH` but `secure_path`, modelled by `SUDO_SECURE_PATH_MODEL`. The test
 *     does not read the local `/etc/sudoers` (unreadable without root, and a machine-specific
 *     answer would make this suite non-deterministic); it uses the documented distribution default
 *     and asserts the one property the rule rests on — that a per-user bin directory is not in it.
 *
 * The deterministic core never touches the filesystem for its verdict: a bare name is proven to be
 * the `bin` key `package.json` declares, which is the name a shell finds WHEREVER the package is
 * installed. The PATH walk runs on top of that as confirmation when this machine happens to have
 * refarm installed, and is skipped — reported, not silently passed — when it does not.
 *
 * ── Placeholder or broken? ──────────────────────────────────────────────────────────────────
 * `refarm auth enroll <label>` is legitimate: `<label>` is a value only the operator can supply.
 * `refarm auth enrol <label>` is broken, and so is `refarm <thing> status`. Banning `<…>` outright
 * would lose the first; allowing it outright would keep the other two. The distinction is
 * POSITIONAL, and `program` already knows it:
 *   · walk the tokens down the command tree; a placeholder is legitimate exactly where the command
 *     reached declares a positional ARGUMENT to receive it (Commander's `registeredArguments`);
 *   · a placeholder standing where a SUBCOMMAND NAME belongs — a group with children and no action
 *     of its own — is broken, because no value the operator types makes it resolve.
 * A misspelled subcommand is caught by the same walk, from the opposite side: it is not a
 * placeholder and not a child name, so it names nothing.
 *
 * ── Discovery ───────────────────────────────────────────────────────────────────────────────
 * Following `cli-refusal-conformance.test.ts`: the valid surface comes from `program` itself,
 * walked recursively — never a hand-maintained list, which is exactly what fails to catch the NEXT
 * command. The candidates come from the source of `apps/refarm/src`, so a handoff is checked
 * whether it is reached by a probe or not.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Command } from "commander";
import {
	isAbsoluteCommandPath,
	privilegedApplicationCommand,
	SUDO_SECURE_PATH_MODEL,
} from "@refarm.dev/cli/command-handoff";
import { REFARM_BINARY } from "../../src/brand.js";
import { PRIVILEGED_STEPS, privilegedStepKey } from "../../src/privileged-steps.js";
import { program } from "../../src/program.js";

const APP_ROOT = path.resolve(__dirname, "../..");
const APP_SRC_DIR = path.join(APP_ROOT, "src");
const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/executable-guidance");

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE COMMAND TREE — the authority on what exists.
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface CommandNode {
	name: string;
	children: Map<string, CommandNode>;
	/** Long and short flags this command declares, and whether each takes a value. */
	options: Map<string, { takesValue: boolean }>;
	/** Positional arguments this command declares. */
	argumentCount: number;
	hasAction: boolean;
}

function commandArgumentCount(command: Command): number {
	const withInternals = command as unknown as {
		registeredArguments?: unknown[];
		_args?: unknown[];
	};
	return (withInternals.registeredArguments ?? withInternals._args ?? []).length;
}

function hasActionHandler(command: Command): boolean {
	return typeof (command as unknown as { _actionHandler?: unknown })._actionHandler === "function";
}

/** The program, as a tree this file can ask questions of. Recursive, from `program` itself —
 *  a command added to `program.ts` is validated against on the next run, for free. */
export function buildCommandTree(root: Command): CommandNode {
	const options = new Map<string, { takesValue: boolean }>();
	for (const option of root.options) {
		const takesValue = Boolean(option.required || option.optional);
		if (option.long) options.set(option.long, { takesValue });
		if (option.short) options.set(option.short, { takesValue });
	}
	// Commander answers these on every command whether or not they were declared.
	options.set("--help", { takesValue: false });
	options.set("-h", { takesValue: false });
	return {
		name: root.name(),
		children: new Map(root.commands.map((child) => [child.name(), buildCommandTree(child)])),
		options,
		argumentCount: commandArgumentCount(root),
		hasAction: hasActionHandler(root),
	};
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RESOLUTION — the shell's lookup, stopped one step short of `exec`.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** `execvp`'s search, minus the `exec`: walk the search path and `stat` each candidate for a
 *  regular file with an executable bit. Returns where a shell WOULD find it, or `null`.
 *  No process is created; nothing is run. */
export function resolveOnSearchPath(name: string, searchPath: readonly string[]): string | null {
	if (name.includes("/") || name.includes("\\")) return null;
	for (const directory of searchPath) {
		if (!directory) continue;
		const candidate = path.join(directory, name);
		const stats = statSync(candidate, { throwIfNoEntry: false });
		if (stats?.isFile() && (stats.mode & 0o111) !== 0) return candidate;
	}
	return null;
}

function callerSearchPath(): string[] {
	return (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
}

/** The `bin` names this package installs — the names a shell finds wherever it is installed.
 *  This is the deterministic half of the reachability proof: it does not depend on whether this
 *  particular machine has the CLI on its PATH. */
function declaredBinaryNames(): string[] {
	const manifest = JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8")) as {
		bin?: string | Record<string, string>;
	};
	if (typeof manifest.bin === "string") return [path.basename(APP_ROOT)];
	return Object.keys(manifest.bin ?? {});
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// HARVEST — every printed refarm invocation in the app source.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type GuidanceOrigin = "handoff" | "printed-text";

export interface GuidanceCandidate {
	file: string;
	line: number;
	origin: GuidanceOrigin;
	/** The invocation as it would reach the operator. */
	raw: string;
	/** The binary as named: a bare name, or a path. */
	head: string;
	/** Everything after the binary. */
	tokens: string[];
	/** The printed text puts `sudo` in front of this. */
	sudoInText: boolean;
}

/**
 * Read a printed line the way a shell reads it, to the point of knowing WHICH FILE would be
 * executed — and no further.
 *
 * `sudo` and its own flags are consumed first (they are not the command). What follows is the
 * binary, unless it is an INTERPRETER, in which case the thing being named is the script it is
 * pointed at: `sudo -E /usr/bin/node --import <hook> /opt/refarm/index.js cert trust` names
 * `/opt/refarm/index.js`, and `cert trust` is the invocation. Getting this right is what lets the
 * privileged form be checked as an invocation rather than waved through as an opaque path.
 */
export function parseInvocation(
	text: string,
): { head: string; tokens: string[]; sudoInText: boolean } | null {
	const trimmed = text.trim();
	const sudo = /^sudo(?:\s+-\S+)*\s+/.exec(trimmed);
	const parts = (sudo ? trimmed.slice(sudo[0].length) : trimmed).split(/\s+/).filter(Boolean);
	if (parts.length === 0) return null;
	let head = parts[0]!;
	let rest = parts.slice(1);

	if (isAbsoluteCommandPath(head) && /^node(\.exe)?$/.test(path.basename(head))) {
		let index = 0;
		while (index < rest.length && rest[index]!.startsWith("-")) {
			const flag = rest[index]!;
			index += 1;
			// The separated form of a Node flag (`--import <hook>`) carries its value next.
			if (!flag.includes("=") && index < rest.length && !rest[index]!.startsWith("-")) index += 1;
		}
		const script = rest[index];
		if (script === undefined) return null;
		head = script;
		rest = rest.slice(index + 1);
	}

	return { head, tokens: rest, sudoInText: Boolean(sudo) };
}

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const filePath = path.join(dir, entry);
		if (statSync(filePath).isDirectory()) {
			files.push(...sourceFiles(filePath));
			continue;
		}
		if (/\.[cm]?ts$/.test(entry) && !/\.test\.[cm]?ts$/.test(entry)) files.push(filePath);
	}
	return files;
}

/** Comment lines are documentation, not guidance: they never reach an operator, and prose about a
 *  command ("see `refarm cert trust`") would otherwise be parsed as an emission. Whole-line
 *  comments and block-comment bodies are dropped; code lines are kept intact. */
function withoutComments(source: string): string[] {
	const lines = source.split("\n");
	let inBlock = false;
	return lines.map((line) => {
		const trimmed = line.trim();
		if (inBlock) {
			if (trimmed.includes("*/")) inBlock = false;
			return "";
		}
		if (trimmed.startsWith("/*")) {
			if (!trimmed.includes("*/")) inBlock = true;
			return "";
		}
		if (trimmed.startsWith("//") || trimmed.startsWith("*")) return "";
		return line;
	});
}

function stringLiteralsIn(text: string): string[] {
	return [...text.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((match) => match[2] ?? "");
}

/** Source escapes back to the characters the operator sees: `\`` in a template literal is a
 *  backtick on their terminal, and the backtick is what marks an instruction. */
function unescapeLiteral(value: string): string {
	return value.replace(/\\(.)/g, "$1");
}

/**
 * Does this read as an invocation of the CLI, rather than a sentence that mentions it?
 *
 * The `<command>: <what went wrong>` convention this repo uses for refusal messages
 * ("refarm cert issue: --cert-file and --key-file go together") begins with a real invocation and
 * is not one — a token ending in a colon is punctuation, and no argument ever looks like that.
 * A URL keeps its colon inside the token (`https://…`), so it is untouched.
 */
function looksLikeInvocation(text: string): boolean {
	const trimmed = text.trim();
	return (
		!trimmed.includes("${") &&
		!/\S:(?:\s|$)/.test(trimmed) &&
		new RegExp(`^(?:sudo(?:\\s+-\\S+)*\\s+)?(?:[\\w.~/-]*/)?${REFARM_BINARY}(?:\\s|$)`).test(
			trimmed,
		)
	);
}

/**
 * FIELDS THAT NAME A COMMAND WITHOUT INSTRUCTING ANYONE TO RUN IT — a debt kept short and
 * explained, in the shape `cli-refusal-conformance.test.ts` uses for its exclusions.
 *
 * `requester` is provenance: it is written into the durable operation trail
 * (`.refarm/tls/operations.json`) to record WHICH COMMAND asked for a change, and it is compared
 * across runs and across machines. Rendering it as this machine's interpreter and entrypoint
 * would put a path that is true nowhere else into a record meant to outlive the process — the
 * stable canonical name is the correct value there, and the absolute-path rule must not reach it.
 */
const PROVENANCE_FIELDS = ["requester"] as const;

function isProvenanceValue(lineBeforeLiteral: string): boolean {
	return PROVENANCE_FIELDS.some((field) =>
		new RegExp(`(?:^|[\\s{,(])${field}\\s*:\\s*$`).test(lineBeforeLiteral),
	);
}

/** Every element of an array literal, as a string — or `null` when even one of them is something
 *  static reading cannot answer for (a parameter, a property access, a call). All or nothing. */
function resolveArrayElements(inner: string, strings: Map<string, string>): string[] | null {
	const elements = inner
		.split(",")
		.map((element) => element.trim())
		.filter((element) => element.length > 0);
	if (elements.length === 0) return null;
	const resolved: string[] = [];
	for (const element of elements) {
		const literal = /^(['"])((?:\\.|(?!\1)[^\\])*)\1$/.exec(element);
		if (literal) {
			resolved.push(unescapeLiteral(literal[2] ?? ""));
			continue;
		}
		const known = strings.get(element);
		if (known === undefined) return null;
		resolved.push(known);
	}
	return resolved;
}

/** `refarmCommand([...])` / `refarmPrivilegedCommand([...])` with a literal array, plus the
 *  same calls given a module-level `const NAME = [...]` declared in the same file. Between them
 *  these cover the structured handoffs; what is left is built from a caller's argv, which no
 *  static reading can resolve and which the printed-text harvest catches at the point it is
 *  written down. */
function harvestHandoffs(file: string, lines: string[]): GuidanceCandidate[] {
	const source = lines.join("\n");
	/** `const HEALTH = "health"` — a single token spelled once and reused. */
	const strings = new Map<string, string>();
	for (const match of source.matchAll(
		/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(['"])((?:\\.|(?!\2)[^\\])*)\2\s*;/g,
	)) {
		strings.set(match[1]!, unescapeLiteral(match[3] ?? ""));
	}
	/** `const START_COMMAND_ARGS = ["discover", "announce"]` — a whole argv spelled once. */
	const arrays = new Map<string, string[]>();
	for (const match of source.matchAll(
		/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*\[([^\][]*)\]/g,
	)) {
		const values = resolveArrayElements(match[2] ?? "", strings);
		if (values) arrays.set(match[1]!, values);
	}

	const found: GuidanceCandidate[] = [];
	const callPattern = /\b(refarmCommand|refarmPrivilegedCommand)\(\s*(\[[^\][]*\]|[A-Za-z_$][\w$]*)/g;
	for (const match of source.matchAll(callPattern)) {
		const argument = match[2]!;
		const args = argument.startsWith("[")
			? resolveArrayElements(argument.slice(1, -1), strings)
			: (arrays.get(argument) ?? null);
		// UNRESOLVED, NOT ASSUMED. An argv built from a caller's variable cannot be read here, and
		// dropping the parts that could be read would manufacture a different command than the one
		// the emitter builds — `refarmCommand([HEALTH, "policy"])` read as `refarm policy` is a
		// harness bug reported as a product bug. Those sites are skipped, and the printed-text
		// harvest catches the guidance wherever it is actually written down.
		if (!args || args.length === 0) continue;
		// RENDER, then read back. The candidate is what the helper actually produces — so a
		// regression that makes the privileged helper emit a bare binary fails here, rather than
		// being assumed away by a harness that trusted the call site's name.
		const raw =
			match[1] === "refarmPrivilegedCommand"
				? privilegedApplicationCommand(REFARM_BINARY, args, {
						execPath: "/usr/bin/node",
						execArgv: ["--import", "file:///opt/refarm/hook.mjs"],
						entrypoint: "/opt/refarm/index.js",
					})
				: [REFARM_BINARY, ...args].join(" ");
		const parsed = parseInvocation(raw);
		if (!parsed) continue;
		found.push({
			file,
			line: source.slice(0, match.index).split("\n").length,
			origin: "handoff",
			raw,
			...parsed,
		});
	}
	return found;
}

/** Anything printed that reads as a refarm invocation: help text, refusal hints, the plain-language
 *  step beside a JSON handoff. This is the surface the `cert issue` bug lived on — the JSON was
 *  never the thing the operator typed. */
function harvestPrintedText(file: string, lines: string[]): GuidanceCandidate[] {
	const found: GuidanceCandidate[] = [];
	lines.forEach((line, index) => {
		let cursor = 0;
		for (const literal of stringLiteralsIn(line)) {
			const at = line.indexOf(literal, cursor);
			cursor = at >= 0 ? at + literal.length : cursor;
			if (at >= 0 && isProvenanceValue(line.slice(0, Math.max(0, at - 1)))) continue;
			for (const raw of instructionsIn(unescapeLiteral(literal))) {
				const parsed = parseInvocation(raw);
				if (!parsed || parsed.tokens.length === 0) continue;
				found.push({ file, line: index + 1, origin: "printed-text", raw, ...parsed });
			}
		}
	});
	return found;
}

/**
 * THE LINE BETWEEN AN INSTRUCTION AND A SENTENCE ABOUT A COMMAND.
 *
 * "Use refarm task for dispatch/retry/cancel operations." mentions a command; nobody is meant to
 * type it, and reading its words as arguments turns English into a violation report. Three forms
 * ARE instructions, and each is marked as such by the emitter itself:
 *   · the whole literal is the invocation (`"  refarm cert trust"`);
 *   · it is enclosed in backticks inside prose (``Re-run as `sudo -E refarm cert trust`.``) — the
 *     convention this repo already uses for "type this";
 *   · it follows a `$ ` shell prompt in help text, where two or more spaces end the command and
 *     begin its description.
 */
function instructionsIn(literal: string): string[] {
	const found: string[] = [];
	const whole = literal.trim();
	const prompt = /^\$\s+(.+)$/.exec(whole);
	if (prompt) {
		const command = prompt[1]!.split(/\s{2,}/)[0]!.trim();
		if (looksLikeInvocation(command)) found.push(command);
	} else if (looksLikeInvocation(whole)) {
		found.push(whole);
	}
	for (const match of literal.matchAll(/`([^`]+)`/g)) {
		const inner = match[1]!.trim();
		if (looksLikeInvocation(inner)) found.push(inner);
	}
	return found;
}

export function harvestGuidance(files: readonly string[]): GuidanceCandidate[] {
	return files.flatMap((file) => {
		const lines = withoutComments(readFileSync(file, "utf8"));
		const relative = path.relative(APP_ROOT, file);
		return [...harvestHandoffs(relative, lines), ...harvestPrintedText(relative, lines)];
	});
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE AUDIT.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type ViolationCode =
	| "unknown-subcommand"
	| "placeholder-in-subcommand-position"
	| "undeclared-option"
	| "privileged-without-absolute-path"
	| "hardcoded-home-path"
	| "unreachable-binary";

export interface Violation {
	code: ViolationCode;
	where: string;
	raw: string;
	detail: string;
}

const PLACEHOLDER = /^<[^<>]+>$/;

/** Walk the tokens down the tree. Returns the argv path actually resolved (used to look the step
 *  up in the privileged registry) and whatever did not resolve. */
function walkInvocation(
	candidate: GuidanceCandidate,
	tree: CommandNode,
): { argvPath: string[]; violations: Violation[] } {
	const where = `${candidate.file}:${candidate.line}`;
	const violations: Violation[] = [];
	const argvPath: string[] = [];
	let node = tree;
	let argumentsSeen = 0;
	let index = 0;

	for (; index < candidate.tokens.length; index += 1) {
		const token = candidate.tokens[index]!;
		if (token.startsWith("-")) break;

		if (PLACEHOLDER.test(token)) {
			// Legitimate exactly where the command reached declares a positional to receive it.
			if (node.argumentCount > argumentsSeen) {
				argumentsSeen += 1;
				continue;
			}
			violations.push({
				code: "placeholder-in-subcommand-position",
				where,
				raw: candidate.raw,
				detail:
					`\`${token}\` stands where a subcommand name belongs — \`${["refarm", ...argvPath].join(" ")}\` ` +
					`declares ${node.argumentCount} positional argument(s) and ${node.children.size} subcommand(s), so no ` +
					`value the operator types makes this resolve.`,
			});
			break;
		}

		const child = node.children.get(token);
		if (child) {
			node = child;
			argvPath.push(token);
			argumentsSeen = 0;
			continue;
		}

		if (node.argumentCount > argumentsSeen) {
			// A value for a declared positional.
			argumentsSeen += 1;
			continue;
		}

		if (node.hasAction) {
			// The command is complete and takes no more; the rest is prose around it.
			break;
		}

		violations.push({
			code: "unknown-subcommand",
			where,
			raw: candidate.raw,
			detail:
				`\`${["refarm", ...argvPath, token].join(" ")}\` names nothing: \`${["refarm", ...argvPath].join(" ")}\` ` +
				`has no subcommand \`${token}\` (it has: ${[...node.children.keys()].join(", ") || "none"}) and no action of its own.`,
		});
		break;
	}

	// Options are enforced on structured handoffs only. Printed text runs into prose after the
	// command ends, and a sentence is not an option list.
	if (candidate.origin === "handoff") {
		for (; index < candidate.tokens.length; index += 1) {
			const token = candidate.tokens[index]!;
			if (!token.startsWith("-")) continue;
			const flag = token.split("=")[0]!;
			const declared = node.options.get(flag);
			if (!declared) {
				violations.push({
					code: "undeclared-option",
					where,
					raw: candidate.raw,
					detail: `\`${["refarm", ...argvPath].join(" ")}\` declares no option \`${flag}\`.`,
				});
				continue;
			}
			if (declared.takesValue && !token.includes("=")) index += 1;
		}
	}

	return { argvPath, violations };
}

export interface AuditInput {
	candidates: readonly GuidanceCandidate[];
	tree: CommandNode;
	privilegedSteps: Readonly<Record<string, string>>;
	/** The names a shell finds wherever this package is installed. */
	binaryNames: readonly string[];
	/** Raw source, per file, so a hardcoded home can be spotted at the emitter. */
	sourceOf?: (file: string) => string;
}

export function auditGuidance(input: AuditInput): Violation[] {
	const violations: Violation[] = [];
	for (const candidate of input.candidates) {
		const where = `${candidate.file}:${candidate.line}`;
		const { argvPath, violations: walkViolations } = walkInvocation(candidate, input.tree);
		violations.push(...walkViolations);

		const absolute = isAbsoluteCommandPath(candidate.head);
		const bare = input.binaryNames.includes(candidate.head);

		// 1. Does the head name something a shell can find at all?
		if (!absolute && !bare) {
			violations.push({
				code: "unreachable-binary",
				where,
				raw: candidate.raw,
				detail:
					`\`${candidate.head}\` is neither an absolute path nor a binary this package installs ` +
					`(${input.binaryNames.join(", ")}), so no PATH walk can find it.`,
			});
			continue;
		}

		// 2. Privileged? Then a bare name is not enough, wherever it is on the caller's PATH.
		const privilegedReason =
			input.privilegedSteps[privilegedStepKey(argvPath)] ??
			(candidate.sudoInText ? "the printed text runs this under `sudo`" : null);
		if (privilegedReason && !absolute) {
			violations.push({
				code: "privileged-without-absolute-path",
				where,
				raw: candidate.raw,
				detail:
					`this step runs as root — ${privilegedReason} — and names the binary as \`${candidate.head}\`. ` +
					`sudo replaces PATH with secure_path (${SUDO_SECURE_PATH_MODEL.join(":")}), which omits ` +
					`~/.local/bin, so the operator gets \`sudo: ${candidate.head}: command not found\`. ` +
					`Emit it through refarmPrivilegedCommand().`,
			});
		}

		// 3. An absolute path must be derived from the running process, never written down.
		if (absolute && input.sourceOf) {
			const line = input.sourceOf(candidate.file).split("\n")[candidate.line - 1] ?? "";
			if (/(["'`])[^"'`]*(?:\/home\/|\/Users\/|\/root\/)/.test(line)) {
				violations.push({
					code: "hardcoded-home-path",
					where,
					raw: candidate.raw,
					detail:
						"the absolute path is a literal home directory. It is right on exactly one machine — " +
						"derive it from process.execPath / process.argv[1] instead.",
				});
			}
		}
	}
	return violations;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────

const TREE = buildCommandTree(program);
const BINARY_NAMES = declaredBinaryNames();
const APP_FILES = sourceFiles(APP_SRC_DIR);
const CANDIDATES = harvestGuidance(APP_FILES);

/** The emitter's own source line, for the checks that need to see how a value was written.
 *  Synthetic candidates in this file name no real file; they get an empty line, not a crash. */
function readAppSource(file: string): string {
	const full = path.join(APP_ROOT, file);
	return statSync(full, { throwIfNoEntry: false })?.isFile() ? readFileSync(full, "utf8") : "";
}

function auditApp(candidates: readonly GuidanceCandidate[] = CANDIDATES): Violation[] {
	return auditGuidance({
		candidates,
		tree: TREE,
		privilegedSteps: PRIVILEGED_STEPS,
		binaryNames: BINARY_NAMES,
		sourceOf: readAppSource,
	});
}

function format(violations: readonly Violation[]): string[] {
	return violations.map((violation) => `${violation.where} [${violation.code}] ${violation.raw} — ${violation.detail}`);
}

describe("executable guidance conformance", () => {
	it("harvests the emitters it claims to cover", () => {
		// A harness that silently harvests nothing is the failure mode that matters most here: it
		// would report a clean run forever, and every rule below would be theatre. Pin the floor.
		// At the time of writing: 198 source files, 176 structured handoffs, 223 printed
		// instructions, 281 distinct invocations, across 67 files that emit guidance.
		expect(APP_FILES.length).toBeGreaterThan(150);
		expect(CANDIDATES.filter((entry) => entry.origin === "handoff").length).toBeGreaterThan(150);
		expect(CANDIDATES.filter((entry) => entry.origin === "printed-text").length).toBeGreaterThan(
			150,
		);
		expect(new Set(CANDIDATES.map((entry) => entry.file)).size).toBeGreaterThan(50);
		// The step this harness was written for is in the harvest, from both directions.
		const certTrust = CANDIDATES.filter((entry) =>
			entry.tokens.join(" ").startsWith("cert trust"),
		);
		expect(certTrust.length).toBeGreaterThan(0);
		expect(certTrust.every((entry) => isAbsoluteCommandPath(entry.head))).toBe(true);
	});

	it("resolves the CLI the way a shell would, without executing it", () => {
		// The lookup, and only the lookup. `resolveOnSearchPath` stats candidates; it never spawns.
		const found = resolveOnSearchPath(REFARM_BINARY, callerSearchPath());
		if (found === null) {
			// Not installed on this machine (a clean CI runner). The deterministic proof stands on
			// its own: the emitted name is the `bin` key, which is what gets installed.
			expect(BINARY_NAMES).toContain(REFARM_BINARY);
			return;
		}
		expect(path.isAbsolute(found)).toBe(true);
		expect(path.basename(found)).toBe(REFARM_BINARY);
	});

	it("models sudo's search path as one that omits a per-user bin directory", () => {
		// The environment truth the whole privileged rule rests on. If this ever stops holding,
		// the rule below is over-strict and should be revisited rather than worked around.
		for (const directory of SUDO_SECURE_PATH_MODEL) {
			expect(directory.startsWith("/usr") || directory === "/bin" || directory === "/sbin").toBe(
				true,
			);
		}
		expect(SUDO_SECURE_PATH_MODEL).not.toContain("/home");
		expect(
			SUDO_SECURE_PATH_MODEL.some((directory) => directory.includes(".local")),
		).toBe(false);
		expect(resolveOnSearchPath(REFARM_BINARY, SUDO_SECURE_PATH_MODEL)).toBeNull();
	});

	it("keeps the privileged registry pointing at commands that exist", () => {
		const orphans = Object.keys(PRIVILEGED_STEPS).filter((key) => {
			let node: CommandNode | undefined = TREE;
			for (const token of key.split(" ")) node = node?.children.get(token);
			return node === undefined;
		});
		expect(orphans).toEqual([]);
		// Non-vacuous: the step that produced this harness is in it.
		expect(Object.keys(PRIVILEGED_STEPS)).toContain("cert trust");
	});

	it("accepts a placeholder standing in a declared argument position", () => {
		const violations = auditApp([
			{
				file: "fixture.ts",
				line: 1,
				origin: "handoff",
				raw: "refarm auth enroll <label>",
				head: REFARM_BINARY,
				tokens: ["auth", "enroll", "<label>"],
				sudoInText: false,
			},
		]);
		expect(format(violations)).toEqual([]);
	});

	it("tells a placeholder apart from a broken command", () => {
		const codes = auditApp([
			{
				file: "fixture.ts",
				line: 1,
				origin: "handoff",
				raw: "refarm <thing> status",
				head: REFARM_BINARY,
				tokens: ["<thing>", "status"],
				sudoInText: false,
			},
			{
				file: "fixture.ts",
				line: 2,
				origin: "handoff",
				raw: "refarm cert trustt",
				head: REFARM_BINARY,
				tokens: ["cert", "trustt"],
				sudoInText: false,
			},
		]).map((violation) => violation.code);
		expect(codes).toEqual(["placeholder-in-subcommand-position", "unknown-subcommand"]);
	});

	it("rejects an option the command does not declare", () => {
		const violations = auditApp([
			{
				file: "fixture.ts",
				line: 1,
				origin: "handoff",
				raw: "refarm health --next-actions --json",
				head: REFARM_BINARY,
				tokens: ["health", "--next-actions", "--json"],
				sudoInText: false,
			},
		]);
		expect(violations.map((violation) => violation.code)).toEqual(["undeclared-option"]);
		expect(
			auditApp([
				{
					file: "fixture.ts",
					line: 1,
					origin: "handoff",
					raw: "refarm health --next-action --json",
					head: REFARM_BINARY,
					tokens: ["health", "--next-action", "--json"],
					sudoInText: false,
				},
			]),
		).toEqual([]);
	});

	it("rejects a privileged step that does not carry an absolute path", () => {
		const violations = auditApp([
			{
				file: "fixture.ts",
				line: 1,
				origin: "printed-text",
				raw: "refarm cert trust",
				head: REFARM_BINARY,
				tokens: ["cert", "trust"],
				sudoInText: false,
			},
			{
				file: "fixture.ts",
				line: 2,
				origin: "printed-text",
				raw: "sudo -E refarm cert trust",
				head: REFARM_BINARY,
				tokens: ["cert", "trust"],
				sudoInText: true,
			},
		]);
		expect(violations.map((violation) => violation.code)).toEqual([
			"privileged-without-absolute-path",
			"privileged-without-absolute-path",
		]);
		// …and the same step, emitted through the helper, passes.
		expect(
			auditApp([
				{
					file: "fixture.ts",
					line: 1,
					origin: "printed-text",
					raw: "sudo -E /usr/bin/node /opt/refarm/index.js cert trust",
					head: "/opt/refarm/index.js",
					tokens: ["cert", "trust"],
					sudoInText: true,
				},
			]),
		).toEqual([]);
	});

	it("rejects an absolute path that was written down instead of derived", () => {
		const codes = auditGuidance({
			candidates: [
				{
					file: "hardcoded.ts",
					line: 1,
					origin: "printed-text",
					raw: "sudo -E /home/op/.local/bin/refarm cert trust",
					head: "/home/op/.local/bin/refarm",
					tokens: ["cert", "trust"],
					sudoInText: true,
				},
			],
			tree: TREE,
			privilegedSteps: PRIVILEGED_STEPS,
			binaryNames: BINARY_NAMES,
			sourceOf: () => 'const CERT = "sudo -E /home/op/.local/bin/refarm cert trust";',
		}).map((violation) => violation.code);
		expect(codes).toEqual(["hardcoded-home-path"]);
	});

	it("goes red on a deliberately-broken fixture emitter", () => {
		// The harness proving itself against a file written to fail — the emitter equivalent of a
		// mutation test, kept in the tree so the proof survives this session.
		const fixtures = sourceFiles(FIXTURE_DIR);
		expect(fixtures.length).toBeGreaterThan(0);
		const violations = auditGuidance({
			candidates: harvestGuidance(fixtures),
			tree: TREE,
			privilegedSteps: PRIVILEGED_STEPS,
			binaryNames: BINARY_NAMES,
			sourceOf: readAppSource,
		});
		expect([...new Set(violations.map((violation) => violation.code))].sort()).toEqual([
			"placeholder-in-subcommand-position",
			"privileged-without-absolute-path",
			"undeclared-option",
			"unknown-subcommand",
		]);
	});

	it("emits only next steps that are executable as printed", () => {
		expect(format(auditApp())).toEqual([]);
	});
});
