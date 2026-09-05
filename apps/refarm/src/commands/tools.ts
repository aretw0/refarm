/**
 * DECLARING A NODE TOOL WITHOUT WRITING JSON BY HAND.
 *
 * `nodeTools` (see docs/node-tools.md) says which tools this node depends on but does not ship.
 * Shipping the reader without a way to write the declaration would have left the operator editing
 * a config file by hand — which is exactly the work this repository already has blocks for:
 *
 *   @refarm.dev/prompt-contract-v1   asks, over a channel that is NOT assumed to be a terminal
 *   @refarm.dev/operation-consent-v1 shows the diff, records the decision, keeps an undo
 *   catalog-authoring.ts             writes one keyed entry into the sovereign config
 *
 * Nothing here re-implements any of that. The only thing this file owns is the part that is
 * genuinely about tools: MEASURING the binary before asking, so the floor the operator authorises
 * is a number they were shown rather than one they had to remember.
 *
 * The measurement is also why this cannot be a plain `config set`. "Declare gh at 2.40.0" is a
 * decision; "declare gh at whatever is installed" is an observation pretending to be one. The
 * wizard proposes the measured version as the DEFAULT and the operator confirms it — which is the
 * difference between inferring a contract and being handed a draft of one.
 */
import { declaredBase, sovereignConfigRelativePath } from "@refarm.dev/config";
import {
	describeMeasurement,
	explainToolRequirement,
	measureTool,
	proposedFloor,
	readToolRequirements,
	toolRequirementState,
} from "@refarm.dev/health";
import type { OperationFileSystem, OperationTrail } from "@refarm.dev/operation-consent-v1";
import {
	createOperatorChannelFor,
	OperatorPromptCancelledError,
	type OperatorChannel,
} from "@refarm.dev/prompt-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refarmCommand } from "../brand.js";
import {
	authorCatalogDeclaration,
	buildCatalogOperationRequest,
	planCatalogDeclaration,
	renderCatalogProposal,
	standingCatalogDecision,
	type CatalogDeclarationPlan,
} from "./catalog-authoring.js";

/** The catalog block, shared with the reader in @refarm.dev/health. */
export const NODE_TOOLS_BLOCK = "nodeTools";

export const TOOLS_ADD_COMMAND = refarmCommand(["tools", "add"]);

export interface ToolsAddDeps {
	/** Named through `measureTool` rather than `node:child_process`: app source may not import
	 *  it (process-boundary.test.ts), and the spawn belongs to the package that interprets it. */
	readonly spawnSync?: Parameters<typeof measureTool>[2];
	/** `null` ⇒ nobody to ask; nothing is written. Injected in tests and by `--json` callers. */
	readonly operator?: OperatorChannel | null;
	readonly root?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => string;
	readonly fs?: OperationFileSystem;
	readonly trail?: OperationTrail;
	readonly decidedBy?: string;
	readonly host?: string;
	/** Where the rendered proposal goes. Local by default: it is the whole config file. */
	readonly review?: (line: string) => void;
}

export interface ToolsAddOptions {
	readonly minVersion?: string;
	readonly why?: string;
	readonly args?: readonly string[];
	/** Declare it even though it did not run — a tool the operator is about to install. */
	readonly evenIfAbsent?: boolean;
	readonly replace?: boolean;
	readonly attendedElsewhere?: boolean;
}

export type ToolsAddResult =
	| {
			readonly status: "authorized";
			readonly tool: string;
			readonly measurement: ReturnType<typeof measureTool>;
			readonly minVersion: string | null;
			readonly recordId: string;
	  }
	| { readonly status: "declined"; readonly tool: string; readonly recordId: string }
	| { readonly status: "deferred"; readonly tool: string }
	| { readonly status: "refused"; readonly tool: string; readonly reason: string };

const DEFAULT_ARGS = ["--version"] as const;

