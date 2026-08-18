/**
 * WHAT THE NODE DEPENDS ON THAT IT DOES NOT SHIP.
 *
 * A node runs on tools it did not build: `gh`, `rsync`, `cargo`, a VPN client. They live outside
 * every artifact this repo produces, they drift on their own schedule, and nothing here notices
 * when they do. The failure this module exists to prevent is specific and was measured on the
 * operator's own node: `gh` at 2.4.0, shipped 2022, present and answering — so every check that
 * asks "is it installed?" says yes, right up to the moment a command it does not have fails in
 * the middle of unrelated work.
 *
 * DECLARED, NOT INFERRED. The same shape `modelAuthorization` uses: the node says what it needs,
 * and the reader measures against that. Inferring the requirement from what happens to be
 * installed makes today's accident into tomorrow's contract.
 *
 * FOUR STATES, because an operator repairs each differently and a boolean erases three:
 *   ok         — present, and at or above what was declared
 *   absent     — the command did not run at all
 *   outdated   — present, and older than what was declared
 *   cannot-say — present, a minimum was declared, and the version could not be read
 *
 * `cannot-say` is the load-bearing one. Collapsing it into `ok` reports success on a claim
 * nothing verified; collapsing it into `outdated` accuses a tool that may be perfectly current.
 */

const DEFAULT_VERSION_ARGS = ["--version"];

/**
 * @typedef {"ok" | "absent" | "outdated" | "cannot-say"} ToolRequirementState
 *
 * @typedef {object} DeclaredTool
 * @property {string} command
 * @property {string[]} args
 * @property {string} [minVersion]
 * @property {string} [why]
 *
 * @typedef {object} ToolRequirements
 * @property {DeclaredTool[]} tools
 * @property {unknown[]} malformed
 */

/**
 * PURE. Reads the declared tool requirements out of a sovereign config.
 *
 * Malformed entries are RETURNED, not dropped. An entry the operator believes is guarding a tool
 * must never vanish into silence — that turns a typo into an unguarded dependency that reads as
 * a guarded one.
 *
 * @param {unknown} config
 * @returns {ToolRequirements}
 */
export function readToolRequirements(config) {
	const declared = config && typeof config === "object" ? config.nodeTools : undefined;
	if (declared === undefined || declared === null) return { tools: [], malformed: [] };
	if (!Array.isArray(declared)) return { tools: [], malformed: [declared] };

	const tools = [];
	const malformed = [];
	for (const entry of declared) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			malformed.push(entry);
			continue;
		}
		const command = typeof entry.command === "string" ? entry.command.trim() : "";
		if (!command) {
			malformed.push(entry);
			continue;
		}
		tools.push({
			command,
			args: Array.isArray(entry.args) && entry.args.every((a) => typeof a === "string")
				? entry.args
				: DEFAULT_VERSION_ARGS,
			minVersion: typeof entry.minVersion === "string" ? entry.minVersion : undefined,
			why: typeof entry.why === "string" ? entry.why : undefined,
		});
	}
	return { tools, malformed };
}

/**
 * PURE. The version inside whatever banner a tool prints, or nothing.
 *
 * Requires at least one dot. `gh version 2.4.0 (2022-03-30)` must yield `2.4.0` and never `2022`:
 * a date read as a version is a number larger than every real minimum, so the one tool that is
 * definitely stale would be the one that passes.
 *
 * @param {string | undefined} text
 * @returns {string | undefined}
 */
export function parseToolVersion(text) {
	if (typeof text !== "string") return undefined;
	const match = /(?<![\d.])(\d+\.\d+(?:\.\d+)*)/u.exec(text);
	return match ? match[1] : undefined;
}

/** PURE. Segment-wise numeric order. Lexical comparison puts "2.10.0" below "2.9.0", which
 *  refuses the newer tool and accepts the older one — backwards in the direction that matters. */
export function compareVersions(left, right) {
	const a = String(left).split(".").map((s) => Number.parseInt(s, 10) || 0);
	const b = String(right).split(".").map((s) => Number.parseInt(s, 10) || 0);
	for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0);
		if (diff !== 0) return diff > 0 ? 1 : -1;
	}
	return 0;
}

/** PURE. Which of the four states a measurement lands on.
 *
 * @param {{ present: boolean, versionText?: string, minVersion?: string }} input
 * @returns {ToolRequirementState}
 */
export function toolRequirementState({ present, versionText, minVersion }) {
	if (!present) return "absent";
	if (!minVersion) return "ok";
	const measured = parseToolVersion(versionText);
	if (!measured) return "cannot-say";
	return compareVersions(measured, minVersion) >= 0 ? "ok" : "outdated";
}

/**
 * PURE. The fact, for a state that is not satisfied — never a command to run.
 *
 * Same brand guard the model-account contract carries: a generic package that names one CLI's
 * verb cannot be reused by another surface, and the handoff belongs where every other one is
 * rendered, from `nextCommands`.
 *
 * @param {{ command: string, minVersion?: string, why?: string }} tool
 * @param {ToolRequirementState} state
 * @param {string | undefined} measured
 * @returns {string | null}
 */
export function explainToolRequirement(tool, state, measured) {
	if (state === "ok") return null;
	const because = tool.why ? ` This node depends on it for: ${tool.why}.` : "";
	if (state === "absent") {
		return `\`${tool.command}\` is declared by this node and did not run.${because}`;
	}
	if (state === "outdated") {
		return `\`${tool.command}\` measured ${measured}, below the declared minimum ${tool.minVersion}.${because}`;
	}
	return (
		`\`${tool.command}\` ran, but its version could not be read, so the declared minimum ` +
		`${tool.minVersion} is UNVERIFIED rather than met.${because}`
	);
}
