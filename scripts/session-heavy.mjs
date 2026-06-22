#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
	const normalizeSessionSource = (value) => {
		switch ((value || '').toLowerCase()) {
			case "pi":
			case "legacy-pi":
			case "agent-pi":
			case "pi-agent":
				return "pi";
			case "auto":
				return "auto";
			case "refarm":
			case "native":
			case "neutral":
			default:
				return "refarm";
		}
	};

	const parseBoolean = (value) => /^(1|true|yes|on)$/i.test(value || "");

	const args = {
		workspaceDir: process.cwd(),
		sessionDir: null,
		sessionRoot: process.env.REFARM_SESSION_ROOT || null,
		sessionSource: normalizeSessionSource(process.env.REFARM_SESSION_SOURCE),
		allowLegacyPiRoots:
			parseBoolean(process.env.REFARM_ALLOW_LEGACY_PI_ROOTS) ||
			parseBoolean(process.env.REFARM_SESSION_ALLOW_LEGACY),
		suppressSourceWarnings: parseBoolean(process.env.REFARM_SUPPRESS_LEGACY_SOURCE_WARNING),
		recent: 1,
		count: 20,
		json: false,
		printSessionSources: false,
		sessionFilePrefix: null,
		agentRoles: [],
		agentProviders: [],
		agentModels: [],
		filter: null,
		ciLoopSignal: false,
		ciLoopMaxMs: 120_000,
		ciLoopMaxCount: 8,
		repeatSignal: false,
		repeatMaxCount: 5,
		suppressSourceWarnings: false,
	};

	const splitCsv = (value) =>
		typeof value === 'string'
			? value
					.split(',')
					.map((item) => item.trim())
					.filter(Boolean)
			: [];

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case "--workspace-dir":
				args.workspaceDir = argv[i + 1] || args.workspaceDir;
				i += 1;
				break;
			case "--session-dir":
				args.sessionDir = argv[i + 1] || null;
				i += 1;
				break;
			case "--session-root":
				args.sessionRoot = argv[i + 1] || null;
				i += 1;
				break;
			case "--session-source": {
				const next = argv[i + 1] || null;
				args.sessionSource = normalizeSessionSource(next);
				i += 1;
				break;
			}
			case "--allow-legacy-pi-roots":
				args.allowLegacyPiRoots = true;
				break;
			case "--no-allow-legacy-pi-roots":
				args.allowLegacyPiRoots = false;
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
			case "--session-file-prefix":
				args.sessionFilePrefix = argv[i + 1] || null;
				i += 1;
				break;
			case "--agent-role":
				args.agentRoles = [...args.agentRoles, ...splitCsv(argv[i + 1])];
				i += 1;
				break;
			case "--agent-provider":
				args.agentProviders = [...args.agentProviders, ...splitCsv(argv[i + 1])];
				i += 1;
				break;
			case "--agent-model":
				args.agentModels = [...args.agentModels, ...splitCsv(argv[i + 1])];
				i += 1;
				break;
			case "--ci-loop-signal":
				args.ciLoopSignal = true;
				break;
			case "--ci-loop-max-ms": {
				const value = Number.parseInt(argv[i + 1], 10);
				if (Number.isInteger(value) && value > 0) args.ciLoopMaxMs = value;
				i += 1;
				break;
			}
			case "--ci-loop-max-count": {
				const value = Number.parseInt(argv[i + 1], 10);
				if (Number.isInteger(value) && value > 0) args.ciLoopMaxCount = value;
				i += 1;
				break;
			}
			case "--repeat-signal":
				args.repeatSignal = true;
				break;
			case "--repeat-max-count": {
				const value = Number.parseInt(argv[i + 1], 10);
				if (Number.isInteger(value) && value > 0) args.repeatMaxCount = value;
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
			case "--suppress-legacy-source-warning":
				args.suppressSourceWarnings = true;
				break;
			case "--print-session-sources":
			case "--session-sources":
				args.printSessionSources = true;
				break;
			default:
				break;
		}
	}

	return args;
}

