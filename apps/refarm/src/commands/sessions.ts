import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";

const SESSION_LOCK_PATH = path.join(os.homedir(), ".refarm", "session.lock");
const SIDECAR_URL = "http://127.0.0.1:42001";

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

function readActiveSessionId(): string | null {
	try {
		const content = fs.readFileSync(SESSION_LOCK_PATH, "utf-8").trim();
		return content.length > 0 ? content : null;
	} catch {
		return null;
	}
}

function writeActiveSessionId(id: string): void {
	fs.mkdirSync(path.dirname(SESSION_LOCK_PATH), { recursive: true });
	fs.writeFileSync(SESSION_LOCK_PATH, id, "utf-8");
}

function formatSessionId(id: string): string {
	// urn:refarm:session:v1:0123456789abcdef → show last 12 chars
	const parts = id.split(":");
	return parts.at(-1)?.slice(-12) ?? id;
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
		.addCommand(
			new Command("list")
				.description("List recent sessions (default)")
				.action(async () => {
					await listSessions();
				}),
		)
		.addCommand(
			new Command("use")
				.description("Switch to a session by ID prefix")
				.argument("<id>", "Session ID or unique prefix")
				.action(async (prefix: string) => {
					await useSession(prefix);
				}),
		)
		.addCommand(
			new Command("show")
				.description("Show conversation history for a session")
				.argument("<id>", "Session ID or unique prefix")
				.action(async (prefix: string) => {
					await showSession(prefix);
				}),
		)
		.addCommand(
			new Command("clear")
				.description("Clear the active session (next ask starts fresh)")
				.action(() => {
					try {
						fs.unlinkSync(SESSION_LOCK_PATH);
						console.log(chalk.green("✓  Active session cleared."));
					} catch {
						console.log(chalk.dim("No active session."));
					}
				}),
		)
		.action(async () => {
			// default action: list
			await listSessions();
		});
}

async function fetchSessions(): Promise<SessionNode[]> {
	const response = await fetch(`${SIDECAR_URL}/sessions`);
	if (!response.ok) {
		throw new Error(`sidecar HTTP ${response.status}`);
	}
	const body = (await response.json()) as { sessions: SessionNode[] };
	return body.sessions ?? [];
}

async function listSessions(): Promise<void> {
	const activeId = readActiveSessionId();

	let sessions: SessionNode[];
	try {
		sessions = await fetchSessions();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
			console.error(chalk.red("✗  tractor is not running."));
			console.error(chalk.dim("   Start it:  npm run farmhand:daemon"));
		} else {
			console.error(chalk.red(`✗  ${msg}`));
		}
		process.exit(1);
	}

	if (sessions.length === 0) {
		console.log(chalk.dim("No sessions yet. Start one with: refarm ask <query>"));
		return;
	}

	// Sort newest first by created_at_ns
	sessions.sort(
		(a, b) => (b.created_at_ns ?? 0) - (a.created_at_ns ?? 0),
	);

	console.log(chalk.bold(`\n  Sessions  (${sessions.length} total)\n`));

	for (const session of sessions) {
		const short = formatSessionId(session["@id"]);
		const age = formatAge(session.created_at_ns);
		const isActive = session["@id"] === activeId;
		const name = session.name ? chalk.white(session.name) : chalk.dim("unnamed");
		const hasHistory = !!session.leaf_entry_id;

		const prefix = isActive ? chalk.green("▶") : " ";
		const idStr = isActive
			? chalk.green.bold(short)
			: chalk.cyan(short);
		const ageStr = chalk.dim(age);
		const historyStr = hasHistory ? chalk.dim(" · has history") : "";

		console.log(`  ${prefix} ${idStr}  ${name}  ${ageStr}${historyStr}`);
	}

	if (activeId) {
		console.log(
			chalk.dim(`\n  Active: ${activeId}`),
		);
	}
	console.log(
		chalk.dim(
			"\n  refarm sessions use <id-prefix>   switch session" +
			"\n  refarm ask --new                  start fresh\n",
		),
	);
}

async function useSession(prefix: string): Promise<void> {
	let sessions: SessionNode[];
	try {
		sessions = await fetchSessions();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(chalk.red(`✗  ${msg}`));
		process.exit(1);
	}

	const matches = sessions.filter(
		(s) => s["@id"].includes(prefix) || s["@id"].endsWith(prefix),
	);

	if (matches.length === 0) {
		console.error(chalk.red(`✗  No session matching "${prefix}"`));
		process.exit(1);
	}
	if (matches.length > 1) {
		console.error(chalk.red(`✗  Ambiguous prefix "${prefix}" — matches ${matches.length} sessions:`));
		for (const m of matches) console.error(chalk.dim(`   ${m["@id"]}`));
		process.exit(1);
	}

	writeActiveSessionId(matches[0]["@id"]);
	console.log(chalk.green(`✓  Switched to session ${formatSessionId(matches[0]["@id"])}`));
}

async function showSession(prefix: string): Promise<void> {
	// Pass prefix directly — sidecar does exact-then-substring resolution.
	const encodedId = encodeURIComponent(prefix);
	let history: SessionHistory;
	try {
		const response = await fetch(`${SIDECAR_URL}/sessions/${encodedId}/history`);
		const body = await response.json() as SessionHistory & { error?: string; matches?: string[] };
		if (response.status === 404) {
			console.error(chalk.red(`✗  No session matching "${prefix}"`));
			process.exit(1);
		}
		if (response.status === 409) {
			console.error(chalk.red(`✗  Ambiguous prefix "${prefix}" — ${body.error}`));
			for (const m of body.matches ?? []) console.error(chalk.dim(`   ${m}`));
			process.exit(1);
		}
		if (!response.ok) {
			console.error(chalk.red(`✗  ${body.error ?? `HTTP ${response.status}`}`));
			process.exit(1);
		}
		history = body;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
			console.error(chalk.red("✗  tractor is not running."));
			console.error(chalk.dim("   Start it:  npm run farmhand:daemon"));
		} else {
			console.error(chalk.red(`✗  ${msg}`));
		}
		process.exit(1);
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
		const label = isUser
			? chalk.blue.bold("  You")
			: chalk.green.bold("  Pi ");
		console.log(label);
		const lines = entry.content.split("\n");
		for (const line of lines) {
			console.log(isUser ? chalk.blue(`  ${line}`) : `  ${line}`);
		}
		console.log();
	}

	console.log(chalk.dim(`  ${history.total} message${history.total === 1 ? "" : "s"} · ${session["@id"]}\n`));
}

export const sessionsCommand = createSessionsCommand();
