import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import { loadRawSovereignConfig } from "@refarm.dev/config";
import {
	createFileOperationTrail,
	createNodeOperationFileSystem,
} from "@refarm.dev/operation-consent-v1";
import {
	createStdioOperatorChannel,
	OperatorPromptCancelledError,
	type OperatorChannel,
} from "@refarm.dev/prompt-contract-v1";
import {
	KNOWN_SURFACES,
	parseSurfaces,
	surfaceEnforceableGate,
} from "@refarm.dev/std";
import chalk from "chalk";
import { Command } from "commander";
import os from "node:os";
import { refarmCommand } from "../brand.js";
import {
	authorCatalogDeclaration,
	buildCatalogOperationRequest,
	catalogConfigPath,
	catalogTrailPath,
	planCatalogDeclaration,
	renderCatalogProposal,
	standingCatalogDecision,
} from "./catalog-authoring.js";

const SURFACE_ADD_COMMAND = refarmCommand(["surface", "add"]);
const SURFACE_LIST_COMMAND = refarmCommand(["surface", "list", "--json"]);

export interface SurfaceAddOptions {
	name?: string;
	expose?: string;
	gate?: string;
	replace?: boolean;
	attendedElsewhere?: boolean;
}

export interface SurfaceAddDeps {
	root?: string;
	env?: NodeJS.ProcessEnv;
	interactive?: boolean;
	operator?: OperatorChannel;
	now?: () => string;
	decidedBy?: string;
	host?: string;
	announce?: (line: string) => void;
}

export type SurfaceAddResult =
	| {
			status: "declared";
			surface: string;
			expose: string;
			gate: string;
			configPath: string;
			recordId: string;
			undoCommand: string;
			replaced: boolean;
	  }
	| { status: "unchanged" | "cancelled" | "deferred"; surface: string }
	| { status: "declined"; surface: string; recordId: string };

export class SurfaceAddRefusal extends Error {
	constructor(readonly code: string, message: string, readonly nextCommands = [SURFACE_LIST_COMMAND]) {
		super(message);
		this.name = "SurfaceAddRefusal";
	}
}

export function deriveSurfaceGate(name: string): "device-token" | "none" {
	return surfaceEnforceableGate(name) === "device-token" ? "device-token" : "none";
}

function validateEntry(name: string, expose: string, gate: string): void {
	parseSurfaces({ surfaces: { [name]: { expose, gate } } });
}

function rawSurfaces(root: string): Record<string, unknown> {
	const raw = loadRawSovereignConfig(root);
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const block = (raw as Record<string, unknown>).surfaces;
	return block && typeof block === "object" && !Array.isArray(block)
		? (block as Record<string, unknown>)
		: {};
}

export async function runSurfaceAdd(
	options: SurfaceAddOptions,
	deps: SurfaceAddDeps = {},
): Promise<SurfaceAddResult> {
	const root = deps.root ?? process.cwd();
	const env = deps.env ?? process.env;
	const atTerminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
	if (!(deps.interactive ?? (atTerminal || Boolean(options.attendedElsewhere)))) {
		throw new SurfaceAddRefusal(
			"surface-add-not-interactive",
			`Declaring exposure is your authorisation, and there is nowhere to ask you. Run this from an interactive surface, or edit ${catalogConfigPath(root, env)} by hand.`,
			[SURFACE_ADD_COMMAND, SURFACE_LIST_COMMAND],
		);
	}
	const operator = deps.operator ?? createStdioOperatorChannel();
	let name = options.name?.trim() ?? "";
	try {
		if (!name) {
			name = String(
				await operator.ask({
					type: "select",
					question: "Qual superfície você quer declarar?",
					options: KNOWN_SURFACES.map((value) => ({ value, label: value })),
				}),
			);
		}
		if (!KNOWN_SURFACES.includes(name)) {
			throw new SurfaceAddRefusal("surface-add-unknown-surface", `Unknown surface "${name}". Known surfaces: ${KNOWN_SURFACES.join(", ")}.`, [SURFACE_ADD_COMMAND]);
		}

		let expose = options.expose?.trim() ?? "";
		if (!expose) {
			expose = String(await operator.ask({
				type: "select",
				question: `Quem pode alcançar "${name}"?`,
				options: [
					{ value: "loopback", label: "Só este dispositivo", description: "Escuta apenas no próprio nó." },
					{ value: "tailnet", label: "Dispositivos admitidos", description: "Usa a tailnet escolhida pelo operador como trilho de admissão." },
				],
			}));
		}
		const gate = options.gate?.trim() || deriveSurfaceGate(name);
		validateEntry(name, expose, gate);

		const existing = rawSurfaces(root)[name];
		if (existing !== undefined && !options.replace) {
			if (JSON.stringify(existing) === JSON.stringify({ expose, gate })) return { status: "unchanged", surface: name };
			throw new SurfaceAddRefusal("surface-add-already-declared", `surfaces."${name}" is already declared. Use --replace to review a replacement.`, [SURFACE_LIST_COMMAND, `${SURFACE_ADD_COMMAND} ${name} --replace`]);
		}

		const plan = planCatalogDeclaration({
			block: "surfaces",
			name,
			entry: { expose, gate },
			root,
			env,
		});
		// Validate the WHOLE proposed catalog before asking or writing. An independently invalid
		// sibling must not turn this wizard into a canonical serializer for broken configuration.
		parseSurfaces(JSON.parse(plan.after));
		const trail = createFileOperationTrail(catalogTrailPath(plan.configPath), createNodeOperationFileSystem());
		const prior = await standingCatalogDecision(trail, "surfaces", name);
		if (prior && !options.replace) {
			throw new SurfaceAddRefusal("surface-add-already-decided", `A decision for surfaces."${name}" is already recorded. Use --replace to review it again.`, [SURFACE_LIST_COMMAND, `${SURFACE_ADD_COMMAND} ${name} --replace`]);
		}
		const request = buildCatalogOperationRequest({
			plan,
			title: `${SURFACE_ADD_COMMAND} ${name}`,
			purpose: `Declare who may reach the "${name}" surface and the gate it actually enforces.`,
			requester: SURFACE_ADD_COMMAND,
			requestedAt: (deps.now ?? (() => new Date().toISOString()))(),
			notes: [`gate "${gate}" was derived from the canonical enforcement table; expose "${expose}" is the operator's network intent.`],
		});
		for (const line of renderCatalogProposal(request)) (deps.announce ?? console.log)(line);
		const outcome = await authorCatalogDeclaration({
			request,
			channel: operator,
			trail,
			...(deps.now ? { now: deps.now } : {}),
			...(deps.decidedBy ? { decidedBy: deps.decidedBy } : {}),
			host: deps.host ?? os.hostname(),
			...(prior ? { revisit: true } : {}),
		});
		if (outcome.status === "declined") return { status: "declined", surface: name, recordId: outcome.record.id };
		if (outcome.status !== "authorized") return { status: "deferred", surface: name };
		parseSurfaces(loadRawSovereignConfig(root));
		return {
			status: "declared", surface: name, expose, gate, configPath: plan.configPath,
			recordId: outcome.record.id, replaced: plan.replaced,
			undoCommand: refarmCommand(["config", "history", "undo", outcome.record.id, "--local"]),
		};
	} catch (error) {
		if (error instanceof OperatorPromptCancelledError) return { status: "cancelled", surface: name };
		throw error;
	}
}

