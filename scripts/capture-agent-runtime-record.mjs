#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args.out ?? path.join(ROOT, ".dgk", "agent-live-record", timestampSlug(new Date())));
const refarmHome = path.resolve(args["refarm-home"] ?? path.join(ROOT, ".refarm"));
const REFARM_CLI = path.join(ROOT, "apps", "refarm", "dist", "index.js");
const cargoTarget = path.resolve(process.env.CARGO_TARGET_DIR ?? path.join(ROOT, ".cache", "cargo-target"));
const prompt = String(
	args.prompt ??
		"Responda em português em uma frase curta: o plugin de agent do Refarm está executando agora no runtime Rust.",
);

mkdirSync(outDir, { recursive: true });

assert(existsSync(REFARM_CLI), `refarm CLI missing: ${relative(REFARM_CLI)}. Run: pnpm -C apps/refarm run build`);
assert(existsSync(refarmHome), `REFARM_HOME missing: ${relative(refarmHome)}. Run: REFARM_HOME=$PWD/.refarm node apps/refarm/dist/index.js plugin install --bundled`);

const baseEnv = {
	...process.env,
	CARGO_TARGET_DIR: cargoTarget,
	REFARM_HOME: refarmHome,
	MODEL_FS_ROOT: ROOT,
	MODEL_SHELL_ALLOWLIST: String(args["shell-allowlist"] ?? "pwd,ls,find,grep,rg,cat,echo"),
	REFARM_NO_BROWSER_OPEN: "1",
};
const modelEnv = args["no-import-model-env"] === true ? null : importOperatorModelEnv();
const env = {
	...baseEnv,
	...(modelEnv?.env ?? {}),
	REFARM_HOME: refarmHome,
};

runRefarmText(["runtime", "stop", "--json"], env, { allowFailure: true });
const runtimeEnsureText = runRefarmText(["runtime", "ensure", "--wait", "--next-command"], env);
writeFileSync(path.join(outDir, "runtime-ensure.txt"), runtimeEnsureText);

const modelCurrent = runRefarmJson(["model", "current", "--json"], env);
const modelDoctor = runRefarmJson(["model", "doctor", "--json"], env, { allowFailure: true });
const runtimeStatus = runRefarmJson(["runtime", "status", "--json"], env);
const pluginStatus = runRefarmJson(["plugin", "status", "--json"], env, { allowFailure: true });
const sidecarUrl = runtimeStatus.sidecarUrl ?? "http://127.0.0.1:42001";
const sidecarPlugins = await fetchJson(`${sidecarUrl}/plugins`);
const ask = runRefarmJson(["ask", prompt, "--new", "--json"], env);

const sessionCommand = Array.isArray(ask.nextCommands)
	? ask.nextCommands.find((command) => String(command).startsWith("refarm sessions show "))
	: undefined;
const session = sessionCommand ? runRefarmCommandStringJson(sessionCommand, env, { allowFailure: true }) : null;
const taskStatus = ask.effortId
	? runRefarmJson(["task", "status", ask.effortId, "--transport", "file", "--json"], env, { allowFailure: true })
	: null;

const copied = copyRuntimeArtifacts({ outDir, refarmHome, effortId: ask.effortId });
const evidence = {
	ok: ask.ok === true,
	capturedAt: new Date().toISOString(),
	outDir,
	refarmHome,
	prompt,
	modelEnv: modelEnv
		? {
				importedFromOperatorScope: true,
				keys: Object.keys(modelEnv.env ?? {}).map(redactKeyOnly),
				managedKeys: modelEnv.managedKeys ?? [],
			}
		: { importedFromOperatorScope: false },
	modelCurrent,
	modelDoctor,
	runtimeStatus,
	pluginStatus,
	sidecarPlugins,
	ask,
	session,
	taskStatus,
	artifacts: copied,
};

writeJson("model-current.json", modelCurrent);
writeJson("model-doctor.json", modelDoctor);
writeJson("runtime-status.json", runtimeStatus);
writeJson("plugin-status.json", pluginStatus);
writeJson("sidecar-plugins.json", sidecarPlugins);
writeJson("ask-live.json", ask);
if (session) writeJson("session-live.json", session);
if (taskStatus) writeJson("task-status-live.json", taskStatus);
writeJson("agent-live-evidence.json", evidence);
writeFileSync(path.join(outDir, "INDEX.md"), renderIndex(evidence), "utf8");

console.log(JSON.stringify({ ok: evidence.ok, outDir, effortId: ask.effortId, response: ask.content }, null, 2));
process.exitCode = evidence.ok ? 0 : 1;