const envCiLoopMaxMs = Number.parseInt(process.env.CI_LOOP_MAX_MS, 10);
const envCiLoopMaxCount = Number.parseInt(process.env.CI_LOOP_MAX_COUNT, 10);

function isSessionFile(filename) {
	return (
		filename.endsWith('.jsonl') ||
		filename.endsWith('.v1.json') ||
		filename.endsWith('.session.json')
	);
}

function usage() {
	console.log(
		["Usage:", "  node scripts/session-heavy.mjs [--workspace-dir <dir>] [--recent <n>] [--count <n>]"].join("\n"),
	);
	console.log("  --workspace-dir: project dir used to locate workspace-tagged session folder");
	console.log("  --session-dir:   direct session log directory override (optional)");
	console.log("  --session-root:  direct root session folder override, e.g. --session-root /path/to/agent/sessions");
	console.log(
		"  --session-source: source strategy for workspace-tagged lookup (refarm|pi|auto) (default: refarm)",
	);
	console.log("  --session-source pi: legacy .pi namespace, for migration/forensics only");
	console.log("  --session-sources/--print-session-sources: list candidate session roots and exit");
	console.log("  --suppress-legacy-source-warning: skip warning on explicit pi source use");
	console.log("  --allow-legacy-pi-roots: include legacy ~/.pi roots in source resolution");
	console.log("  --no-allow-legacy-pi-roots: exclude legacy ~/.pi roots");
	console.log("  --recent:        how many latest sessions to inspect (default: 1)");
	console.log("  --count:         top commands to print (default: 20)");
	console.log("  --session-file-prefix: include only session filenames containing this substring");
	console.log("  --agent-role:    match tool-call entries with these roles (example: assistant or assistant,system)");
	console.log("  --agent-provider: match tool-call entries with this metadata provider(s), comma-separated");
	console.log("  --agent-model:   match tool-call entries with this metadata model(s), comma-separated");
	console.log("  --filter:        only include commands containing this substring");
	console.log("  --json:          output machine-readable summary JSON");
	console.log("  --ci-loop-signal: run CI loop risk check and set exit code on threshold breach");
	console.log("  --ci-loop-max-ms: max total CI loop wall-time in ms for signal mode (default: 120000)");
	console.log("  --ci-loop-max-count: max CI loop command count for signal mode (default: 8)");
	console.log("  --repeat-signal: run repeated-command risk check and set exit code on threshold breach");
	console.log("  --repeat-max-count: max per-command count before repeat signal trips (default: 5)");
	console.log("  CI_LOOP_MAX_MS / CI_LOOP_MAX_COUNT env vars: override default signal limits");
	console.log("  REFARM_SESSION_ROOT env var: override derived session root when --session-root is not passed");
	console.log("  REFARM_SESSION_SOURCE env var: refarm|pi|auto");
	console.log("  REFARM_SUPPRESS_LEGACY_SOURCE_WARNING env var: set to 1 to suppress legacy source warning");
	console.log("  REFARM_ALLOW_LEGACY_PI_ROOTS env var: set to 1 to include legacy ~/.pi roots when using source=auto");
}

function resolveSessionRootCandidates(sessionRootOverride, sessionSource, allowLegacyPiRoots) {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	const roots = [];
	const seen = new Set();

	const addRoot = (value) => {
		if (!value) return;
		const normalized = path.resolve(value);
		if (seen.has(normalized)) return;
		seen.add(normalized);
		roots.push(normalized);
	};

	if (sessionRootOverride) addRoot(sessionRootOverride);
	if (process.env.REFARM_SESSION_ROOT) addRoot(process.env.REFARM_SESSION_ROOT);

	if (home) {
		if (sessionSource === "refarm" || sessionSource === "auto") {
			addRoot(path.join(home, ".refarm", "agent-sessions"));
			addRoot(path.join(home, ".refarm", "sessions"));
			addRoot(path.join(home, ".config", "refarm", "sessions"));
		}
		if (sessionSource === "pi" || (sessionSource === "auto" && allowLegacyPiRoots)) {
			addRoot(path.join(home, ".pi", "agent", "sessions"));
		}
	} else {
		if (sessionSource === "refarm" || sessionSource === "auto") {
			addRoot(".refarm/agent-sessions");
			addRoot(".refarm/sessions");
			addRoot(".config/refarm/sessions");
		}
		if (sessionSource === "pi" || (sessionSource === "auto" && allowLegacyPiRoots)) {
			addRoot(".pi/agent/sessions");
		}
	}

	return roots;
}

