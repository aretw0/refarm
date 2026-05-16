import { Command } from "commander";
import {
	checkSessionReadiness,
	isFirstRun,
	isSessionReady,
	printOnboarding,
	printSessionGuide,
	autoStartFarmhand,
	defaultLaunchDeps,
	findRepoRoot,
	type LaunchDeps,
} from "./session-launch.js";
import {
	defaultChatDeps,
	runSessionRepl,
	type ChatDeps,
} from "./chat.js";
import { isFullSessionId, resolveSessionIdPrefix } from "./session-ids.js";
import {
	clearActiveSessionId,
	readActiveSessionId,
	writeActiveSessionIdAndVerify,
} from "./session-lock.js";

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
	const response = await fetch("http://127.0.0.1:42001/sessions");
	if (!response.ok) throw new Error(`sidecar HTTP ${response.status}`);
	const body = (await response.json()) as { sessions?: Array<{ "@id": string }> };
	return resolveSessionIdPrefix(prefix, body.sessions ?? []);
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
	const readiness = await checkSessionReadiness();

	let farmhandRunning = readiness.farmhandRunning;

	if (!farmhandRunning && readiness.providerConfigured) {
		farmhandRunning = await autoStartFarmhand(
			findRepoRoot(),
			launchDeps ?? defaultLaunchDeps(),
		);
		if (!farmhandRunning) process.exit(1);
	}

	const effectiveReadiness = { ...readiness, farmhandRunning };
	if (!isSessionReady(effectiveReadiness)) {
		printSessionGuide(effectiveReadiness);
		process.exit(1);
	}

	if (isFirstRun()) {
		printOnboarding();
		process.exit(0);
	}

	const deps = injectedDeps ?? defaultChatDeps();

	let sessionId: string;
	try {
		sessionId = await resolveTargetSession(opts, deps);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`✗  ${message}\n`);
		process.exit(1);
	}

	await runSessionRepl(sessionId, deps, "refarm", opts.message);
}

export function createSessionCommand(deps?: ChatDeps): Command {
	return new Command("session")
		.description(
			"Start or resume an interactive session (the default when running bare `refarm`)",
		)
		.argument("[message]", "Initial message to send immediately")
		.option("--new", "Start a fresh session, discarding conversation history")
		.option("--session <id>", "Resume a specific session ID or unique prefix")
		.action(async (message: string | undefined, opts: { new?: boolean; session?: string }) => {
			await runSessionLaunchFlow({ ...opts, message }, deps);
		});
}

export const sessionCommand = createSessionCommand();
