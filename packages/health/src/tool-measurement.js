/**
 * RUNNING A DECLARED TOOL TO SEE WHAT IT SAYS.
 *
 * Split from `tool-requirements.js` on purpose: that module is pure and decides what a measurement
 * MEANS, this one performs the measurement. Keeping the spawn out of the pure module is what lets
 * every state in the four-state contract be tested without a machine to run on.
 *
 * It lives in this package rather than in the CLI for a boundary the repo enforces: app source may
 * not import `node:child_process` (apps/refarm/test/architecture/process-boundary.test.ts). That
 * rule points at the right home anyway — the auditor here already spawns tools, and a second copy
 * of "run it and read the banner" in a wizard would be a second thing to get wrong.
 */
import { spawnSync as defaultSpawnSync } from "node:child_process";

import { parseToolVersion } from "./tool-requirements.js";

/**
 * @typedef {{ kind: "measured", version: string, banner: string }
 *   | { kind: "unreadable", banner: string }
 *   | { kind: "absent", detail: string }} ToolMeasurement
 */

const DEFAULT_ARGS = ["--version"];
const BANNER_LIMIT = 200;

/**
 * Run the tool and read what it says.
 *
 * THREE outcomes, not two. "It is not installed" and "it ran but printed something no version can
 * be read out of" lead to different declarations — one you install, one you declare without a
 * floor — and collapsing them sends the operator to the wrong repair half the time.
 *
 * @param {string} command
 * @param {readonly string[]} [args]
 * @param {typeof defaultSpawnSync} [spawnSync]
 * @returns {ToolMeasurement}
 */
export function measureTool(command, args = DEFAULT_ARGS, spawnSync = defaultSpawnSync) {
	let result;
	try {
		result = spawnSync(command, [...args], { encoding: "utf8" });
	} catch (error) {
		return { kind: "absent", detail: error instanceof Error ? error.message : String(error) };
	}
	if (result.error) return { kind: "absent", detail: result.error.message };
	if (result.status !== 0) {
		const detail = String(result.stderr || result.stdout || "").trim().slice(0, BANNER_LIMIT);
		return { kind: "absent", detail: detail || `exited ${result.status}` };
	}
	const banner = String(result.stdout || "").trim().slice(0, BANNER_LIMIT);
	const version = parseToolVersion(banner);
	return version ? { kind: "measured", version, banner } : { kind: "unreadable", banner };
}

/**
 * PURE. The floor to PROPOSE for a tool, given what it said.
 *
 * The measured version — not a guess at a future one. "At least what I have today" is the common
 * intent, and anyone who wants a different floor is one keystroke from typing it. Inventing a
 * number for an unreadable banner would be a guess wearing a default.
 *
 * @param {ToolMeasurement} measurement
 * @returns {string | null}
 */
export function proposedFloor(measurement) {
	return measurement.kind === "measured" ? measurement.version : null;
}

/**
 * PURE. What the operator reads before deciding.
 *
 * @param {string} command
 * @param {ToolMeasurement} measurement
 * @returns {string}
 */
export function describeMeasurement(command, measurement) {
	if (measurement.kind === "measured") {
		return `\`${command}\` is installed and reports ${measurement.version} — "${measurement.banner}".`;
	}
	if (measurement.kind === "unreadable") {
		return (
			`\`${command}\` ran, but no version could be read out of "${measurement.banner}". ` +
			"Declaring a minimum against it would report `cannot-say` on every audit, which is honest " +
			"but not useful — consider declaring it without a minimum."
		);
	}
	return `\`${command}\` did not run here: ${measurement.detail}`;
}