function resolveSessionDir(workspaceDir, sessionDirOverride, sessionRootOverride) {
	if (sessionDirOverride) {
		return {
			mode: "direct",
			tag: "<direct>",
			path: path.resolve(sessionDirOverride),
			searchedRoots: [],
		};
	}

	const normalized = path.resolve(workspaceDir);
	const tag = `--${normalized.replace(/^\/+/, "").replace(/\//g, "-") }--`;
	const roots = resolveSessionRootCandidates(sessionRootOverride, args.sessionSource, args.allowLegacyPiRoots);
	for (const root of roots) {
		const candidate = path.join(root, tag);
		if (fs.existsSync(candidate)) {
			return {
				mode: "tagged",
				tag,
				path: candidate,
				searchedRoots: roots,
			};
		}
	}

	for (const root of roots) {
		if (!fs.existsSync(root)) continue;
		if (listSessionFiles(root, args.sessionFilePrefix).length > 0) {
			return {
				mode: "root",
				tag,
				path: root,
				searchedRoots: roots,
			};
		}
	}

	return {
		mode: "tagged",
		tag,
		path: path.join(
			roots[0] ||
				(args.sessionSource === "pi"
					? path.resolve(".pi", "agent", "sessions")
					: path.resolve(".refarm", "agent-sessions")),
			tag,
		),
		searchedRoots: roots,
	};
}

function printSessionSources() {
	const roots = resolveSessionRootCandidates(args.sessionRoot, args.sessionSource, args.allowLegacyPiRoots);
	const workspaceDir = path.resolve(args.workspaceDir);
	const tag = `--${workspaceDir.replace(/^\/+/, "").replace(/\//g, "-")}--`;
	const sources = roots.map((root) => {
		const tagDir = path.join(root, tag);
		return {
			root,
			rootExists: fs.existsSync(root),
			tagDir,
			tagDirExists: fs.existsSync(tagDir),
		};
	});

	if (args.json) {
		console.log(
			JSON.stringify(
				{
					workspaceDir,
					tag,
					sessionSource: args.sessionSource,
					allowLegacyPiRoots: args.allowLegacyPiRoots,
					sessionDirOverride: args.sessionDir,
					sessionRootOverride: args.sessionRoot,
					sources,
				},
				null,
				2,
			),
		);
		return;
	}

	console.log(`Session source lookup for workspace: ${workspaceDir}`);
	console.log(`Tag: ${tag}`);
	console.log(`sessionSource=${args.sessionSource}, allowLegacyPiRoots=${args.allowLegacyPiRoots}`);
	console.log('Candidate session roots:');
	for (const source of sources) {
		const existsGlyph = source.rootExists ? ' [exists]' : ' [missing]';
		const tagGlyph = source.tagDirExists ? ' [tag exists]' : ' [tag missing]';
		console.log(`- root: ${source.root}${existsGlyph}`);
		console.log(`  tag: ${source.tagDir}${tagGlyph}`);
	}
}

