/**
 * process:v1 — refarm owns the DECLARATION; the host may own the ACT.
 *
 * Design: `docs/superpowers/specs/2026-07-30-declared-processes-design.md`.
 *
 * WHAT FORCED THIS. `refarm web serve` — the mesh distribution server a phone bootstraps from — ran
 * under a `nohup`'d shell. The operator rebooted; it went away, the runtime went away, and NOTHING
 * said so. `refarm runtime status` did not know the server existed. A device running `farm-update`
 * in that window failed with no explanation. refarm owned a long-running process and supervised
 * none of it.
 *
 * The three properties this block exists to hold:
 *
 *  1. **The catalog is DECLARED** (W1), beside `connections`, `surfaces` and `delivery`, under the
 *     `processes` key of `.refarm/config.json`. Command, restart policy and stop timeout are the
 *     operator's data, not a backend's configuration language.
 *  2. **The supervision ACT may be borrowed.** Every host already ships a supervisor — `systemd
 *     --user`, `launchd`, runit under termux-services. Detection decides *how* a declared intent is
 *     satisfied; it never decides *what* the operator wanted. {@link resolveSupervisionBackend} is
 *     that, and nothing else.
 *  3. **A service is an END, not a MEANS** (W4). This block deliberately shares no vocabulary with
 *     `connections`: no claim, no release, no "interested parties". A connection is opened so
 *     something else can happen; a service exists to answer. Folding the second into the first
 *     inherits a lifetime model that does not apply.
 *
 * Zero runtime dependencies and no I/O — every rule below is a total function over plain data, so
 * the refusals can be tested without a config file, a supervisor, or a machine that has one.
 */

export const PROCESS_CAPABILITY = "process:v1" as const;

// ── The declaration ───────────────────────────────────────────────────────────

/**
 * Does this process come back?
 *
 * - `always`     — restart it whatever happened, including a clean exit. What a server wants.
 * - `on-failure` — restart only on a non-zero exit or a signal. What a job that can legitimately
 *                  finish wants.
 * - `never`      — start it once; when it ends, it ends.
 *
 * REQUIRED in a declaration, never defaulted. Whether something comes back after it dies is the
 * single most consequential thing about supervising it, and it is not refarm's to guess — the same
 * posture `delivery`'s `unattended` takes for "does this reach me when I am not looking".
 */
export type RestartPolicy = "always" | "on-failure" | "never";

const RESTART_POLICIES: readonly RestartPolicy[] = ["always", "on-failure", "never"];

/** One declared process, exactly as the operator wrote it. */
export interface ProcessDeclaration {
	/** Catalog key — how the operator refers to it, and the stem of the unit's filename. */
	readonly name: string;
	/** What it is FOR, in the operator's words. Ends up in the unit's Description. */
	readonly description: string;
	/**
	 * The command as an ARGV, never a shell line.
	 *
	 * A string would have to be split by somebody, and every splitter is a quoting bug and a shell
	 * injection waiting for a filename with a space in it. Supervisors execute an argv directly
	 * (`systemd` without `/bin/sh -c`, `launchd`'s ProgramArguments), so the array is also the shape
	 * they actually want.
	 */
	readonly command: readonly string[];
	/** Where it runs. Absolute, or absent to mean "wherever the supervisor starts it". */
	readonly workingDirectory?: string;
	/** Plain, non-secret environment. See {@link INLINE_SECRET_KEYS}. */
	readonly environment: Readonly<Record<string, string>>;
	readonly restart: RestartPolicy;
	/**
	 * How long the supervisor waits after asking the process to stop, before killing it.
	 *
	 * This is where W1's "borrow the act" pays immediately. Neither the runtime nor `web serve`
	 * handles `SIGTERM` today, so today they die by `SIGKILL` at whatever moment. A supervisor with a
	 * stop timeout gives ORDERED termination regardless: it asks, it waits this long, then it kills.
	 * Adding signal handling to the processes themselves is a real improvement and a separate one —
	 * it makes the wait productive rather than making it exist.
	 */
	readonly stopTimeoutSeconds: number;
	/** Seconds to wait before restarting — the anti-hot-loop cooldown `respawn.rs` already argues for. */
	readonly restartDelaySeconds: number;
	/**
	 * Run it ON A CLOCK, every this many seconds, instead of keeping it up.
	 *
	 * ABSENT IS THE ORIGINAL MEANING and stays it: a declaration with no `everySeconds` is a
	 * long-running process, supervised exactly as before. Present, the process becomes periodic —
	 * it runs, it exits, and the supervisor runs it again.
	 *
	 * The customer that forced it is the automation tick (ISS-066). A complete cron evaluator, a
	 * fire-once ledger and a host command all existed; NOTHING CALLED THEM ON A CLOCK, so a
	 * declared automation was evaluated only when a human happened to type the command. The
	 * supervisor this node already trusts for `web serve` knows how to do that, and borrowing it
	 * costs one field.
	 *
	 * IT IS AN INTERVAL, NOT A SCHEDULE, and the distinction is load-bearing. Cron already lives
	 * one layer up, in the automations themselves; a second scheduling vocabulary here would mean
	 * two places to look when something fires at the wrong hour, and two parsers to keep agreeing.
	 * What this says is only how often the evaluator gets ASKED.
	 */
	readonly everySeconds?: number;
}

