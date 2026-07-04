import type {
	CapabilityDescriptor,
	CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";
import {
	type DiscoveredSkill,
	loadCheckersFromPluginsDir,
	loadSkillsFromPluginsDir,
} from "@refarm.dev/plugin-surface-loader/node";
import {
	createReferenceChecker,
	loadCheckerComponent,
	type CheckerFinding,
	type ReferenceChecker,
} from "@refarm.dev/quality-checker-ref";
import chalk from "chalk";

import { pluginsBaseDir } from "../utils/refarm-home.js";
import type { CapabilitySurfaceHooks } from "./capability-commander.js";
import {
	buildDiagnosticNextActionPayload,
	diagnosticNextActions,
	diagnosticNextCommands,
	type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";

/**
 * A tiny built-in profile of "skill tells" — writing patterns worth flagging in a
 * skill's instructions. Matcher-is-data (the reference checker interprets
 * `contains`). This is a starter catalog; a plugin-contributed checker + profile
 * can replace or extend it (that is the whole point of the sovereign boundary).
 */
const SKILL_TELLS_PROFILE = {
	name: "skill-tells",
	rules: [
		{
			id: "ai-self-reference",
			severity: "warn",
			description:
				"Instructions mention being an AI/language model — a chatbot tell, not operator-directed prose.",
			category: "ai-tell",
			check: JSON.stringify({ type: "contains", value: "language model" }),
		},
		{
			id: "todo-placeholder",
			severity: "warn",
			description: "Instructions still contain a TODO placeholder.",
			category: "completeness",
			check: JSON.stringify({ type: "contains", value: "TODO" }),
		},
	],
};

/**
 * The `skill` command as a multi-surface CapabilityGroup — the DESTINATION that
 * finally wires the (previously orphaned) plugin surface loader: `skill list`
 * enumerates installed plugins and loads every pi/skill surface, making skills
 * addressable on the CLI, the REPL `/skill`, and to the agent from ONE
 * declaration. It does NOT invoke a skill (that stays behind the runtime
 * activation preflight — a later slice); it makes them visible.
 *
 * `deps.discover` is injected (defaults to reading `<refarm-home>/plugins`) so
 * run() never touches the filesystem directly and stays testable.
 */
export interface SkillCommandDeps {
	/** Discover installed skills. Defaults to scanning the refarm plugins dir. */
	discover: () => { skills: DiscoveredSkill[]; rejected: { pluginId: string | null; pluginDir: string; issues: string[] }[] };
	/**
	 * Load the quality checkers to run: the bundled reference checker plus any a
	 * plugin contributes via a {kind:"quality-checker"} surface. Each is loaded
	 * under the deny-all sandbox by the host loader — a checker sees only the
	 * subject, never fs/network. Injected so `check` run() stays testable.
	 */
	loadCheckers: () => Promise<ReferenceChecker[]>;
}

export function defaultSkillDeps(): SkillCommandDeps {
	return {
		discover: () => loadSkillsFromPluginsDir(pluginsBaseDir()),
		loadCheckers: async () => {
			// Always include the bundled reference checker; add every
			// plugin-contributed one, each sandboxed by the same host loader.
			const checkers: ReferenceChecker[] = [await createReferenceChecker()];
			const { checkers: discovered } = loadCheckersFromPluginsDir(
				pluginsBaseDir(),
			);
			for (const c of discovered) {
				try {
					checkers.push(
						await loadCheckerComponent({ pkgDir: c.pkgDir, entry: c.entry }),
					);
				} catch {
					// A broken checker component must not block the others.
				}
			}
			return checkers;
		},
	};
}

/** Map a checker finding to a resolvable pending-action recommendation. */
function findingToRecommendation(
	skillId: string,
	finding: CheckerFinding,
): DiagnosticRecommendation {
	return {
		diagnostic: finding.ruleId,
		summary: finding.message,
		severity: finding.severity === "info" ? "info" : "warning",
		action: `Revise the skill's instructions to resolve "${finding.ruleId}".`,
		command: `skill show ${skillId}`,
		target: skillId,
	};
}

/** A skill projected for output — the addressable summary a surface renders. */
function projectSkill(skill: DiscoveredSkill) {
	return {
		id: skill.id,
		name: skill.name,
		...(skill.description ? { description: skill.description } : {}),
		requiredCapabilities: skill.requiredCapabilities,
		pluginId: skill.pluginId,
		surfaceId: skill.surfaceId,
		// Permissive skills declare no capabilities — surfaced as a hint, never a
		// gate (completeness is a policy evaluator's concern, not this listing's).
		maturity: skill.requiredCapabilities.length > 0 ? "complete" : "permissive",
	};
}

export function createSkillCapabilityGroup(
	deps: SkillCommandDeps = defaultSkillDeps(),
): CapabilityGroup {
	const list: CapabilityDescriptor = {
		name: "list",
		summary: "List skills discovered from installed plugins",
		run() {
			const { skills, rejected } = deps.discover();
			return buildJsonSuccessEnvelope({
				command: "skill",
				operation: "list",
				extra: {
					skills: skills.map(projectSkill),
					rejected,
					count: skills.length,
				},
			});
		},
	};

	const show: CapabilityDescriptor = {
		name: "show",
		summary: "Show one discovered skill by id",
		args: [{ name: "id", required: true }],
		run(input) {
			const id = input.args.id as string;
			const { skills } = deps.discover();
			const skill = skills.find((s) => s.id === id || s.name === id);
			if (!skill) {
				return buildJsonErrorEnvelope({
					command: "skill",
					operation: "show",
					error: "skill-not-found",
					message: `No installed skill matches "${id}".`,
					nextAction:
						"Run `skill list` to see the skills installed plugins declare.",
				});
			}
			return buildJsonSuccessEnvelope({
				command: "skill",
				operation: "show",
				extra: { skill: projectSkill(skill) },
			});
		},
	};

	const check: CapabilityDescriptor = {
		name: "check",
		summary: "Run quality checkers over a skill's instructions",
		args: [{ name: "id", required: true }],
		async run(input) {
			const id = input.args.id as string;
			const { skills } = deps.discover();
			const skill = skills.find((s) => s.id === id || s.name === id);
			if (!skill) {
				return buildJsonErrorEnvelope({
					command: "skill",
					operation: "check",
					error: "skill-not-found",
					message: `No installed skill matches "${id}".`,
					nextAction:
						"Run `skill list` to see the skills installed plugins declare.",
				});
			}

			// Every checker inspects the SAME subject (the skill's instructions);
			// findings aggregate across the bundled + plugin-contributed checkers.
			const checkers = await deps.loadCheckers();
			const subject = { tag: "text" as const, val: skill.instructions };
			const findings: CheckerFinding[] = [];
			for (const checker of checkers) {
				findings.push(...checker.check(subject, SKILL_TELLS_PROFILE));
			}

			const recommendations = findings.map((f) =>
				findingToRecommendation(skill.id, f),
			);
			// Findings are POLICY, not a gate: check reports them as resolvable
			// pending-actions on the tri-interface (CLI/REPL/agent) and stays ok —
			// a permissive skill with tells still exists; the operator is nudged.
			return buildDiagnosticNextActionPayload({
				ok: true,
				command: "skill",
				operation: "check",
				skill: projectSkill(skill),
				findingCount: findings.length,
				checkersRun: checkers.length,
				recommendations,
				nextActions: diagnosticNextActions(recommendations),
				nextCommands: diagnosticNextCommands(recommendations),
			});
		},
	};

	return {
		name: "skill",
		summary: "Inspect skills declared by installed plugins",
		actions: { list, show, check },
		// Bare `skill` / `/skill` lists what's available (read-only default).
		defaultAction: "list",
		transports: {
			cli: {},
			repl: { slashAliases: ["skills"] },
			http: { method: "GET", path: "/skills" },
		},
		renderers: { tui: { section: "extensions" } },
	};
}

type SkillProjection = ReturnType<typeof projectSkill>;

function formatMaturity(maturity: string): string {
	return maturity === "permissive"
		? chalk.yellow("permissive")
		: chalk.green("complete");
}

function formatSkillLine(skill: SkillProjection): string {
	const caps =
		skill.requiredCapabilities.length > 0
			? skill.requiredCapabilities.join(", ")
			: chalk.dim("(none declared)");
	return [
		`  ${chalk.bold(skill.name)}  ${chalk.dim(skill.id)}`,
		`    from:         ${skill.pluginId}`,
		`    maturity:     ${formatMaturity(skill.maturity)}`,
		`    capabilities: ${caps}`,
		...(skill.description ? [`    ${skill.description}`] : []),
	].join("\n");
}

/**
 * Per-sub-action text rendering, mirroring the human output style of the other
 * capability groups. Exit intent stays here (a surface concern), never in run().
 */
export function skillCapabilityHooks(subVerb: string): CapabilitySurfaceHooks {
	const renderError = (envelope: { message?: string; error?: string }): string =>
		chalk.red(`✗  ${envelope.message ?? envelope.error ?? "skill error"}`);

	switch (subVerb) {
		case "list":
			return {
				renderText: (envelope) => {
					const e = envelope as unknown as {
						skills: SkillProjection[];
						rejected: { pluginDir: string; issues: string[] }[];
						count: number;
					};
					if (e.count === 0) {
						return chalk.dim(
							"No skills found. Install a plugin that declares a pi/skill surface.",
						);
					}
					const lines = [
						`Skills (${e.count})`,
						...e.skills.map(formatSkillLine),
					];
					if (e.rejected.length > 0) {
						lines.push(
							chalk.yellow(
								`\n${e.rejected.length} plugin surface(s) could not load:`,
							),
							...e.rejected.map(
								(r) => `  ${chalk.dim(r.pluginDir)}: ${r.issues.join("; ")}`,
							),
						);
					}
					return lines.join("\n");
				},
			};
		case "show":
			return {
				renderText: (envelope) => {
					if (envelope.ok === false) return renderError(envelope);
					const { skill } = envelope as unknown as { skill: SkillProjection };
					return formatSkillLine(skill);
				},
			};
		case "check":
			return {
				renderText: (envelope) => {
					if (envelope.ok === false) return renderError(envelope);
					const e = envelope as unknown as {
						skill: SkillProjection;
						findingCount: number;
						checkersRun: number;
						recommendations: DiagnosticRecommendation[];
						nextActions: string[];
					};
					const header = `Quality check: ${chalk.bold(e.skill.name)}  ${chalk.dim(
						`(${e.checkersRun} checker${e.checkersRun === 1 ? "" : "s"})`,
					)}`;
					if (e.findingCount === 0) {
						return `${header}\n  ${chalk.green("✓ no findings")}`;
					}
					const lines = [
						header,
						...e.recommendations.map(
							(r) =>
								`  ${chalk.yellow("⚠")} ${chalk.dim(r.diagnostic)}  ${r.summary}`,
						),
						chalk.dim(`\n  ${e.nextActions.length} pending action(s):`),
						...e.nextActions.map((a) => `    → ${a}`),
					];
					return lines.join("\n");
				},
			};
		default:
			return {};
	}
}
