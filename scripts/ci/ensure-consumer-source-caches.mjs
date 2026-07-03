#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGitSourceProvider, defaultCacheRoot } from "../../packages/source-git/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_TARGETS_FILE = path.join(ROOT, "refarm.consumer-source-caches.json");

export function parseArgs(argv = []) {
	const options = {
		json: false,
		offline: false,
		force: false,
		staleSeconds: 300,
		filter: "blob:none",
		cacheRoot: null,
		targetsFile: DEFAULT_TARGETS_FILE,
		targets: [],
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--offline") {
			options.offline = true;
			continue;
		}
		if (arg === "--force") {
			options.force = true;
			continue;
		}
		if (arg === "--cache-root") {
			options.cacheRoot = requireValue(argv, index, arg);
			index += 1;
			continue;
		}
		if (arg === "--stale-seconds") {
			options.staleSeconds = Number.parseInt(requireValue(argv, index, arg), 10);
			if (!Number.isFinite(options.staleSeconds) || options.staleSeconds < 0) {
				throw new Error("--stale-seconds must be a non-negative integer");
			}
			index += 1;
			continue;
		}
		if (arg === "--target") {
			options.targets.push(parseTarget(requireValue(argv, index, arg)));
			index += 1;
			continue;
		}
		if (arg === "--targets-file") {
			const targetFile = requireValue(argv, index, arg);
			options.targetsFile = targetFile;
			options.targets.push(...readTargetsFile(targetFile));
			index += 1;
			continue;
		}
		throw new Error(`Unknown consumer source cache argument: ${arg}`);
	}

	if (options.targets.length === 0) {
		const config = readTargetsConfig(options.targetsFile);
		options.targets = config.targets;
		options.cacheRoot = options.cacheRoot ?? process.env.REFARM_SOURCE_CACHE_ROOT ?? config.cacheRoot ?? defaultCacheRoot();
	} else {
		options.cacheRoot = options.cacheRoot ?? process.env.REFARM_SOURCE_CACHE_ROOT ?? defaultCacheRoot();
	}
	return options;
}

function requireValue(argv, index, flag) {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function parseTarget(value) {
	const [id, ref, ...purposeParts] = value.split("=");
	if (!id || !ref) {
		throw new Error("--target must use id=ref or id=ref=purpose");
	}
	return {
		id,
		ref,
		purpose: purposeParts.join("=") || "external consumer source evidence",
	};
}

function readTargetsFile(filePath) {
	const parsed = JSON.parse(readFileSync(filePath, "utf8"));
	if (Array.isArray(parsed)) {
		return parseTargets(parsed, "--targets-file");
	}
	if (parsed && typeof parsed === "object" && Array.isArray(parsed.targets)) {
		return parseTargets(parsed.targets, "--targets-file");
	}
	throw new Error("--targets-file must point to a JSON array or an object with targets[]");
}

function readTargetsConfig(filePath) {
	const parsed = JSON.parse(readFileSync(filePath, "utf8"));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("consumer source cache config must be a JSON object");
	}
	if (parsed.schemaVersion !== 1) {
		throw new Error("consumer source cache config schemaVersion must be 1");
	}
	if (!Array.isArray(parsed.targets)) {
		throw new Error("consumer source cache config must include targets[]");
	}
	return {
		cacheRoot: parsed.cacheRoot ? String(parsed.cacheRoot) : null,
		targets: parseTargets(parsed.targets, "consumer source cache config"),
	};
}

function parseTargets(items, sourceLabel) {
	return items.map((item) => {
		if (!item || typeof item !== "object" || !item.id || !item.ref) {
			throw new Error(`${sourceLabel} entries must include id and ref`);
		}
		return {
			id: String(item.id),
			ref: String(item.ref),
			purpose: item.purpose ? String(item.purpose) : "external consumer source evidence",
		};
	});
}

export async function ensureConsumerSourceCaches({
	targets = readTargetsConfig(DEFAULT_TARGETS_FILE).targets,
	cacheRoot = defaultCacheRoot(),
	filter = "blob:none",
	staleSeconds = 300,
	offline = false,
	force = false,
	now = new Date(),
} = {}) {
	const provider = createGitSourceProvider({ cacheRoot });
	const results = [];

	for (const target of targets) {
		const before = await provider.status(target.ref);
		const hadCache = before.materialized === true && before.path && existsSync(before.path);
		let materialize = null;
		let status = before;
		let error = null;

		try {
			materialize = await provider.materialize(target.ref, {
				filter,
				staleSeconds,
				offline,
				force,
			});
			status = await provider.status(target.ref);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}

		results.push({
			id: target.id,
			ref: target.ref,
			purpose: target.purpose,
			ok: error === null && status.materialized === true,
			hadCache,
			action: materialize?.action ?? "failed",
			cachePath: status.path ?? before.path ?? materialize?.location?.path ?? null,
			head: status.head ?? materialize?.head ?? null,
			clean: status.clean,
			error,
		});
	}

	const ok = results.every((item) => item.ok);
	return {
		schemaVersion: 1,
		command: "consumer-source-caches",
		operation: "ensure",
		ok,
		generatedAt: now.toISOString(),
		cacheRoot,
		filter,
		staleSeconds,
		offline,
		force,
		targets: results,
		nextCommand: ok ? null : "pnpm run consumer:sources:cache -- --json",
		nextCommands: ok ? [] : ["pnpm run consumer:sources:cache -- --json"],
	};
}

function formatText(payload) {
	const lines = [
		`consumer source caches: ${payload.ok ? "ok" : "blocked"}`,
		`cache root: ${payload.cacheRoot}`,
	];
	for (const target of payload.targets) {
		lines.push(
			`- ${target.id}: ${target.ok ? target.action : "failed"} ${target.cachePath ?? "(no path)"}${target.head ? ` @ ${target.head}` : ""}`,
		);
		if (target.error) {
			lines.push(`  error: ${target.error}`);
		}
	}
	return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		const options = parseArgs(process.argv.slice(2));
		const payload = await ensureConsumerSourceCaches(options);
		if (options.json) {
			console.log(JSON.stringify(payload, null, 2));
		} else {
			console.log(formatText(payload));
		}
		process.exitCode = payload.ok ? 0 : 1;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exitCode = 1;
	}
}