export type ProcessCatalog = ReadonlyMap<string, ProcessDeclaration>;

export class ProcessDeclarationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProcessDeclarationError";
	}
}

/** A bound, so a malformed or hostile config cannot make refarm write unboundedly many units. */
export const MAX_DECLARED_PROCESSES = 16;

export const DEFAULT_STOP_TIMEOUT_SECONDS = 20;
export const MAX_STOP_TIMEOUT_SECONDS = 900;
export const DEFAULT_RESTART_DELAY_SECONDS = 5;

/**
 * The tightest and loosest interval a periodic declaration may ask for.
 *
 * The floor is 10s because a supervisor asked to run something every second spends more on
 * starting a process than on the work. The ceiling is a day: past that the thing being described
 * is a calendar event, not an interval, and `everySeconds` would be the wrong word for it.
 */
export const MIN_EVERY_SECONDS = 10;
export const MAX_EVERY_SECONDS = 86_400;
export const MAX_RESTART_DELAY_SECONDS = 3600;

/**
 * A process name becomes a FILENAME on the operator's machine. So it is constrained to what is
 * safely a filename everywhere, and the refusal names the offending process rather than the file it
 * would have written: `processes."../../etc/passwd"` is a config bug, not a path bug.
 */
const PROCESS_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_PROCESS_NAME_LEN = 64;

/**
 * A declaration NAMES where a secret comes from; it never contains one — `delivery`'s rule, applied
 * to a block that would otherwise write the operator's tokens into a unit file that is world-
 * readable, quoted by `systemctl cat`, and printed by every diagnostic.
 */
const INLINE_SECRET_KEYS: readonly string[] = [
	"TOKEN",
	"SECRET",
	"PASSWORD",
	"APIKEY",
	"API_KEY",
	"CREDENTIAL",
	"CREDENTIALS",
	"PRIVATE_KEY",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
	return Array.isArray(value) ? "an array" : value === null ? "null" : typeof value;
}

/**
 * Parse the `processes` block of `.refarm/config.json`.
 *
 * FAIL-SHUT, on the `parseSurfaces` / `parseDeliveryCatalog` model: an ABSENT block is the closed
 * default — an undeclared process does not exist and refarm does not go looking for one — while a
 * block that is PRESENT and malformed THROWS, naming the process. Silently supervising a
 * subtly-different thing than what was written is worse than supervising nothing, because the
 * operator would believe the declaration took.
 *
 * The Rust host needs to learn NOTHING for this key to exist. `refarm_config_json_from` parses the
 * file into an untyped `serde_json::Value` and each consumer reads its own key; there is no
 * top-level allowlist to extend. A new catalog is a TypeScript-side addition, which is exactly what
 * the `delivery` slice established.
 */
