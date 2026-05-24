import chalk from "chalk";
import { Command } from "commander";

import { printJson } from "./json-output.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";
import { findSessionIdPrefixMatches, formatSessionId } from "./session-ids.js";
import {
	clearActiveSessionId,
	readActiveSessionId,
	writeActiveSessionIdAndVerify,
} from "./session-lock.js";
import { reportSidecarError } from "./sidecar-error.js";
import { sidecarUrl } from "./sidecar-url.js";

interface SessionNode {
	"@id": string;
	"@type": string;
	name?: string;
	created_at_ns?: number;
	leaf_entry_id?: string | null;
	parent_session_id?: string | null;
}

interface HistoryEntry {
	id: string;
	kind: string;
	content: string;
	timestamp_ns: number;
}

interface SessionHistory {
	session: SessionNode;
	entries: HistoryEntry[];
	total: number;
}

interface SessionListReport {
	activeSessionId: string | null;
	sessions: SessionNode[];
}

interface ActiveSessionReport {
	action: "created" | "switched" | "cleared";
	activeSessionId: string | null;
	session?: SessionNode;
	cleared?: boolean;
}

interface SessionForkReport {
	action: "forked";
	activeSessionId: string;
	session: SessionNode;
	parentSessionId: string;
	branchEntryId?: string;
}

function writeActiveSessionOrReport(
	targetSessionId: string,
	opts: { json?: boolean } = {},
): boolean {
	try {
		writeActiveSessionIdAndVerify(targetSessionId);
		return true;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (opts.json) {
			printJson({
				action: "sessions",
				ok: false,
				error: "active-session-write-failed",
				message,
				targetSessionId,
				nextAction: "refarm sessions list --json",
				nextActions: ["refarm sessions list --json", RUNTIME_DOCTOR_COMMAND],
			});
			process.exitCode = 1;
			return false;
		}
		console.error(chalk.red(`✗  ${message}`));
		process.exitCode = 1;
		return false;
	}
}

function printSessionPrefixError(
	kind: "not-found" | "ambiguous",
	prefix: string,
	matches: string[] = [],
	opts: { json?: boolean } = {},
): void {
	if (opts.json) {
		printJson({
			action: "sessions",
			ok: false,
			error: kind === "not-found" ? "session-not-found" : "ambiguous-session-prefix",
			prefix,
			matches,
			nextAction: "refarm sessions list --json",
			nextActions: ["refarm sessions list --json"],
		});
		process.exitCode = 1;
		return;
	}
	if (kind === "not-found") {
		console.error(chalk.red(`✗  No session matching "${prefix}"`));
	} else {
		console.error(
			chalk.red(
				`✗  Ambiguous prefix "${prefix}" — matches ${matches.length} sessions:`,
			),
		);
		for (const m of matches) console.error(chalk.dim(`   ${m}`));
	}
	process.exitCode = 1;
}

