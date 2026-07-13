import { loadSkillsFromPluginsDir } from "@refarm.dev/plugin-surface-loader/node";

/**
 * Pack the installed skills' PROGRESSIVE-DISCLOSURE metadata into the `MODEL_SKILLS`
 * env var the agent reads (its `skill_prompts_for_prompt`). The references
 * (Codex/Hermes/Claude Skills) keep a skill's name + description ("when to use")
 * cheaply present in the system prompt, and load the full instructions only on
 * demand — so this deliberately packs ONLY the one-line disclosure per skill, never
 * the SKILL.md body. The agent side (`packages/agent`, MODEL_SKILLS) formats these
 * into the "Skills available to you" section.
 *
 * The minimal disclosure shape a skill exposes here: its `name` and `description`
 * (the line the model matches against to self-select the skill).
 */
export interface SkillDisclosure {
	name: string;
	description?: string;
}

/** One disclosure line per skill: `name — description`, or just `name` when a skill
 * declares no description. Skills without a usable name are dropped (nothing to
 * disclose). Newline-joined — the agent splits on lines, so a line never contains a
 * newline (descriptions are collapsed to a single line). */
export function buildSkillDisclosureEnv(skills: readonly SkillDisclosure[]): string {
	return skills
		.map((skill) => ({
			name: skill.name?.trim() ?? "",
			description: skill.description?.replace(/\s+/g, " ").trim() ?? "",
		}))
		.filter((skill) => skill.name.length > 0)
		.map((skill) => (skill.description ? `${skill.name} — ${skill.description}` : skill.name))
		.join("\n");
}

/** A skill whose FULL body (SKILL.md instructions) is available — the second half of
 * progressive disclosure. `injectSkillEnv` packs these into `MODEL_SKILL_BODIES` so the
 * agent's `load_skill` tool can return the full text on demand. */
export interface SkillBody extends SkillDisclosure {
	/** The full SKILL.md instructions (the parsed body). */
	instructions: string;
}

/**
 * Pack skill name → full instructions into the JSON map the agent's `load_skill` tool
 * reads (`MODEL_SKILL_BODIES`). This is the ON-DEMAND half of progressive disclosure:
 * the body is kept OUT of `MODEL_SKILLS` (the cheap always-present index) so the model
 * pays body tokens only when it actually opens a skill. JSON (not a bespoke delimiter)
 * because a SKILL.md body contains anything — headings, newlines, quotes — and JSON
 * escaping is exact. Skills without a name or with an empty body are dropped. Returns
 * `"{}"` (a valid empty map) when there is nothing to pack, so the agent always parses
 * cleanly.
 */
export function buildSkillBodiesEnv(skills: readonly SkillBody[]): string {
	const map: Record<string, string> = {};
	for (const skill of skills) {
		const name = skill.name?.trim() ?? "";
		const body = skill.instructions ?? "";
		if (name.length > 0 && body.length > 0) {
			map[name] = body;
		}
	}
	return JSON.stringify(map);
}

/**
 * Read the plugin-declared skills under `pluginsDir` and set `MODEL_SKILLS` on `env`
 * to their disclosure index, so the agent's system prompt lists them. A no-op (env
 * left untouched) when there are no skills — the agent then gets a byte-identical
 * prompt. Best-effort: a failing skill scan must never block the daemon boot.
 *
 * Scope note: this covers skills SHIPPED BY PLUGINS (`pi/skill` surfaces in the
 * plugins dir the runtime loads). Skills brought in via `skill import` live in a
 * scoped ledger; folding those in is a follow-on (they need the ledger-scope
 * resolver, which the daemon does not wire today).
 */
export function injectSkillEnv(
	pluginsDir: string,
	env: NodeJS.ProcessEnv = process.env,
): { count: number } {
	let skills: SkillBody[] = [];
	try {
		// DiscoveredSkill extends LoadedSkill, so it carries `instructions` (the body) —
		// enough for both the cheap index and the on-demand bodies map below.
		skills = loadSkillsFromPluginsDir(pluginsDir).skills;
	} catch {
		return { count: 0 }; // never fatal to boot
	}
	const packed = buildSkillDisclosureEnv(skills);
	if (packed.length === 0) return { count: 0 };
	env.MODEL_SKILLS = packed;
	// The on-demand bodies for `load_skill` — packed only when there IS an index, so
	// the two envs stay in lockstep (a skill in the index is loadable).
	env.MODEL_SKILL_BODIES = buildSkillBodiesEnv(skills);
	return { count: packed.split("\n").length };
}