function listSessionFiles(dir, sessionFilePrefix) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter(isSessionFile)
		.filter((name) => {
			if (!sessionFilePrefix) return true;
			return name.includes(sessionFilePrefix);
		})
		.map((name) => ({
			name,
			path: path.join(dir, name),
			mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs,
		}))
		.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function parseSessionV1(filePath) {
	let payload;
	try {
		payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch {
		return [];
	}

	const result = [];
	const latest = payload?.latest;
	const command = typeof latest?.command === 'string' ? latest.command.trim() : '';
	if (command) {
		result.push({
			command,
			durationMs: 0,
			timestamp: latest.updatedAt || latest.createdAt || null,
			role: payload.participant || null,
			provider: null,
			model: null,
			source: 'session-v1',
		});
	}

	return result;
}

function parseSession(filePath) {
	const filename = filePath.toLowerCase();
	if (filename.endsWith('.v1.json') || filename.endsWith('.session.json')) {
		return parseSessionV1(filePath);
	}

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
						role: message.role || null,
						provider:
							message.provider || item.provider || entry.provider || null,
						model:
							message.model ||
							item.model ||
							item.modelId ||
							entry.model ||
							entry.modelId ||
							null,
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
			if (call.provider === null) call.provider = message.provider || itemFromResultProvider(entry) || null;
			if (call.model === null) call.model = message.model || itemFromResultModel(entry) || null;
			if (call.role === null && message.role) call.role = message.role;
		}
	}

	return [...calls.values()].filter((call) => call.durationMs > 0);
}

function itemFromResultProvider(entry) {
	return (
		entry?.provider ||
		entry?.toolCall?.provider ||
		entry?.toolResult?.provider ||
		entry?.result?.provider ||
		null
	);
}

function itemFromResultModel(entry) {
	return (
		entry?.model ||
		entry?.modelId ||
		entry?.toolCall?.model ||
		entry?.toolCall?.modelId ||
		entry?.toolResult?.model ||
		entry?.toolResult?.modelId ||
		entry?.result?.model ||
		entry?.result?.modelId ||
		null
	);
}

function printSummary(sessions) {
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

	console.log('\nTop repeated commands');
	const repeated = summarizeCommandRepetitions(sessions).slice(0, 5);
	if (repeated.length === 0) {
		console.log('No repeated commands.');
		return;
	}

	for (const row of repeated) {
		console.log(`${String(row.count).padStart(2)}x | ${String(row.totalWallTimeMs).padStart(6)} ms total | ${row.command}`);
	}
}

function isLikelyCiWatchLoop(command) {
	const normalized = command.toLowerCase();
	const isGhTarget = normalized.includes("gh run") || normalized.includes("gh pr");
	if (!isGhTarget) return false;

	const hasPollingShape =
		normalized.includes("while true") ||
		(normalized.includes("for ") && normalized.includes("sleep")) ||
		normalized.includes("--watch") ||
		normalized.includes("sleep");
	const hasRunViewOrChecks =
		normalized.includes("gh run view") ||
		normalized.includes("gh pr checks") ||
		normalized.includes("gh run watch");

	return hasPollingShape && hasRunViewOrChecks;
}

function summarizeCiWatchLoops(sessions) {
	const loops = sessions.filter((call) => isLikelyCiWatchLoop(call.command));
	const totalMs = loops.reduce((acc, call) => acc + call.durationMs, 0);
	const maxMs = loops.length > 0 ? Math.max(...loops.map((call) => call.durationMs)) : 0;

	return {
		count: loops.length,
		totalWallTimeMs: totalMs,
		maxWallTimeMs: maxMs,
		top: [...loops]
			.sort((a, b) => b.durationMs - a.durationMs)
			.map((call) => ({ command: call.command, durationMs: call.durationMs })),
	};
}

function printCiLoopSignal(sessions) {
	const summary = summarizeCiWatchLoops(sessions);
	if (summary.count === 0) {
		console.log("\nCI loop risk: no obvious polling loops detected.");
		return summary;
	}

	console.log(
		`\nCI loop risk: ${summary.count} candidate(s), total ${(summary.totalWallTimeMs / 1000).toFixed(1)}s (max ${(summary.maxWallTimeMs / 1000).toFixed(1)}s).`,
	);
	for (const row of summary.top.slice(0, 5)) {
		console.log(`- ${String(row.durationMs).padStart(6)} ms | ${row.command}`);
	}
	return summary;
}

