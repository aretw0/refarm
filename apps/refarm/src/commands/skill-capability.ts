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
	loadSkillsFromPluginsDir,
} from "@refarm.dev/plugin-surface-loader/node";
import chalk from "chalk";

import { pluginsBaseDir } from "../utils/refarm-home.js";
import type { CapabilitySurfaceHooks } from "./capability-commander.js";

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
}

export function defaultSkillDeps(): SkillCommandDeps {
	return {
		discover: () => loadSkillsFromPluginsDir(pluginsBaseDir()),
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

	return {
		name: "skill",
		summary: "Inspect skills declared by installed plugins",
		actions: { list, show },
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
		default:
			return {};
	}
}