export async function runToolsAdd(
	command: string,
	options: ToolsAddOptions = {},
	deps: ToolsAddDeps = {},
): Promise<ToolsAddResult> {
	const tool = command.trim();
	if (!tool) return { status: "refused", tool: command, reason: "no command was named" };

	const env = deps.env ?? process.env;
	// The NODE tier, always. Auditing a declared tool RUNS it, so this key is node-owned and a
	// workspace may state the need but never hold the declaration — see docs/CONFIG_TIERS.md.
	// `declaredBase` IS the chain (SOVEREIGN_BASE → REFARM_HOME → HOME → os), and calling it
	// beats restating it: a second copy of a precedence rule is a second thing to get wrong,
	// and this one already went wrong once for exactly that reason (ISS-025).
	const root = deps.root ?? declaredBase(env);
	const args = options.args ? [...options.args] : [...DEFAULT_ARGS];

	const measurement = measureTool(tool, args, deps.spawnSync);
	if (measurement.kind === "absent" && !options.evenIfAbsent) {
		// Refused rather than asked: declaring a tool that is not here is a reasonable thing to
		// want (you are about to install it) and a terrible thing to do by accident, because the
		// node starts reporting a finding for a decision nobody consciously made.
		return {
			status: "refused",
			tool,
			reason: `${describeMeasurement(tool, measurement)} Declare it anyway with --even-if-absent.`,
		};
	}

	const operator =
		deps.operator !== undefined
			? deps.operator
			: createOperatorChannelFor({
					atTerminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
					attendedElsewhere: options.attendedElsewhere ?? false,
				});

	let minVersion: string | null = options.minVersion?.trim() || null;
	let why: string | undefined = options.why?.trim() || undefined;

	if (operator) {
		try {
			operator.say?.(describeMeasurement(tool, measurement));
			if (minVersion === null) {
				const proposed = proposedFloor(measurement);
				const answer = await operator.ask({
					type: "text",
					question: `Minimum version for \`${tool}\`? Empty means presence is the whole question.`,
					...(proposed ? { default: proposed } : {}),
					placeholder: proposed ?? "leave empty",
				});
				minVersion = answer.trim() || null;
			}
			if (why === undefined) {
				const answer = await operator.ask({
					type: "text",
					question: `What does this node depend on \`${tool}\` for?`,
					placeholder: "carried into the finding when it is missing or too old",
				});
				why = answer.trim() || undefined;
			}
		} catch (error) {
			if (error instanceof OperatorPromptCancelledError) return { status: "deferred", tool };
			throw error;
		}
	}

	const entry: Record<string, unknown> = {};
	if (minVersion) entry.minVersion = minVersion;
	if (why) entry.why = why;
	if (options.args) entry.args = [...options.args];

	const plan: CatalogDeclarationPlan = planCatalogDeclaration({
		block: NODE_TOOLS_BLOCK,
		name: tool,
		entry,
		root,
		env,
		// This writer owns exactly the three fields it authors. An operator who hand-added a key
		// this build does not know about keeps it — ISS-036's lesson, applied before it costs
		// anything rather than after.
		ownedKeys: ["minVersion", "why", "args"],
	});

	const prior = deps.trail
		? await standingCatalogDecision(deps.trail, NODE_TOOLS_BLOCK, tool)
		: null;

	const request = buildCatalogOperationRequest({
		plan,
		title: `${TOOLS_ADD_COMMAND} ${tool}`,
		purpose:
			`Declare that this node depends on \`${tool}\`` +
			(minVersion ? ` at ${minVersion} or newer` : " being present") +
			(why ? `, for: ${why}` : "") +
			". `refarm health` will measure it from now on and report when it drifts.",
		requester: TOOLS_ADD_COMMAND,
		requestedAt: (deps.now ?? (() => new Date().toISOString()))(),
		notes: [
			describeMeasurement(tool, measurement),
			// Said out loud because it is the surprising half: this declaration makes `health` run
			// the binary on every audit. An operator authorising a config edit should know they are
			// also authorising an execution.
			`From now on \`refarm health\` runs \`${[tool, ...args].join(" ")}\` on this node to read its version.`,
		],
	});

	const review = deps.review ?? ((line: string) => console.log(line));
	for (const line of renderCatalogProposal(request)) review(line);

	const outcome = await authorCatalogDeclaration({
		request,
		channel: operator,
		...(deps.trail ? { trail: deps.trail } : {}),
		...(deps.fs ? { fs: deps.fs } : {}),
		...(deps.now ? { now: deps.now } : {}),
		...(deps.decidedBy ? { decidedBy: deps.decidedBy } : {}),
		host: deps.host ?? os.hostname(),
		...(prior ? { revisit: true } : {}),
	});

	if (outcome.status === "declined") {
		return { status: "declined", tool, recordId: outcome.record.id };
	}
	if (outcome.status !== "authorized") return { status: "deferred", tool };
	return { status: "authorized", tool, measurement, minVersion, recordId: outcome.record.id };
}

