/**
 * AN EFFORT NOTHING WILL FINISH, AND NOTHING CAN NAME.
 *
 * MEASURED on the operator's node 2026-08-23:
 *
 *   task 18c857e02f2d2fc70016   status: active   updated_at: 2026-08-03 16:17:52
 *
 * Twenty days non-terminal, through the reboot of 2026-08-21 and every daemon restart since — while
 * `refarm task list` reported `total=0`. Two records with different lifetimes: the sidecar's effort
 * lives in memory and only reaches `task-results/<id>.json` when a RESULT lands, so one that never
 * completed is never persisted; the graph's Task, written by the agent side, is never moved out of
 * a non-terminal state. Each half is honest from its own side, and the disagreement is what nobody
 * could see.
 *
 * ## The invariant is OWNERSHIP, not age
 *
 * A first draft judged by time: an effort untouched since before the current process started cannot
 * be running. Sound, but it needs the DAEMON's start, and the sidecar exposes no such endpoint
 * (`/connections /efforts /nodes /notices /plugins /sessions /tasks` — measured).
 *
 * The same sidecar answers both halves directly:
 *
 *   GET /efforts  ->  what the daemon OWNS right now   (measured: [])
 *   GET /tasks    ->  what the graph STORES            (measured: stored=82)
 *
 * So a stored task in a non-terminal state whose id the daemon does not own is abandoned BY
 * CONSTRUCTION — direct evidence rather than an inference from clocks, with no process-start to
 * find and no timestamp to fail to parse.
 *
 * Design: `docs/superpowers/specs/2026-08-23-an-effort-nothing-will-finish-design.md`.
 */

/**
 * Terminal statuses, mirroring `is_terminal_effort_status` in
 * `packages/tractor/src/sidecar/mod.rs`. Kept as a list rather than "not one of the non-terminal
 * two" because the vocabulary has grown a retired member (`active`, which "read as in-progress but
 * consumers had no such state") and will grow again — an unknown word must read as NON-terminal,
 * which is the safe direction: it is then judged by ownership instead of silently counted finished.
 */
const TERMINAL = new Set(["done", "delivered", "partial", "failed", "timed-out", "cancelled"]);

/**
 * @typedef {{ id: string, status: string }} StoredTask
 * @typedef {"settled" | "owned" | "abandoned"} TaskVerdict
 */

/**
 * PURE. What can still be true of this stored task.
 *
 * @param {StoredTask} task
 * @param {ReadonlySet<string>} ownedIds ids the daemon reports as live efforts
 * @returns {TaskVerdict}
 */
export function classifyStoredTask(task, ownedIds) {
	if (TERMINAL.has(task?.status)) return "settled";
	return ownedIds.has(task?.id) ? "owned" : "abandoned";
}

/**
 * PURE. Every stored task in a non-terminal state that no live effort owns.
 *
 * @param {readonly StoredTask[]} stored
 * @param {readonly string[]} liveEffortIds
 * @returns {StoredTask[]}
 */
export function abandonedTasks(stored, liveEffortIds) {
	const owned = new Set(liveEffortIds ?? []);
	return (stored ?? []).filter((task) => classifyStoredTask(task, owned) === "abandoned");
}

/**
 * PURE. The fact, when a node is carrying work nothing will finish.
 *
 * SILENT WHEN THERE IS NOTHING TO SAY. And silent when the live set could not be read at all
 * (`null`), which matters more than it looks: without knowing what the daemon owns there is no
 * invariant, and treating every non-terminal task as abandoned would condemn the ones running.
 *
 * REPORTS, NEVER REWRITES. The stuck record is not transitioned to `failed` here or anywhere — it
 * is the operator's record of work really attempted, and a history edited so it reads tidy is what
 * ISS-121 refused the same day.
 *
 * Names no CLI verb — the handoff belongs where every other one is rendered.
 *
 * @param {readonly StoredTask[]} stored
 * @param {readonly string[] | null} liveEffortIds null ⇒ the daemon could not be asked
 * @returns {string | null}
 */
export function describeAbandonedTasks(stored, liveEffortIds) {
	if (liveEffortIds === null || liveEffortIds === undefined) return null;
	const abandoned = abandonedTasks(stored, liveEffortIds);
	if (abandoned.length === 0) return null;
	return (
		`${abandoned.length} stored task(s) are in a non-terminal state and no live effort owns ` +
		`them, so nothing is going to finish them — the first is ${abandoned[0]?.id}. They are kept ` +
		"as a record of work really attempted, not swept."
	);
}