function importOperatorModelEnv() {
	const operatorEnv = { ...process.env, CARGO_TARGET_DIR: cargoTarget };
	delete operatorEnv.REFARM_HOME;
	const result = runRefarmJson(["model", "env", "--json", "--include-secrets"], operatorEnv);
	assert(result?.ok === true && result.env && typeof result.env === "object", "refarm model env did not return usable env; run refarm sow first");
	return result;
}

function copyRuntimeArtifacts({ outDir, refarmHome, effortId }) {
	const copied = {};
	const copyIfExists = (source, name) => {
		if (!existsSync(source)) return null;
		const dest = path.join(outDir, name);
		cpSync(source, dest, { recursive: true });
		copied[name] = dest;
		return dest;
	};
	copyIfExists(path.join(refarmHome, "scarecrow-audit.ndjson"), "scarecrow-audit.ndjson");
	copyIfExists(path.join(refarmHome, "tractor.log"), "tractor.log");
	copyIfExists(path.join(refarmHome, "streams"), "streams");
	if (effortId) copyIfExists(path.join(refarmHome, "task-results", `${effortId}.json`), "task-result-live.json");
	return copied;
}

function runRefarmJson(commandArgs, env, options = {}) {
	return parseJson(runRefarmText(commandArgs, env, options));
}

function runRefarmText(commandArgs, env, options = {}) {
	const result = spawnSync(process.execPath, [REFARM_CLI, ...commandArgs], {
		cwd: ROOT,
		env,
		encoding: "utf8",
		maxBuffer: 20 * 1024 * 1024,
	});
	if (!options.allowFailure && result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `refarm ${commandArgs.join(" ")} failed`);
	}
	return result.stdout || result.stderr;
}

function runRefarmCommandStringJson(command, env, options = {}) {
	const parts = splitCommand(command);
	assert(parts[0] === "refarm", `unsupported handoff command: ${command}`);
	return runRefarmJson(parts.slice(1), env, options);
}

function parseJson(text) {
	const trimmed = String(text ?? "").trim();
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end < start) throw new Error(`no JSON object in output: ${trimmed.slice(0, 500)}`);
	return JSON.parse(trimmed.slice(start, end + 1));
}

async function fetchJson(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} returned ${response.status}`);
	return response.json();
}

function writeJson(name, value) {
	writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 2) + "\n");
}

function splitCommand(command) {
	const args = [];
	let current = "";
	let quote = null;
	for (const char of command.trim()) {
		if (quote) {
			if (char === quote) quote = null;
			else current += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) args.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current) args.push(current);
	return args;
}

function renderIndex(evidence) {
	const answer = String(evidence.ask?.content ?? "").trim();
	return `# Refarm agent runtime live record\n\nGenerated: ${evidence.capturedAt}\n\n## What this proves\n\n- Rust tractor runtime sidecar was ready at \`${evidence.runtimeStatus.sidecarUrl}\`.\n- \`@refarm/agent\` was installed and loaded; sidecar reported \`defaultResponder=${evidence.sidecarPlugins.defaultResponder}\`.\n- \`refarm ask --new --json\` returned \`ok: ${evidence.ask.ok}\` through the runtime agent.\n- Model route: \`${evidence.modelCurrent.current?.ref ?? "unknown"}\`; liveness: \`${evidence.modelDoctor.providerProbe?.reason ?? "unknown"}\`.\n\n## Response\n\n> ${answer}\n\n## Files\n\n- \`agent-live-evidence.json\` — full machine-readable evidence.\n- \`ask-live.json\` — prompt result.\n- \`runtime-status.json\`, \`plugin-status.json\`, \`sidecar-plugins.json\` — runtime/plugin readiness.\n- \`model-current.json\`, \`model-doctor.json\` — model route/liveness.\n- \`session-live.json\`, \`task-status-live.json\`, \`task-result-live.json\` — session/effort record when available.\n- \`scarecrow-audit.ndjson\`, \`tractor.log\`, \`streams/\` — runtime artifacts copied from REFARM_HOME.\n\n## Boundary\n\nThis is live POC evidence from the real Refarm runtime and real WASM agent plugin. It is not a production-readiness or legal/compliance certification.\n`;
}

function redactKeyOnly(key) {
	return /TOKEN|SECRET|KEY|PASSWORD/i.test(key) ? `${key}=<redacted>` : key;
}

function parseArgs(argv) {
	const parsed = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		const next = argv[i + 1];
		if (next && !next.startsWith("--")) {
			parsed[key] = next;
			i++;
		} else {
			parsed[key] = true;
		}
	}
	return parsed;
}

function timestampSlug(date) {
	return date.toISOString().replace(/[:.]/g, "-");
}

function relative(file) {
	return path.relative(ROOT, file) || ".";
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
