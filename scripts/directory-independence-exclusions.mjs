/**
 * Commands deliberately outside `scripts/directory-independence.mjs`'s reach, and why.
 *
 * THREE RESPONSIBILITIES, KEPT APART ON PURPOSE:
 *
 *  1. DERIVED exclusions live in the coverage test, not here: a leaf command with no `--json`
 *     option, or one that requires a positional argument the probe has no fixture for, is excluded
 *     by reading the Commander tree on every run. Those cannot rot — the day someone adds `--json`
 *     to such a command, or drops its required argument, the test demands a decision.
 *  2. DECLARED exclusions are this file: a command the probe COULD run and deliberately does not.
 *     Each names a category, and each category carries one written reason below rather than the
 *     same sentence copied 49 times.
 *  3. `not-yet-probed` is neither. It is the honest bucket for a read-only command that SHOULD be
 *     probed and has not been declared a scope yet — and it is RATCHETED: the coverage test fails
 *     if it grows. A new command may be excluded as mutating; it may not join the backlog.
 *
 * The point of the whole mechanism is that the probe reached 5-of-64 coverage with nobody choosing
 * it. Silence is how that happens, so silence is what this file removes.
 */

/** One written reason per category, rather than the same sentence repeated per entry. */
export const EXCLUSION_CATEGORIES = Object.freeze({
	mutates:
		"Writes state. The probe runs every command once per directory PLUS a control run, so a mutating entry would write to the operator's real node four times per invocation.",
	network:
		"Reaches an external service. Its answer would vary with the network rather than the directory, and probing it would make an outbound call four times per run.",
	interactive:
		"Needs a TTY or runs until interrupted (a server, a REPL, a guide). There is no single JSON answer to compare.",
	expensive:
		"Runs a build or a full lint. Correct to exclude on cost alone: four invocations per probe run would make the instrument too slow to run often, and an instrument nobody runs measures nothing.",
	"no-fixture":
		"Cannot produce a comparable answer in this environment — it needs the sandbox node running, a language server, or an armed intention. It would report `unproven` on every run, which is noise rather than signal.",
	"writes-on-read":
		"Looks read-only and is not. CURRENTLY UNUSED: its only instance was `refarm task list`, which rewrote ~/.refarm/sessions/task-session.v1.json on every read until ISS-091 moved that behind an explicit --refresh. The category stays because the defect CLASS is real and was invisible until an instrument ran the command four times per pass — a future one should be filed here rather than under `mutates`, which would hide that a LIST command writes.",
	"not-yet-probed":
		"A read-only candidate that SHOULD be probed and has not been given a scope and a reason yet. Ratcheted by the coverage test: this list may shrink, never grow.",
});

/** The declared exclusions. `category` must be a key of EXCLUSION_CATEGORIES. */
export const PROBE_EXCLUSIONS = Object.freeze([
	// --- mutates ---
	{ argv: ["agent", "doctor"], category: "mutates" },
	{ argv: ["agent", "finish"], category: "mutates" },
	{ argv: ["agent-respond"], category: "mutates" },
	{ argv: ["auth", "enroll"], category: "mutates" },
	{ argv: ["auth", "revoke"], category: "mutates" },
	{ argv: ["cert", "issue"], category: "mutates" },
	{ argv: ["cert", "trust", "browser"], category: "mutates" },
	{ argv: ["cert", "trust", "system"], category: "mutates" },
	{ argv: ["code-ops-move-symbol"], category: "mutates" },
	{ argv: ["code-ops-rename-symbol"], category: "mutates" },
	{ argv: ["config", "spawn-env", "unset"], category: "mutates" },
	{ argv: ["configure", "github"], category: "mutates" },
	{ argv: ["delivery", "add"], category: "mutates" },
	{ argv: ["delivery", "route"], category: "mutates" },
	{ argv: ["deploy"], category: "mutates" },
	{ argv: ["discover", "announce"], category: "mutates" },
	{ argv: ["dist", "publish"], category: "mutates" },
	{ argv: ["health", "apply-policy"], category: "mutates" },
	{ argv: ["inspect", "export"], category: "mutates" },
	{ argv: ["intention", "arm"], category: "mutates" },
	{ argv: ["intention", "consume"], category: "mutates" },
	{ argv: ["intention", "prepare"], category: "mutates" },
	{ argv: ["issues", "add"], category: "mutates" },
	{ argv: ["issues", "set-axis"], category: "mutates" },
	{ argv: ["issues", "edit"], category: "mutates" },
	{ argv: ["issues", "set-requirement"], category: "mutates" },
	{ argv: ["requirements", "set-maturity"], category: "mutates" },
	{ argv: ["issues", "set-status"], category: "mutates" },
	{ argv: ["migrate"], category: "mutates" },
	{ argv: ["model", "reset"], category: "mutates" },
	{ argv: ["plugin", "install"], category: "mutates" },
	{ argv: ["plugin", "reload"], category: "mutates" },
	{ argv: ["plugin", "update"], category: "mutates" },
	{ argv: ["process", "add"], category: "mutates" },
	{ argv: ["process", "linger"], category: "mutates" },
	{ argv: ["project", "automations", "add"], category: "mutates" },
	{ argv: ["project", "automations", "set-status"], category: "mutates" },
	{ argv: ["project", "automations", "tick"], category: "mutates" },
	{ argv: ["project", "handoff", "write"], category: "mutates" },
	{ argv: ["provision", "cloudflare", "turbo-cache"], category: "mutates" },
	{ argv: ["records", "enrich"], category: "mutates" },
	{ argv: ["runtime", "ensure"], category: "mutates" },
	{ argv: ["runtime", "restart"], category: "mutates" },
	{ argv: ["runtime", "start"], category: "mutates" },
	{ argv: ["runtime", "stop"], category: "mutates" },
	{ argv: ["sessions", "clear"], category: "mutates" },
	{ argv: ["sessions", "new"], category: "mutates" },
	{ argv: ["sow"], category: "mutates" },
	{ argv: ["surface", "add"], category: "mutates" },
	{ argv: ["task", "resume"], category: "mutates" },
	{ argv: ["tidy", "imports"], category: "mutates" },
	{ argv: ["workspace", "add"], category: "mutates" },
	{ argv: ["workspace", "sources", "materialize"], category: "mutates" },
	{ argv: ["workspace", "sources", "refresh"], category: "mutates" },
	// --- network ---
	{ argv: ["auth", "verify"], category: "network" },
	{ argv: ["cert", "providers"], category: "network" },
	{ argv: ["source", "discover"], category: "network" },
	// --- interactive ---
	{ argv: ["guide"], category: "interactive" },
	{ argv: ["serve"], category: "interactive" },
	{ argv: ["tui"], category: "interactive" },
	// --- expensive ---
	{ argv: ["lint"], category: "expensive" },
	{ argv: ["release", "gates"], category: "expensive" },
	{ argv: ["release", "preflight"], category: "expensive" },
	// --- no-fixture ---
	{ argv: ["code-ops-find-references"], category: "no-fixture" },
	{ argv: ["intention", "check"], category: "no-fixture" },
	{ argv: ["parity"], category: "no-fixture" },
	{ argv: ["telemetry"], category: "no-fixture" },
	// --- not-yet-probed ---
]);

/**
 * The `not-yet-probed` ratchet. Lower it when a command graduates into PROBE_COMMANDS; the coverage
 * test fails if the real count exceeds it. Same discipline as
 * `scripts/no-os-resolution.mjs`'s BASELINE_MAX_OFFENDING_SITES: the number goes down, or the change
 * is wrong.
 */
export const NOT_YET_PROBED_CEILING = 0;