function buildJsonSummary(sessions) {
	const totalMs = sessions.reduce((acc, row) => acc + row.durationMs, 0);
	const sorted = [...sessions].sort((a, b) => b.durationMs - a.durationMs);
	const top = sorted.slice(0, args.count);
	const patterns = ['gh run', 'gh pr', 'pnpm', 'refarm', 'git push', 'test'];
	const patternSummary = [];
	const ciLoopSummary = summarizeCiWatchLoops(sessions);
	const tooMuchLoops = ciLoopSummary.count > args.ciLoopMaxCount;
	const tooLongLoops = ciLoopSummary.totalWallTimeMs > args.ciLoopMaxMs;

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

	return {
		totalCalls: sessions.length,
		totalWallTimeMs: totalMs,
		top: top.map((row) => ({
			command: row.command,
			durationMs: row.durationMs,
			role: row.role,
			provider: row.provider,
			model: row.model,
		})),
		patterns: patternSummary,
		ciWatchLoops: {
			count: ciLoopSummary.count,
			totalWallTimeMs: ciLoopSummary.totalWallTimeMs,
			maxWallTimeMs: ciLoopSummary.maxWallTimeMs,
			top: ciLoopSummary.top.slice(0, args.count),
		},
		ciLoopSignal: {
			enabled: args.ciLoopSignal,
			ok: !tooMuchLoops && !tooLongLoops,
			violations: {
				maxCountExceeded: tooMuchLoops,
				maxWallTimeExceeded: tooLongLoops,
			},
			limits: {
				maxWallTimeMs: args.ciLoopMaxMs,
				maxCount: args.ciLoopMaxCount,
			},
			maxWallTimeMs: args.ciLoopMaxMs,
			maxCount: args.ciLoopMaxCount,
		},
		commandRepeats: summarizeCommandRepetitions(sessions),
		repeatSignal: {
			enabled: args.repeatSignal,
			ok: !summarizeCommandRepetitions(sessions).some((entry) => entry.count > args.repeatMaxCount),
			threshold: args.repeatMaxCount,
		},
	};
}

function normalizeCommand(command) {
	return String(command)
		.trim()
		.replace(/\s+/g, ' ');
}