export function parseProcessCatalog(config: unknown): ProcessCatalog {
	const catalog = new Map<string, ProcessDeclaration>();
	if (!isRecord(config)) return catalog;
	const block = config.processes;
	if (block === undefined || block === null) return catalog;
	if (!isRecord(block)) {
		throw new ProcessDeclarationError(
			`processes: expected an object of declared processes, got ${typeName(block)}`,
		);
	}

	const names = Object.keys(block);
	if (names.length > MAX_DECLARED_PROCESSES) {
		throw new ProcessDeclarationError(
			`processes: ${names.length} processes declared, at most ${MAX_DECLARED_PROCESSES} are allowed`,
		);
	}
	for (const name of names) {
		catalog.set(name, parseOneProcess(name, block[name]));
	}
	return catalog;
}

function parseOneProcess(name: string, raw: unknown): ProcessDeclaration {
	if (!PROCESS_NAME_PATTERN.test(name) || name.length > MAX_PROCESS_NAME_LEN) {
		throw new ProcessDeclarationError(
			`processes."${name.slice(0, MAX_PROCESS_NAME_LEN)}": a process name must be lowercase ` +
				`letters, digits, "-", "_" or ".", start with a letter or digit, and be at most ` +
				`${MAX_PROCESS_NAME_LEN} characters — it becomes a filename on your machine`,
		);
	}
	if (!isRecord(raw)) {
		throw new ProcessDeclarationError(
			`processes."${name}": expected an object, got ${typeName(raw)}`,
		);
	}

	const command = parseCommand(name, raw.command);
	const description = parseDescription(name, raw.description);
	const environment = parseEnvironment(name, raw.environment);

	if (raw.restart === undefined) {
		throw new ProcessDeclarationError(
			`processes."${name}": "restart" must be declared as ${RESTART_POLICIES.map((p) => `"${p}"`).join(", ")} — ` +
				`whether this comes back after it dies is not something refarm may guess`,
		);
	}
	if (typeof raw.restart !== "string" || !RESTART_POLICIES.includes(raw.restart as RestartPolicy)) {
		throw new ProcessDeclarationError(
			`processes."${name}": "restart" must be one of ${RESTART_POLICIES.map((p) => `"${p}"`).join(", ")} ` +
				`(got ${JSON.stringify(raw.restart)})`,
		);
	}

	const workingDirectory = parseWorkingDirectory(name, raw.workingDirectory);
	const everySeconds = parseEverySeconds(name, raw.everySeconds, raw.restart);

	return {
		name,
		description,
		command,
		...(workingDirectory ? { workingDirectory } : {}),
		environment,
		restart: raw.restart as RestartPolicy,
		stopTimeoutSeconds: parseSeconds(
			name,
			"stopTimeoutSeconds",
			raw.stopTimeoutSeconds,
			DEFAULT_STOP_TIMEOUT_SECONDS,
			MAX_STOP_TIMEOUT_SECONDS,
		),
		restartDelaySeconds: parseSeconds(
			name,
			"restartDelaySeconds",
			raw.restartDelaySeconds,
			DEFAULT_RESTART_DELAY_SECONDS,
			MAX_RESTART_DELAY_SECONDS,
		),
		...(everySeconds === undefined ? {} : { everySeconds }),
	};
}

/**
 * PURE. The interval, or `undefined` for a long-running process.
 *
 * REFUSES `restart: "always"` BESIDE IT rather than picking one. "Bring it back whenever it dies"
 * and "run it every N seconds" are two different instructions about the same process, and a
 * supervisor given both would restart the periodic run the instant it finished — a hot loop
 * wearing a schedule's clothes. Declaring both is a mistake about what is being described, so it
 * is named as one here, where the operator is still looking at the declaration.
 */
