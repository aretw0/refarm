#!/usr/bin/env node
/**
 * `pnpm run scaffold:capability <name> [flags]` — generate a CapabilityDescriptor declared ONCE plus the
 * cross-surface test that proves its derived schema validates the SAME on every surface (validator, CLI/TUI
 * dispatch, HTTP 422, agent tool schema). Turns the proven invariant into a repeatable generator so every
 * new capability is born with cross-surface coverage. Thin wrapper over
 * `@refarm.dev/capabilities/scaffold`'s pure `buildCapabilityScaffold`.
 *
 * Usage:
 *   pnpm run scaffold:capability search --dir examples/devbench-t1/src \
 *     --arg query:string:required --option limit:integer --option order:string:enum=asc,desc
 *
 * Flags:
 *   --dir <path>        where to write <name>.ts + <name>.test.ts (default: cwd)
 *   --summary <text>    one-line summary
 *   --arg <spec>        positional arg — name[:type][:required]     (type: string|number|integer|boolean|array)
 *   --option <spec>     --flag option — name:kind[:enum=a,b,c]      (kind: boolean|string|string[]|number|integer)
 *
 * The argument parser (parseScaffoldArgs) is pure + exported so it is unit-tested
 * (scaffold-capability.test.mjs) without touching the filesystem.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ARG_TYPES = new Set(["string", "number", "integer", "boolean", "array"]);
const OPTION_KINDS = new Set(["boolean", "string", "string[]", "number", "integer"]);

/** Parse `name[:type][:required]` into a CapabilityArgSpec. */
function parseArg(spec) {
	const [name, ...rest] = spec.split(":");
	if (!name) throw new Error(`--arg needs a name (got "${spec}")`);
	const arg = { name };
	for (const token of rest) {
		if (token === "required") arg.required = true;
		else if (ARG_TYPES.has(token)) arg.type = token;
		else throw new Error(`--arg "${spec}": unknown token "${token}" (type: ${[...ARG_TYPES].join("|")}, or "required")`);
	}
	return arg;
}

/** Parse `name:kind[:enum=a,b,c]` into a CapabilityOptionSpec. */
function parseOption(spec) {
	const [name, kind, ...rest] = spec.split(":");
	if (!name || !kind) throw new Error(`--option needs name:kind (got "${spec}")`);
	if (!OPTION_KINDS.has(kind)) throw new Error(`--option "${spec}": unknown kind "${kind}" (${[...OPTION_KINDS].join("|")})`);
	const option = { name, kind, summary: `The ${name} option` };
	for (const token of rest) {
		if (token.startsWith("enum=")) option.enum = token.slice("enum=".length).split(",").filter(Boolean);
		else throw new Error(`--option "${spec}": unknown token "${token}" (only enum=a,b,c)`);
	}
	return option;
}

/** Parse the full argv into { dir, spec }. PURE. */
export function parseScaffoldArgs(argv) {
	let name;
	let dir = ".";
	let summary;
	const args = [];
	const options = [];
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		// Read the value that FOLLOWS a value-taking flag; a missing one (flag was the last token) is a clear
		// error, not a `TypeError`/silent `undefined` that loses the default or crashes downstream.
		const value = () => {
			const v = argv[++i];
			if (v === undefined) throw new Error(`${token} needs a value`);
			return v;
		};
		if (token === "--") continue; // the standard "end of options" separator (e.g. forwarded by pnpm)
		else if (token === "--dir") dir = value();
		else if (token === "--summary") summary = value();
		else if (token === "--arg") args.push(parseArg(value()));
		else if (token === "--option") options.push(parseOption(value()));
		else if (token.startsWith("--")) throw new Error(`unknown flag "${token}"`);
		else if (!name) name = token;
		else throw new Error(`unexpected argument "${token}" (name already set to "${name}")`);
	}
	if (!name) throw new Error("usage: scaffold:capability <name> [--dir d] [--arg n:t:required] [--option n:kind]");
	const spec = { name };
	if (summary) spec.summary = summary;
	if (args.length) spec.args = args;
	if (options.length) spec.options = options;
	return { dir, spec };
}

async function main() {
	let parsed;
	try {
		parsed = parseScaffoldArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
		return;
	}
	// scaffold.js is a zero-runtime-dep leaf (only type imports), so load the built file directly — the
	// root workspace does not symlink @refarm.dev/capabilities. Build it first if this throws.
	const scaffoldUrl = new URL("../packages/capabilities/dist/scaffold.js", import.meta.url);
	const { buildCapabilityScaffold } = await import(scaffoldUrl.href).catch(() => {
		throw new Error("run `pnpm -C packages/capabilities build` first (dist/scaffold.js not found)");
	});
	const scaffold = buildCapabilityScaffold(parsed.spec);
	await mkdir(parsed.dir, { recursive: true });
	for (const file of [scaffold.descriptor, scaffold.test]) {
		const target = path.join(parsed.dir, file.path);
		await writeFile(target, file.content, "utf-8");
		process.stdout.write(`  ✓ ${target}\n`);
	}
	process.stdout.write(
		`\n✅ Scaffolded \`${parsed.spec.name}\`. Register ${scaffold.descriptor.path.replace(/\.ts$/, "")}'s ` +
			`export in your capability registry, then implement run(). The cross-surface test` +
			`${scaffold.invalidField ? ` rejects a bad \`${scaffold.invalidField}\` on every surface` : " asserts the schema"}.\n`,
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	void main();
}
