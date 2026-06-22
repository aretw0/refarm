#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
	const args = {
		workspaceDir: process.cwd(),
		recent: 1,
		count: 20,
		json: false,
		filter: null,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case "--workspace-dir":
				args.workspaceDir = argv[i + 1] || args.workspaceDir;
				i += 1;
				break;
			case "--recent": {
				const value = Number.parseInt(argv[i + 1], 10);
				if (Number.isInteger(value) && value > 0) args.recent = value;
				i += 1;
				break;
			}
			case "--count": {
				const value = Number.parseInt(argv[i + 1], 10);
				if (Number.isInteger(value) && value > 0) args.count = value;
				i += 1;
				break;
			}
			case "--filter":
				args.filter = argv[i + 1] || null;
				i += 1;
				break;
			case "--help":
				args.help = true;
				break;
			case "--json":
				args.json = true;
				break;
			default:
				break;
		}
	}

	return args;
}

function usage() {
	console.log(
		["Usage:", "  node scripts/pi-session-heavy.mjs [--workspace-dir <dir>] [--recent <n>] [--count <n>]"].join("\n"),
	);
	console.log("  --workspace-dir: project dir used to locate .pi session folder");
	console.log("  --recent:        how many latest sessions to inspect (default: 1)");
	console.log("  --count:         top commands to print (default: 20)");
	console.log("  --filter:        only include commands containing this substring");
	console.log("  --json:          output machine-readable summary JSON");
}

function workspaceSessionDir(workspaceDir) {
	const normalized = path.resolve(workspaceDir);
	const tag = `--${normalized.replace(/^\/+/, "").replace(/\//g, "-") }--`;
	const home = process.env.HOME || process.env.USERPROFILE || "";
	return {
		tag,
		path: path.join(home, ".pi", "agent", "sessions", tag),
	};
}

function listSessionFiles(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith('.jsonl'))
		.map((name) => ({
			name,
			path: path.join(dir, name),
			mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs,
		}))
		.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function parseSession(filePath) {
	const calls = new Map();
	const rows = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);

	for (const line of rows) {
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}

		const message = entry.message;
		if (!message || typeof message !== 'object') continue;

		if (Array.isArray(message.content)) {
			for (const item of message.content) {
				if (item?.type === 'toolCall' && item?.name === 'bash' && item?.id && item.arguments?.command) {
					calls.set(item.id, {
						command: String(item.arguments.command),
						durationMs: 0,
						timestamp: entry.timestamp || null,
					});
				}
			}
		}

		const toolCallId = message.toolCallId;
		const durationMs = message?.details?.toolMetadata?.durationMs;
		if (!toolCallId || typeof durationMs !== 'number') continue;
		const call = calls.get(toolCallId);
		if (call) {
			call.durationMs = durationMs;
		}
	}

	return [...calls.values()].filter((call) => call.durationMs > 0);
}

function printJsonSummary(sessions) {
	const totalMs = sessions.reduce((acc, row) => acc + row.durationMs, 0);
	const sorted = [...sessions].sort((a, b) => b.durationMs - a.durationMs);
	const top = sorted.slice(0, args.count);
	const patterns = ['gh run', 'gh pr', 'pnpm', 'refarm', 'git push', 'test'];
	const patternSummary = [];

	for (const pattern of patterns) {
		const hits = sessions.filter((row) => row.command.includes(pattern));
		if (hits.length === 0) continue;
		const total = hits.reduce((acc, row) => acc + row.durationMs, 0);
		const max = Math.max(...hits.map((row) => row.durationMs));
		const avg = total / hits.length;
		patternSummary.push({
			pattern,
			count: hits.length,
			totalWallTimeMs: total,
			avgWallTimeMs: Math.round(avg),
			maxWallTimeMs: max,
		});
	}

	console.log(JSON.stringify({
		totalCalls: sessions.length,
		totalWallTimeMs: totalMs,
		top: top.map((row) => ({
			command: row.command,
			durationMs: row.durationMs,
		})),
		patterns: patternSummary,
	}, null, 2));
}

function printSummary(sessions) {
	if (args.json) {
		printJsonSummary(sessions);
		return;
	}
	if (sessions.length === 0) {
		console.log('No timed bash tool calls found.');
		return;
	}

	const sorted = [...sessions].sort((a, b) => b.durationMs - a.durationMs);
	const top = sorted.slice(0, args.count);

	const totalMs = sorted.reduce((acc, row) => acc + row.durationMs, 0);
	const count = sorted.length;

	console.log(`Total timed calls: ${count}`);
	console.log(`Accumulated wall-time: ${(totalMs / 1000).toFixed(1)}s`);
	console.log(`Top ${top.length} commands:`);

	for (const row of top) {
		console.log(`${String(row.durationMs).padStart(6)} ms | ${row.command}`);
	}

	console.log('\nTop by pattern');
	const patterns = ['gh run', 'gh pr', 'pnpm', 'refarm', 'git push', 'test'];
	for (const pattern of patterns) {
		const hits = sessions.filter((row) => row.command.includes(pattern));
		if (hits.length === 0) continue;
		const total = hits.reduce((acc, row) => acc + row.durationMs, 0);
		const max = Math.max(...hits.map((row) => row.durationMs));
		const avg = total / hits.length;
		console.log(`${pattern.padEnd(18)} count=${String(hits.length).padStart(3)} total=${(total / 1000).toFixed(1)}s avg=${(avg / 1000).toFixed(2)}s max=${(max / 1000).toFixed(1)}s`);
	}
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
	usage();
	process.exit(0);
}

const sessionInfo = workspaceSessionDir(args.workspaceDir);
if (!fs.existsSync(sessionInfo.path)) {
	console.error(`Session directory not found: ${sessionInfo.path}`);
	console.log(`Looked up as workspace tag: ${sessionInfo.tag}`);
	console.log('Tip: run from the target workspace root or pass --workspace-dir <path>');
	process.exit(1);
}

const sessionFiles = listSessionFiles(sessionInfo.path).slice(0, args.recent);
if (sessionFiles.length === 0) {
	console.log(`No session files in: ${sessionInfo.path}`);
	process.exit(0);
}

let calls = [];
for (const file of sessionFiles) {
	const parsed = parseSession(file.path);
	for (const item of parsed) {
		if (args.filter && !item.command.includes(args.filter)) continue;
		calls.push(item);
	}
}

printSummary(calls);