export function parseEverySeconds(
	name: string,
	raw: unknown,
	restart: unknown,
): number | undefined {
	if (raw === undefined) return undefined;
	if (typeof raw !== "number" || !Number.isInteger(raw)) {
		throw new ProcessDeclarationError(
			`processes."${name}": "everySeconds" must be a whole number of seconds (got ${JSON.stringify(raw)})`,
		);
	}
	if (raw < MIN_EVERY_SECONDS || raw > MAX_EVERY_SECONDS) {
		throw new ProcessDeclarationError(
			`processes."${name}": "everySeconds" must be between ${MIN_EVERY_SECONDS} and ` +
				`${MAX_EVERY_SECONDS} (got ${raw}). Below the floor a supervisor spends more on starting ` +
				`the process than on the work; above the ceiling you are describing a calendar event, ` +
				`not an interval.`,
		);
	}
	if (restart === "always") {
		throw new ProcessDeclarationError(
			`processes."${name}": "everySeconds" and "restart": "always" are two different ` +
				`instructions about the same process — one says bring it back whenever it dies, the ` +
				`other says run it every ${raw}s. A supervisor given both restarts the periodic run the ` +
				`instant it finishes. Use "never" (or "on-failure" to retry a failed run).`,
		);
	}
	return raw;
}

function parseCommand(name: string, raw: unknown): readonly string[] {
	if (typeof raw === "string") {
		throw new ProcessDeclarationError(
			// The example teaches the SHAPE — array, not shell line — and the binary in it is
			// incidental, so it does not name one. Threading a `binary` through a pure parser to
			// print one example would be paying a parameter for nothing (ADR-087, ISS-114).
			`processes."${name}": "command" must be an ARRAY of arguments, not a shell line — ` +
				`["my-app", "web", "serve", "."] rather than "my-app web serve ."`,
		);
	}
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new ProcessDeclarationError(
			`processes."${name}": "command" must be a non-empty array of arguments`,
		);
	}
	const argv: string[] = [];
	for (const [index, value] of raw.entries()) {
		if (typeof value !== "string" || !value.trim()) {
			throw new ProcessDeclarationError(
				`processes."${name}": command[${index}] must be a non-empty string (got ${typeName(value)})`,
			);
		}
		if (/[\n\r\0]/.test(value)) {
			throw new ProcessDeclarationError(
				`processes."${name}": command[${index}] contains a newline or NUL — a unit file is ` +
					`line-oriented and an argument that spans lines would silently become a different command`,
			);
		}
		argv.push(value);
	}
	return Object.freeze(argv);
}

function parseDescription(name: string, raw: unknown): string {
	if (raw === undefined) return name;
	if (typeof raw !== "string" || !raw.trim()) {
		throw new ProcessDeclarationError(
			`processes."${name}": "description" must be a non-empty string when present`,
		);
	}
	if (/[\n\r]/.test(raw)) {
		throw new ProcessDeclarationError(
			`processes."${name}": "description" must be a single line — it becomes one line of a unit file`,
		);
	}
	return raw.trim();
}

function parseWorkingDirectory(name: string, raw: unknown): string | undefined {
	if (raw === undefined) return undefined;
	if (typeof raw !== "string" || !raw.trim()) {
		throw new ProcessDeclarationError(
			`processes."${name}": "workingDirectory" must be a non-empty path when present`,
		);
	}
	if (!raw.startsWith("/")) {
		throw new ProcessDeclarationError(
			`processes."${name}": "workingDirectory" must be ABSOLUTE — a supervisor starts this from ` +
				`its own directory, not from wherever you happened to type the command`,
		);
	}
	return raw.trim();
}