function normalizeCommandForRepeat(command) {
	return normalizeCommand(command)
		.replace(/\b--workspace-dir\s+(?:\S+)/g, '--workspace-dir <path>')
		.replace(/\b--session-dir\s+(?:\S+)/g, '--session-dir <path>')
		.replace(/\b--session-root\s+(?:\S+)/g, '--session-root <path>')
		.replace(/(?:~|\$HOME)\/\S+/g, '<path>')
		.replace(/[A-Za-z]:\\[^\s'\"]+/g, '<path>')
		.replace(/\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+/g, '<path>');
}

function summarizeCommandRepetitions(sessions) {
	const byCommand = new Map();

	for (const row of sessions) {
		const key = normalizeCommandForRepeat(row.command);
		const existing = byCommand.get(key);
		const totalWallTimeMs = row.durationMs;
		if (existing) {
			existing.count += 1;
			existing.totalWallTimeMs += totalWallTimeMs;
			existing.maxWallTimeMs = Math.max(existing.maxWallTimeMs, totalWallTimeMs);
			existing.avgWallTimeMs = Math.round(existing.totalWallTimeMs / existing.count);
		} else {
			byCommand.set(key, {
				command: row.command,
				count: 1,
				totalWallTimeMs,
				avgWallTimeMs: row.durationMs,
				maxWallTimeMs: row.durationMs,
			});
		}
	}

	return [...byCommand.values()]
		.filter((entry) => entry.count > 1)
		.sort((a, b) => b.count - a.count || b.totalWallTimeMs - a.totalWallTimeMs);
}

function matchesAgentFilters(call, args) {
	if (args.agentRoles.length > 0 && !args.agentRoles.includes(call.role)) return false;
	if (args.agentProviders.length > 0 && !args.agentProviders.includes(call.provider)) return false;
	if (args.agentModels.length > 0 && !args.agentModels.includes(call.model)) return false;
	return true;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
	usage();
	process.exit(0);
}

if (!args.json && !args.suppressSourceWarnings && args.sessionSource === 'pi') {
	console.warn('[legacy] session source is explicitly set to pi. Use this only for migration/forensics.');
	console.warn('[legacy] Prefer `--session-source refarm` / `session:heavy:refarm` for ongoing operator work.');
}

if (args.printSessionSources) {
	printSessionSources();
	process.exit(0);
}

if (Number.isInteger(envCiLoopMaxMs) && envCiLoopMaxMs > 0) args.ciLoopMaxMs = envCiLoopMaxMs;
if (Number.isInteger(envCiLoopMaxCount) && envCiLoopMaxCount > 0) args.ciLoopMaxCount = envCiLoopMaxCount;

const sessionInfo = resolveSessionDir(args.workspaceDir, args.sessionDir, args.sessionRoot);
if (!fs.existsSync(sessionInfo.path)) {
	console.error(`Session directory not found: ${sessionInfo.path}`);
	if (sessionInfo.mode === "direct") {
		console.log('Hint: verify --session-dir points to a valid sessions directory.');
	} else {
		console.log(`Looked up by workspace tag: ${sessionInfo.tag}`);
		if (sessionInfo.searchedRoots.length > 0) {
			console.log("Candidate roots checked:");
			for (const root of sessionInfo.searchedRoots) {
				console.log(`  - ${root}`);
			}
		}
		console.log("Tip: pass --session-root <path> for custom session storage or --session-dir <path> for direct mode.");
	}
	process.exit(1);
}

const sessionFiles = listSessionFiles(sessionInfo.path, args.sessionFilePrefix).slice(0, args.recent);
if (sessionFiles.length === 0) {
	console.log(`No session files in: ${sessionInfo.path}`);
	process.exit(0);
}

let calls = [];
for (const file of sessionFiles) {
	const parsed = parseSession(file.path);
	for (const item of parsed) {
		if (!matchesAgentFilters(item, args)) continue;
		if (args.filter && !item.command.includes(args.filter)) continue;
		calls.push(item);
	}
}

if (args.json) {
	console.log(JSON.stringify(buildJsonSummary(calls), null, 2));
	if (args.ciLoopSignal) {
		const ciSummary = summarizeCiWatchLoops(calls);
		const tooMuchLoops = ciSummary.count > args.ciLoopMaxCount;
		const tooLongLoops = ciSummary.totalWallTimeMs > args.ciLoopMaxMs;
		if (tooMuchLoops || tooLongLoops) process.exitCode = 1;
	}
	if (args.repeatSignal) {
		const repeated = summarizeCommandRepetitions(calls);
		const hasExcessiveRepeats = repeated.some((entry) => entry.count > args.repeatMaxCount);
		if (hasExcessiveRepeats) process.exitCode = 1;
	}
} else {
	printSummary(calls);
	const ciSummary = printCiLoopSignal(calls);
	if (args.ciLoopSignal) {
		const tooMuchLoops = ciSummary.count > args.ciLoopMaxCount;
		const tooLongLoops = ciSummary.totalWallTimeMs > args.ciLoopMaxMs;
		if (tooMuchLoops || tooLongLoops) {
			console.log(
				`CI loop signal blocked: maxCountExceeded=${tooMuchLoops} maxWallTimeExceeded=${tooLongLoops}`,
			);
			process.exitCode = 1;
		}
	}
	if (args.repeatSignal) {
		const repeated = summarizeCommandRepetitions(calls);
		const topRepeated = repeated.slice(0, 3);
		const blockedByRepeat = repeated.some((entry) => entry.count > args.repeatMaxCount);
		if (blockedByRepeat) {
			console.log(
				`Repeat signal blocked: command repeated more than ${args.repeatMaxCount}x (count=${topRepeated[0]?.count ?? 0}).`,
			);
			process.exitCode = 1;
		}
	}
}