// ── Reading back what was declared ────────────────────────────────────────────

export interface ToolStatus {
	readonly command: string;
	readonly state: "ok" | "absent" | "outdated" | "cannot-say";
	readonly minVersion: string | null;
	readonly measuredVersion: string | null;
	readonly why: string | null;
	readonly detail: string | null;
}

export interface ToolsListResult {
	readonly configPath: string;
	readonly tools: ToolStatus[];
	readonly malformed: unknown[];
}

export interface ToolsListDeps {
	/** Named through `measureTool` rather than `node:child_process`: app source may not import
	 *  it (process-boundary.test.ts), and the spawn belongs to the package that interprets it. */
	readonly spawnSync?: Parameters<typeof measureTool>[2];
	readonly env?: NodeJS.ProcessEnv;
	readonly readConfig?: (configPath: string) => unknown;
}

/**
 * Every declared tool and where it stands — including the ones that are FINE.
 *
 * Deliberately a different view from `refarm health`, which reports only findings. "Nothing is
 * wrong" and "nothing is declared" render identically in a findings list, and an operator asking
 * "what does this node depend on?" is asking the second question, not the first.
 *
 * Composes the same pure decisions the auditor uses — `readToolRequirements`, `parseToolVersion`,
 * `toolRequirementState`, `explainToolRequirement`. A second opinion about what `outdated` means
 * is the one thing this file must never grow.
 */
export function runToolsList(deps: ToolsListDeps = {}): ToolsListResult {
	const env = deps.env ?? process.env;
	const configPath = path.join(declaredBase(env), sovereignConfigRelativePath(env));
	const read =
		deps.readConfig ??
		((target: string) => {
			try {
				return JSON.parse(fs.readFileSync(target, "utf-8"));
			} catch {
				return undefined;
			}
		});
	const declaration = readToolRequirements(read(configPath));


	const tools = declaration.tools.map((tool): ToolStatus => {
		const measurement = measureTool(tool.command, tool.args, deps.spawnSync);
		const present = measurement.kind !== "absent";
		const banner = measurement.kind === "absent" ? undefined : measurement.banner;
		const state = toolRequirementState({
			present,
			...(banner !== undefined ? { versionText: banner } : {}),
			...(tool.minVersion !== undefined ? { minVersion: tool.minVersion } : {}),
		});
		const measured = measurement.kind === "measured" ? measurement.version : null;
		return {
			command: tool.command,
			state,
			minVersion: tool.minVersion ?? null,
			measuredVersion: measured,
			why: tool.why ?? null,
			detail:
				explainToolRequirement(
					{
						command: tool.command,
						...(tool.minVersion !== undefined ? { minVersion: tool.minVersion } : {}),
						...(tool.why !== undefined ? { why: tool.why } : {}),
					},
					state,
					measured ?? undefined,
				) ?? null,
		};
	});

	return { configPath, tools, malformed: declaration.malformed };
}