function parseEnvironment(name: string, raw: unknown): Readonly<Record<string, string>> {
	if (raw === undefined || raw === null) return Object.freeze({});
	if (!isRecord(raw)) {
		throw new ProcessDeclarationError(
			`processes."${name}": "environment" must be an object of NAME: value pairs, got ${typeName(raw)}`,
		);
	}
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		const upper = key.toUpperCase();
		if (INLINE_SECRET_KEYS.some((secret) => upper === secret || upper.endsWith(`_${secret}`))) {
			throw new ProcessDeclarationError(
				`processes."${name}": environment."${key}" looks like a secret and must not appear here — ` +
					`a unit file is world-readable and is printed verbatim by \`systemctl cat\`. Point the ` +
					`process at a file it reads itself.`,
			);
		}
		if (typeof value !== "string") {
			throw new ProcessDeclarationError(
				`processes."${name}": environment."${key}" must be a string (got ${typeName(value)})`,
			);
		}
		if (/[\n\r\0]/.test(value)) {
			throw new ProcessDeclarationError(
				`processes."${name}": environment."${key}" contains a newline or NUL`,
			);
		}
		env[key] = value;
	}
	return Object.freeze(env);
}

function parseSeconds(
	name: string,
	key: string,
	raw: unknown,
	fallback: number,
	max: number,
): number {
	if (raw === undefined) return fallback;
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > max) {
		throw new ProcessDeclarationError(
			`processes."${name}": "${key}" must be a whole number of seconds between 0 and ${max} ` +
				`(got ${JSON.stringify(raw)})`,
		);
	}
	return raw;
}

// ── The three-way answer ──────────────────────────────────────────────────────

/**
 * What refarm knows about one process, and it is FOUR values because collapsing any of them is a
 * lie the operator pays for later:
 *
 * - `running`       — the supervisor was asked and said yes.
 * - `not-running`   — the supervisor was asked and said no. A real verdict.
 * - `not-declared`  — nothing was ever asked, because the operator declared no such process.
 *                     Silence by consent, not a failure.
 * - `could-not-ask` — no verdict ever came back: there is no supervisor here, the probe failed, the
 *                     command is missing. refarm does not know whether it is up, and says so.
 *
 * This is the same distinction `DeliveryStatus` makes (`refused` vs `could-not-attempt`) and the
 * same one the runtime's `down` vs `unknown` makes. "I asked and was told no" and "I never got to
 * ask" lead an operator to entirely different fixes.
 */
export type ProcessLiveness =
	| "running"
	| "failed"
	| "not-running"
	| "not-declared"
	| "could-not-ask";

export interface ProcessStatus {
	name: string;
	state: ProcessLiveness;
	/** Operator-facing prose. Never a credential — a unit's environment is echoed by `systemctl`. */
	detail: string;
	/** Which supervisor answered, or `null` when nothing did. */
	backend: string | null;
	/**
	 * Is a unit/job actually installed for this declaration?
	 *
	 * `null` when nobody could be asked — "declared but never installed" and "could not find out"
	 * are, once more, different facts.
	 */
	supervised: boolean | null;
}

export function processRunning(name: string, backend: string, detail: string): ProcessStatus {
	return { name, state: "running", detail, backend, supervised: true };
}

export function processNotRunning(
	name: string,
	backend: string,
	detail: string,
	supervised = true,
): ProcessStatus {
	return { name, state: "not-running", detail, backend, supervised };
}

/**
 * IT TRIED AND IT COULD NOT. The state this contract was missing.
 *
 * MEASURED 2026-08-22: on the operator's node `refarm-credential-renew` failed 4420 times across
 * 33 hours and `refarm-web-serve` gave up after six restarts, and the only verdict either could
 * receive was `not-running` — the same word this file gives to a unit the operator stopped, to one
 * that was never installed, and to a oneshot that finished cleanly. Nothing led with it, because
 * nothing could tell it apart from the ordinary.
 *
 * `supervised: true` is not a formality. A failed unit HAS a unit file and a journal entry that
 * explains itself, which is exactly what makes this state actionable where `not-running` is not.
 */