function formatAge(createdAtNs: number | undefined): string {
	if (!createdAtNs) return "";
	const ageMs = Date.now() - createdAtNs / 1_000_000;
	const mins = Math.floor(ageMs / 60_000);
	const hours = Math.floor(mins / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ago`;
	if (hours > 0) return `${hours}h ago`;
	if (mins > 0) return `${mins}m ago`;
	return "just now";
}

export function createSessionsCommand(): Command {
	return new Command("sessions")
		.description("List and manage conversation sessions")
		.option("--json", "Output machine-readable session list")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm sessions",
				"  $ refarm sessions --json",
				"  $ refarm sessions new --name planning",
				"  $ refarm sessions use <id-prefix>",
				"  $ refarm sessions show <id-prefix>",
				"  $ refarm sessions fork <id-prefix> --name experiment",
				"",
				"Notes:",
				"  Sessions are stored in the active Refarm runtime.",
				`  If sessions are unavailable, run ${RUNTIME_STATUS_COMMAND}, then ${RUNTIME_START_WAIT_COMMAND}.`,
				`  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for the shortest recovery step.`,
				`  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.`,
				"  Prefixes must be unique; list sessions first when a prefix is ambiguous.",
				"  Use refarm ask --new for a one-shot fresh session without naming it.",
			].join("\n"),
		)
		.addCommand(
			new Command("list")
				.description("List recent sessions (default)")
				.option("--json", "Output machine-readable session list")
				.action(async (opts: { json?: boolean }) => {
					await listSessions({ json: opts.json });
				}),
		)
		.addCommand(
			new Command("use")
				.description("Switch to a session by ID prefix")
				.argument("<id>", "Session ID or unique prefix")
				.option("--json", "Output machine-readable active session update")
				.action(async (prefix: string, opts: { json?: boolean }) => {
					await useSession(prefix, { json: opts.json });
				}),
		)
		.addCommand(
			new Command("new")
				.description("Create a new session and switch to it")
				.option("--name <name>", "Optional session name")
				.option("--json", "Output machine-readable created session metadata")
				.action(async (opts: { name?: string; json?: boolean }) => {
					await createSession(opts);
				}),
		)
		.addCommand(
			new Command("show")
				.description("Show conversation history for a session")
				.argument("<id>", "Session ID or unique prefix")
				.option("--json", "Output machine-readable session history")
				.action(async (prefix: string, opts: { json?: boolean }) => {
					await showSession(prefix, { json: opts.json });
				}),
		)
		.addCommand(
			new Command("fork")
				.description(
					"Branch a new session from an existing one (Loro-style fork)",
				)
				.argument("<id>", "Session ID or unique prefix to branch from")
				.option(
					"--at <entry-id>",
					"Branch from a specific entry instead of the current leaf",
				)
				.option("--name <name>", "Name for the new forked session")
				.option("--json", "Output machine-readable fork result")
				.action(
					async (prefix: string, opts: { at?: string; name?: string; json?: boolean }) => {
						await forkSession(prefix, opts);
					},
				),
		)
		.addCommand(
			new Command("clear")
				.description("Clear the active session (next ask starts fresh)")
				.option("--json", "Output machine-readable clear result")
				.action((opts: { json?: boolean }) => {
					const cleared = clearActiveSessionId();
					if (opts.json) {
						const report: ActiveSessionReport = {
							action: "cleared",
							activeSessionId: null,
							cleared,
						};
						printJson(report);
						return;
					}
					if (cleared) {
						console.log(chalk.green("✓  Active session cleared."));
					} else {
						console.log(chalk.dim("No active session."));
					}
				}),
		)
		.action(async (opts: { json?: boolean }) => {
			// default action: list
			await listSessions({ json: opts.json });
		});
}

async function fetchSessions(): Promise<SessionNode[]> {
	const response = await fetch(sidecarUrl("/sessions"));
	if (!response.ok) {
		throw new Error(`sidecar HTTP ${response.status}`);
	}
	const body = (await response.json()) as { sessions: SessionNode[] };
	return body.sessions ?? [];
}

async function listSessions(opts: { json?: boolean } = {}): Promise<void> {
	const activeId = readActiveSessionId();

	let sessions: SessionNode[];
	try {
		sessions = await fetchSessions();
	} catch (err) {
		reportSidecarError(err);
		return;
	}

	const report: SessionListReport = {
		activeSessionId: activeId,
		sessions: [...sessions].sort(
			(a, b) => (b.created_at_ns ?? 0) - (a.created_at_ns ?? 0),
		),
	};
	if (opts.json) {
		printJson(report);
		return;
	}

	if (sessions.length === 0) {
		console.log(
			chalk.dim("No sessions yet. Start one with: refarm ask <query>"),
		);
		return;
	}

	// Sort newest first by created_at_ns
	sessions = report.sessions;

	console.log(chalk.bold(`\n  Sessions  (${sessions.length} total)\n`));

	for (const session of sessions) {
		const short = formatSessionId(session["@id"]);
		const age = formatAge(session.created_at_ns);
		const isActive = session["@id"] === activeId;
		const name = session.name
			? chalk.white(session.name)
			: chalk.dim("unnamed");
		const hasHistory = !!session.leaf_entry_id;

		const prefix = isActive ? chalk.green("▶") : " ";
		const idStr = isActive ? chalk.green.bold(short) : chalk.cyan(short);
		const ageStr = chalk.dim(age);
		const historyStr = hasHistory ? chalk.dim(" · has history") : "";

		console.log(`  ${prefix} ${idStr}  ${name}  ${ageStr}${historyStr}`);
	}

	if (activeId) {
		console.log(chalk.dim(`\n  Active: ${activeId}`));
	}
	console.log(
		chalk.dim(
			"\n  refarm sessions use <id-prefix>   switch session" +
				"\n  refarm sessions new               create and switch" +
				"\n  refarm ask --new                  start fresh\n",
		),
	);
}

async function createSession(opts: { name?: string; json?: boolean }): Promise<void> {
	let created: SessionNode;
	try {
		const body = opts.name ? { name: opts.name } : {};
		const response = await fetch(sidecarUrl("/sessions"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const parsed = (await response.json().catch(() => ({}))) as {
			session?: SessionNode;
			error?: string;
		};
		if (response.status === 404) {
			console.error(
				chalk.red(
					"✗  Session creation endpoint is unavailable in this daemon.",
				),
			);
			console.error(
				chalk.dim(
					`   Restart or update backend and retry: ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND}`,
				),
			);
			process.exitCode = 1;
			return;
		}
		if (!response.ok || !parsed.session) {
			console.error(
				chalk.red(`✗  ${parsed.error ?? `HTTP ${response.status}`}`),
			);
			process.exitCode = 1;
			return;
		}
		created = parsed.session;
	} catch (err) {
		reportSidecarError(err);
		return;
	}

	if (!writeActiveSessionOrReport(created["@id"], { json: opts.json })) return;
	if (opts.json) {
		const report: ActiveSessionReport = {
			action: "created",
			activeSessionId: created["@id"],
			session: created,
		};
		printJson(report);
		return;
	}
	const short = formatSessionId(created["@id"]);
	const name = created.name ? chalk.white(created.name) : chalk.dim("unnamed");
	console.log(
		chalk.green(
			`✓  Created session ${chalk.cyan.bold(short)}  ${name} (switched active session).`,
		),
	);
}

async function useSession(
	prefix: string,
	opts: { json?: boolean } = {},
): Promise<void> {
	let sessions: SessionNode[];
	try {
		sessions = await fetchSessions();
	} catch (err) {
		reportSidecarError(err);
		return;
	}

	const matches = findSessionIdPrefixMatches(prefix, sessions);

	if (matches.length === 0) {
		printSessionPrefixError("not-found", prefix, [], opts);
		return;
	}
	if (matches.length > 1) {
		printSessionPrefixError(
			"ambiguous",
			prefix,
			matches.map((match) => match["@id"]),
			opts,
		);
		return;
	}

	if (!writeActiveSessionOrReport(matches[0]!["@id"], { json: opts.json })) return;
	if (opts.json) {
		const report: ActiveSessionReport = {
			action: "switched",
			activeSessionId: matches[0]!["@id"],
			session: matches[0]!,
		};
		printJson(report);
		return;
	}
	console.log(
		chalk.green(`✓  Switched to session ${formatSessionId(matches[0]!["@id"])}`),
	);
}

async function forkSession(
	prefix: string,
	opts: { at?: string; name?: string; json?: boolean },
): Promise<void> {
	const body: Record<string, string> = {};
	if (opts.at) body["entry_id"] = opts.at;
	if (opts.name) body["name"] = opts.name;

	let fork: SessionNode;
	try {
		const response = await fetch(
			sidecarUrl(`/sessions/${encodeURIComponent(prefix)}/fork`),
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
		);
		const parsed = (await response.json()) as {
			session?: SessionNode;
			error?: string;
			matches?: string[];
		};
		if (response.status === 404) {
			printSessionPrefixError("not-found", prefix, [], { json: opts.json });
			return;
		}
		if (response.status === 409) {
			printSessionPrefixError("ambiguous", prefix, parsed.matches ?? [], {
				json: opts.json,
			});
			return;
		}
		if (!response.ok || !parsed.session) {
			if (opts.json) {
				printJson({
					action: "sessions",
					ok: false,
					error: "session-fork-failed",
					message: parsed.error ?? `HTTP ${response.status}`,
					prefix,
					nextAction: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
					nextActions: [RUNTIME_DOCTOR_NEXT_ACTION_COMMAND],
				});
				process.exitCode = 1;
				return;
			}
			console.error(
				chalk.red(`✗  ${parsed.error ?? `HTTP ${response.status}`}`),
			);
			process.exitCode = 1;
			return;
		}
		fork = parsed.session;
	} catch (err) {
		reportSidecarError(err);
		return;
	}

	// Auto-switch to the new fork.
	if (!writeActiveSessionOrReport(fork["@id"], { json: opts.json })) return;
	if (opts.json) {
		const report: SessionForkReport = {
			action: "forked",
			activeSessionId: fork["@id"],
			session: fork,
			parentSessionId: fork.parent_session_id ?? prefix,
			...(fork.leaf_entry_id ? { branchEntryId: fork.leaf_entry_id } : {}),
		};
		printJson(report);
		return;
	}
	const short = formatSessionId(fork["@id"]);
	const parentShort = formatSessionId(fork.parent_session_id ?? prefix);
	console.log(
		chalk.green(
			`✓  Forked from ${chalk.cyan(parentShort)} → new session ${chalk.cyan.bold(short)}`,
		),
	);
	if (fork.leaf_entry_id) {
		console.log(chalk.dim(`   Branch point: ${fork.leaf_entry_id}`));
	}
	console.log(chalk.dim("   Active session switched to the fork."));
}

async function showSession(
	prefix: string,
	opts: { json?: boolean } = {},
): Promise<void> {
	// Pass prefix directly — sidecar does exact-then-substring resolution.
	const encodedId = encodeURIComponent(prefix);
	let history: SessionHistory;
	try {
		const response = await fetch(
			sidecarUrl(`/sessions/${encodedId}/history`),
		);
		const body = (await response.json()) as SessionHistory & {
			error?: string;
			matches?: string[];
		};
		if (response.status === 404) {
			printSessionPrefixError("not-found", prefix, [], { json: opts.json });
			return;
		}
		if (response.status === 409) {
			printSessionPrefixError("ambiguous", prefix, body.matches ?? [], {
				json: opts.json,
			});
			return;
		}
		if (!response.ok) {
			if (opts.json) {
				printJson({
					action: "sessions",
					ok: false,
					error: "session-history-failed",
					message: body.error ?? `HTTP ${response.status}`,
					prefix,
					nextAction: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
					nextActions: [RUNTIME_DOCTOR_NEXT_ACTION_COMMAND],
				});
				process.exitCode = 1;
				return;
			}
			console.error(chalk.red(`✗  ${body.error ?? `HTTP ${response.status}`}`));
			process.exitCode = 1;
			return;
		}
		history = body;
	} catch (err) {
		reportSidecarError(err);
		return;
	}

	if (opts.json) {
		printJson(history);
		return;
	}

	const session = history.session;
	const short = formatSessionId(session["@id"]);
	const name = session.name ? chalk.white(session.name) : chalk.dim("unnamed");
	console.log(chalk.bold(`\n  Session ${chalk.cyan(short)}  ${name}`));
	if (session.created_at_ns) {
		console.log(chalk.dim(`  Started ${formatAge(session.created_at_ns)}\n`));
	} else {
		console.log();
	}

	if (history.total === 0) {
		console.log(chalk.dim("  No conversation history yet.\n"));
		return;
	}

	for (const entry of history.entries) {
		const isUser = entry.kind === "user";
		const label = isUser ? chalk.blue.bold("  You") : chalk.green.bold("  Pi ");
		console.log(label);
		const lines = entry.content.split("\n");
		for (const line of lines) {
			console.log(isUser ? chalk.blue(`  ${line}`) : `  ${line}`);
		}
		console.log();
	}

	console.log(
		chalk.dim(
			`  ${history.total} message${history.total === 1 ? "" : "s"} · ${session["@id"]}\n`,
		),
	);
}

export const sessionsCommand = createSessionsCommand();