function serializeCatalog(root = process.cwd()): Array<{ name: string; expose: string; gate: string | null }> {
	return [...parseSurfaces(loadRawSovereignConfig(root))].map(([name, declaration]) => ({
		name,
		expose: declaration.expose.kind === "host" ? `host:${declaration.expose.host}` : declaration.expose.kind,
		gate: declaration.gate === "open" ? "none" : declaration.gate,
	}));
}

export function createSurfaceCommand(): Command {
	const command = new Command("surface").description("Declare and inspect Refarm network surfaces");
	command.command("add").argument("[name]").option("--expose <intent>", "loopback | tailnet | host:<ip>").option("--gate <gate>", "device-token | none (normally derived)").option("--replace").option("--attended-elsewhere").option("--json").action(async (name: string | undefined, options: SurfaceAddOptions & { json?: boolean }) => {
		try {
			const result = await runSurfaceAdd({ ...options, ...(name ? { name } : {}) }, { announce: (line) => { if (!options.json) console.log(line); } });
			const nextCommands = result.status === "declared" ? [SURFACE_LIST_COMMAND, result.undoCommand] : [SURFACE_LIST_COMMAND];
			if (options.json) printJson(buildJsonSuccessEnvelope({ command: "surface", operation: "add", nextAction: nextCommands[0] ?? null, nextCommands, extra: { ...result } }));
			else if (result.status === "declared") {
				console.log(chalk.green(`✓  declared "${result.surface}"`));
				console.log(chalk.dim(`   ${result.configPath}`));
			} else console.log(chalk.dim(`${result.status}: "${result.surface}"`));
		} catch (error) {
			const refusal = error instanceof SurfaceAddRefusal ? error : null;
			const message = error instanceof Error ? error.message : String(error);
			const nextCommands = refusal?.nextCommands ?? [SURFACE_ADD_COMMAND];
			if (options.json) printJson(buildJsonErrorEnvelope({ command: "surface", operation: "add", error: refusal?.code ?? "surface-add-failed", message, nextAction: nextCommands[0] ?? SURFACE_ADD_COMMAND, nextCommand: nextCommands[0] ?? SURFACE_ADD_COMMAND, nextCommands }));
			else console.error(chalk.red(`✗  ${message}`));
			process.exitCode = 1;
		}
	});
	command.command("list").option("--json").action((options: { json?: boolean }) => {
		const root = process.cwd();
		const configPath = catalogConfigPath(root, process.env);
		const surfaces = serializeCatalog(root);
		if (options.json) printJson(buildJsonSuccessEnvelope({ command: "surface", operation: "list", nextAction: null, nextCommands: [], extra: { root, configPath, surfaces } }));
		else {
			console.log(chalk.dim(`scope: ${root}`));
			console.log(chalk.dim(`config: ${configPath}`));
			if (surfaces.length === 0) console.log('no surface is declared under "surfaces" in this config');
			else for (const entry of surfaces) console.log(`${entry.name}: expose=${entry.expose}, gate=${entry.gate ?? "undeclared"}`);
		}
	});
	return command;
}
