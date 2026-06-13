import { RUNTIME_AGENT_PLUGIN_ID } from "@refarm.dev/config";
import { Command } from "commander";
import {
	defaultChatDeps,
	runSessionRepl,
	type ChatDeps,
} from "./chat.js";
import {
	PLUGIN_INSTALL_JSON_COMMAND,
	RUNTIME_AGENT_RELOAD_JSON_COMMAND,
} from "./plugin-handoffs.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
} from "./runtime-recovery.js";
import { isFullSessionId, resolveSessionIdPrefix } from "./session-ids.js";
import {
	autoStartRuntime,
	checkSessionReadiness,
	defaultLaunchDeps,
	findRepoRoot,
	isFirstRun,
	isRuntimeRunning,
	isSessionReady,
	printOnboarding,
	printSessionGuide,
	type LaunchDeps,
} from "./session-launch.js";
import {
	clearActiveSessionId,
	readActiveSessionId,
	writeActiveSessionIdAndVerify,
} from "./session-lock.js";
import { sidecarUrl } from "./sidecar-url.js";

function newSessionId(): string {
	return `urn:refarm:session:v1:${crypto.randomUUID().replace(/-/g, "")}`;
}

async function resolveTargetSession(
	opts: { new?: boolean; session?: string },
	deps: ChatDeps,
): Promise<string> {
	const readActive = deps.readActiveSessionId ?? readActiveSessionId;
	const clearActive = deps.clearActiveSessionId ?? clearActiveSessionId;
	const persist = deps.persistActiveSessionId ?? writeActiveSessionIdAndVerify;

	if (opts.new) {
		clearActive();
		const id = newSessionId();
		persist(id);
		return id;
	}

	const explicitPrefix = opts.session?.trim();
	if (explicitPrefix && explicitPrefix.length > 0) {
		if (isFullSessionId(explicitPrefix)) return explicitPrefix;
		if (deps.resolveSessionIdPrefix) {
			return deps.resolveSessionIdPrefix(explicitPrefix);
		}
		return explicitPrefix;
	}

	return readActive() ?? newSessionId();
}

async function _resolveSessionIdPrefixFromSidecar(prefix: string): Promise<string> {
	if (isFullSessionId(prefix)) return prefix;
	const response = await fetch(sidecarUrl("/sessions"));
	if (!response.ok) throw new Error(`sidecar HTTP ${response.status}`);
	const body = (await response.json()) as { sessions?: Array<{ "@id": string }> };
	return resolveSessionIdPrefix(prefix, body.sessions ?? []);
}

async function ensureSessionRuntimeAgentReady(deps: ChatDeps): Promise<boolean> {
	if (!deps.readPluginState) return true;
	const state = await deps.readPluginState();
	if (!state) return true;
	if (state.loaded.includes(RUNTIME_AGENT_PLUGIN_ID)) return true;

	if (state.installed.includes(RUNTIME_AGENT_PLUGIN_ID) && deps.reloadPlugins) {
		const reload = await deps.reloadPlugins([RUNTIME_AGENT_PLUGIN_ID]);
		if (reload.reloaded.includes(RUNTIME_AGENT_PLUGIN_ID)) return true;
		const refreshed = await deps.readPluginState();
		if (refreshed?.loaded.includes(RUNTIME_AGENT_PLUGIN_ID)) return true;
	}

	process.stderr.write("✗  Runtime agent is not loaded in the Refarm runtime.\n");
	if (!state.installed.includes(RUNTIME_AGENT_PLUGIN_ID)) {
		process.stderr.write(`   Install bundled plugins:  ${PLUGIN_INSTALL_JSON_COMMAND}\n`);
	} else {
		process.stderr.write(`   Reload runtime plugins:   ${RUNTIME_AGENT_RELOAD_JSON_COMMAND}\n`);
	}
	process.stderr.write(`   Ensure runtime:           ${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}\n`);
	process.stderr.write(`   Diagnose:                 ${RUNTIME_DOCTOR_COMMAND}\n`);
	return false;
}

/**
 * Shared launch flow — both `refarm` (bare) and `refarm session` call this.
 *
 * 1. Readiness check → guide if not ready
 * 2. Onboarding if first run
 * 3. Resolve session ID
 * 4. Enter REPL
 */
export async function runSessionLaunchFlow(
	opts: { new?: boolean; session?: string; message?: string } = {},
	injectedDeps?: ChatDeps,
	launchDeps?: LaunchDeps,
): Promise<void> {
	const launch = launchDeps ?? defaultLaunchDeps();
	let readiness = await checkSessionReadiness();

	// Recovery pass 1: if provider not configured, offer inline setup.
	if (!readiness.providerConfigured && launch.recoverProvider) {
		const recovered = await launch.recoverProvider();
		if (recovered) readiness = { ...readiness, providerConfigured: true };
	}

	// Recovery pass 2: auto-start runtime when provider is now configured.
	let runtimeRunning = isRuntimeRunning(readiness);
	if (!runtimeRunning && readiness.providerConfigured) {
		runtimeRunning = await autoStartRuntime(findRepoRoot(), launch);
		if (!runtimeRunning) {
			process.exitCode = 1;
			return;
		}
	}

	const effectiveReadiness = { ...readiness, runtimeRunning, farmhandRunning: runtimeRunning };
	if (!isSessionReady(effectiveReadiness)) {
		printSessionGuide(effectiveReadiness);
		process.exitCode = 1;
		return;
	}

	if (isFirstRun()) {
		printOnboarding();
		return;
	}

	const deps = injectedDeps ?? defaultChatDeps();
	if (!(await ensureSessionRuntimeAgentReady(deps))) {
		process.exitCode = 1;
		return;
	}

	let sessionId: string;
	try {
		sessionId = await resolveTargetSession(opts, deps);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`✗  ${message}\n`);
		process.exitCode = 1;
		return;
	}

	await runSessionRepl(sessionId, deps, "refarm", opts.message);
}

export function createSessionCommand(deps?: ChatDeps): Command {
	return new Command("session")
		.description(
			"Start or resume an interactive session (the default when running bare `refarm`)",
		)
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm session",
				"  $ refarm session --new",
				"  $ refarm session --session <id-prefix>",
				"  $ refarm session \"continue daqui\"",
				"",
				"Notes:",
				"  Bare refarm runs the same launch flow as refarm session.",
				"  The launch flow configures credentials when missing and starts the selected runtime when allowed.",
				"  Inside the REPL, use /help for runtime commands such as /model, /login, and /reload.",
			].join("\n"),
		)
		.argument("[message]", "Initial message to send immediately")
		.option("--new", "Start a fresh session, discarding conversation history")
		.option("--session <id>", "Resume a specific session ID or unique prefix")
		.action(async (message: string | undefined, opts: { new?: boolean; session?: string }) => {
			await runSessionLaunchFlow({ ...opts, message }, deps);
		});
}

export const sessionCommand = createSessionCommand();