export function processFailed(name: string, backend: string, detail: string): ProcessStatus {
	return { name, state: "failed", detail, backend, supervised: true };
}

export function processNotDeclared(name: string): ProcessStatus {
	return {
		name,
		state: "not-declared",
		detail: `"${name}" is not declared under "processes" in .refarm/config.json`,
		backend: null,
		supervised: null,
	};
}

export function processCouldNotAsk(
	name: string,
	detail: string,
	backend: string | null = null,
): ProcessStatus {
	return { name, state: "could-not-ask", detail, backend, supervised: null };
}

/** True only when refarm was TOLD it is up. The one status that qualifies. */
export function processIsKnownUp(status: ProcessStatus): boolean {
	return status.state === "running";
}

/** One line an operator reads. Names every case; collapses none. */
export function describeProcessStatus(status: ProcessStatus): string {
	switch (status.state) {
		case "running":
			return `${status.name}: up (${status.backend}) — ${status.detail}`;
		case "failed":
			return `${status.name}: FAILED (${status.backend}) — ${status.detail}`;
		case "not-running":
			return `${status.name}: DOWN (${status.backend}) — ${status.detail}`;
		case "not-declared":
			return `${status.name}: not declared — ${status.detail}`;
		case "could-not-ask":
			return `${status.name}: unknown, could not ask — ${status.detail}`;
	}
}

// ── W1 — the borrowed act ─────────────────────────────────────────────────────

/** Why a supervision backend cannot be used here, and what would fix it. */
export interface SupervisionReadiness {
	ready: boolean;
	detail: string;
	/** Present when `ready` is false: the concrete thing the operator would do. */
	fix?: string;
}

/**
 * A supervisor refarm can borrow.
 *
 * `plan` returns the operation to PROPOSE (W2) rather than performing anything: a backend never
 * writes to the operator's machine on its own, because a write to their machine goes through
 * consent, and consent is the caller's journey to run.
 */
export interface SupervisionBackend<TOperation = unknown> {
	readonly id: string;
	readonly title: string;
	/** What lifetime this backend actually delivers, stated for THIS host (W3). */
	describeLifetime(): Promise<string>;
	preflight(): Promise<SupervisionReadiness>;
	status(declaration: ProcessDeclaration): Promise<ProcessStatus>;
	plan(declaration: ProcessDeclaration): Promise<TOperation>;
}

export class SupervisionRefusal extends Error {
	readonly reason: string;
	readonly fix: string;
	constructor(reason: string, message: string, fix: string) {
		super(message);
		this.name = "SupervisionRefusal";
		this.reason = reason;
		this.fix = fix;
	}
}

/**
 * Pick the backend that can satisfy a declaration on THIS host.
 *
 * Detection used correctly (W1): it decides HOW to satisfy what the operator declared, never WHAT
 * they wanted. Order is preference order, and a host with none of them gets a refusal that NAMES
 * the fix rather than a crash — that host exists (Termux has no systemd), and W5's tractor fallback
 * is what eventually registers here. Until it does, saying "there is no supervisor here, and here
 * is what you would do instead" is the honest answer.
 */
export async function resolveSupervisionBackend<T>(
	backends: readonly SupervisionBackend<T>[],
): Promise<SupervisionBackend<T>> {
	const rejected: string[] = [];
	for (const backend of backends) {
		const readiness = await backend.preflight();
		if (readiness.ready) return backend;
		rejected.push(
			`${backend.id}: ${readiness.detail}${readiness.fix ? ` → ${readiness.fix}` : ""}`,
		);
	}
	throw new SupervisionRefusal(
		"no-supervisor",
		`processes: no supervisor on this host can be borrowed${rejected.length ? ` (${rejected.join("; ")})` : ""}`,
		rejected.length
			? `Fix one of the above, or run the command yourself — a declared process without a ` +
					`supervisor is still a command you can start by hand.`
			: `No supervision backend is registered for this platform. Start the command yourself ` +
					`until a backend for it exists.`,
	);
}
