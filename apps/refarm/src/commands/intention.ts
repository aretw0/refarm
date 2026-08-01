import { buildJsonErrorEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

import { resolveRefarmScopeRoot } from "../utils/refarm-home.js";
import { resolveOperatorAttentionProfile } from "./operator-attention-profile.js";

interface IntentionCommandOptions {
	scope?: string;
	windowMs?: number;
	profile?: string;
	token?: string;
	output?: string;
	json?: boolean;
}

interface OperatorAttentionGateState {
	armedAt?: number;
	armedIso?: string | null;
	windowMs?: number;
	source?: string;
}

export interface IntentionCommandDeps {
	now?: () => number;
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

const INTENTION_HELP_COMMAND = "refarm intention --help";

/**
 * The action boundary. An operator-facing command must never surface a raw Node
 * stack trace, and a `--json` consumer must get an envelope on the error path too —
 * the same contract `connection.ts` follows. Every `throw` below stays as an internal
 * signal; this is the single place they stop being one.
 *
 * Found by running `refarm intention check --json` with no `--scope`: it printed a
 * stack trace and ignored `--json` entirely, and none of the suite's 1967 tests
 * exercised a missing-argument path.
 */
function failIntention(operation: string, options: IntentionCommandOptions, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	if (options.json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "intention",
				operation,
				error: "intention-invalid-request",
				message,
				nextAction: `Run \`${INTENTION_HELP_COMMAND}\` to see the accepted options.`,
				nextCommand: INTENTION_HELP_COMMAND,
			}),
		);
	} else {
		console.error(chalk.red(`✗  ${message}`));
		console.error(chalk.dim(`   ${INTENTION_HELP_COMMAND}`));
	}
	process.exitCode = 1;
}

/** Wrap an action so a thrown validation error becomes the repo's refusal shape
 *  instead of an uncaught exception. */
function guarded(
	operation: string,
	handler: (options: IntentionCommandOptions) => void,
): (options: IntentionCommandOptions) => void {
	return (options) => {
		try {
			handler(options);
		} catch (error) {
			failIntention(operation, options, error);
		}
	};
}

export function createIntentionCommand(deps: IntentionCommandDeps = {}): Command {
	const command = new Command("intention").description(
		"Manage explicit operator-attention intent across devices and workflows",
	);

	command
		.command("prepare")
		.description("Prepare portable intent handoff without writing local state")
		.option("--scope <scope>", "Attention scope to prepare")
		.option(
			"--window-ms <ms>",
			"Window (ms) that keeps the portable intent valid",
			parsePositiveInt,
		)
		.option(
			"--profile <name>",
			"Named intent profile (cross-device-handoff | mobile-ready | operator-sync)",
		)
		.option("--output <mode>", "JSON output mode: full | compact")
		.option("--json", "Output machine-readable JSON")
		.action(guarded("prepare", (options: IntentionCommandOptions) => {
			const now = deps.now?.() ?? Date.now();
			const target = resolveAttentionTarget(options);
			const token = encodeIntentToken({
				scope: target.scope,
				armedAt: now,
				windowMs: target.windowMs,
			});
			const payload = {
				ok: true,
				command: "intention",
				operation: "prepare",
				source: "portable",
				scope: target.scope,
				windowMs: target.windowMs,
				expiresAt: new Date(now + target.windowMs).toISOString(),
				intentToken: token,
				nextAction: "Compartilhe o token com o dispositivo que executará a operação.",
				nextActions: ["Compartilhe o token com o dispositivo que executará a operação."],
				nextCommand: intentionCheckTokenCommand(token),
				nextCommands: [
					intentionCheckTokenCommand(token),
					intentionConsumeTokenCommand(token),
				],
			};
			emit(payload, options, `Intenção portátil preparada para '${target.scope}'.`);
		}));

	command
		.command("arm")
		.description("Arm operator-attention intent")
		.option("--scope <scope>", "Attention scope to arm")
		.option(
			"--window-ms <ms>",
			"Window (ms) that keeps the intent armed",
			parsePositiveInt,
		)
		.option(
			"--profile <name>",
			"Named intent profile (cross-device-handoff | mobile-ready | operator-sync)",
		)
		.option("--output <mode>", "JSON output mode: full | compact")
		.option("--json", "Output machine-readable JSON")
		.action(guarded("arm", (options: IntentionCommandOptions) => {
			const now = deps.now?.() ?? Date.now();
			const target = resolveAttentionTarget(options);
			const statePath = operatorAttentionStatePath(target.scope);
			const previous = readState(statePath);
			const nextState: OperatorAttentionGateState = {
				...previous,
				armedAt: now,
				armedIso: new Date(now).toISOString(),
				windowMs: target.windowMs,
				source: "refarm intention arm",
			};
			writeState(statePath, nextState);

			const payload = {
				ok: true,
				command: "intention",
				operation: "arm",
				scope: target.scope,
				windowMs: target.windowMs,
				expiresAt: new Date(now + target.windowMs).toISOString(),
				intentToken: encodeIntentToken({
					scope: target.scope,
					armedAt: now,
					windowMs: target.windowMs,
				}),
				nextAction: `Verifique a prontidão da intenção '${target.scope}'.`,
				nextActions: [`Verifique a prontidão da intenção '${target.scope}'.`],
				nextCommand: intentionCheckCommand(target.scope, target.windowMs),
				nextCommands: [intentionCheckCommand(target.scope, target.windowMs)],
			};
			emit(payload, options, `Intenção armada para '${target.scope}'.`);
		}));

	command
		.command("check")
		.description("Check operator-attention intent readiness")
		.option("--scope <scope>", "Attention scope to check")
		.option(
			"--window-ms <ms>",
			"Window (ms) used to evaluate readiness",
			parsePositiveInt,
		)
		.option(
			"--profile <name>",
			"Named intent profile (cross-device-handoff | mobile-ready | operator-sync)",
		)
		.option("--token <value>", "Portable intent token from another device")
		.option("--output <mode>", "JSON output mode: full | compact")
		.option("--json", "Output machine-readable JSON")
		.action(guarded("check", (options: IntentionCommandOptions) => {
			const now = deps.now?.() ?? Date.now();
			if (options.token) {
				const tokenState = decodeIntentToken(options.token);
				if (!tokenState) {
					throw new Error("Invalid --token value.");
				}
				const ageMs = now - tokenState.armedAt;
				const armed = ageMs >= 0 && ageMs <= tokenState.windowMs;
				const payload = {
					ok: armed,
					command: "intention",
					operation: "check",
					source: "token",
					scope: tokenState.scope,
					windowMs: tokenState.windowMs,
					armed,
					expiresAt: armed
						? new Date(tokenState.armedAt + tokenState.windowMs).toISOString()
						: null,
					nextAction: armed ? null : `Arme a intenção '${tokenState.scope}'.`,
					nextActions: armed ? [] : [`Arme a intenção '${tokenState.scope}'.`],
					nextCommand: armed
						? null
						: intentionArmCommand(tokenState.scope, tokenState.windowMs),
					nextCommands: armed
						? []
						: [intentionArmCommand(tokenState.scope, tokenState.windowMs)],
				};
				emit(
					payload,
					options,
					armed
						? `Intenção pronta para '${tokenState.scope}' (token).`
						: `Intenção expirada ou inválida para '${tokenState.scope}' (token).`,
				);
				process.exitCode = armed ? 0 : 2;
				return;
			}
			const target = resolveAttentionTarget(options);
			const statePath = operatorAttentionStatePath(target.scope);
			const state = readState(statePath);
			const armedAt = Number(state.armedAt ?? 0);
			const ageMs = now - armedAt;
			const windowMs = Number(state.windowMs ?? target.windowMs);
			const armed = Number.isFinite(armedAt) && armedAt > 0 && ageMs >= 0 && ageMs <= windowMs;
			const payload = {
				ok: armed,
				command: "intention",
				operation: "check",
				scope: target.scope,
				windowMs,
				armed,
				expiresAt: armed ? new Date(armedAt + windowMs).toISOString() : null,
				nextAction: armed ? null : `Arme a intenção '${target.scope}'.`,
				nextActions: armed ? [] : [`Arme a intenção '${target.scope}'.`],
				nextCommand: armed ? null : intentionArmCommand(target.scope, windowMs),
				nextCommands: armed ? [] : [intentionArmCommand(target.scope, windowMs)],
			};
			emit(
				payload,
				options,
				armed
					? `Intenção pronta para '${target.scope}'.`
					: `Intenção ainda não armada para '${target.scope}'.`,
			);
			process.exitCode = armed ? 0 : 2;
		}));

	command
		.command("consume")
		.description("Consume operator-attention intent")
		.option("--scope <scope>", "Attention scope to consume")
		.option(
			"--profile <name>",
			"Named intent profile (cross-device-handoff | mobile-ready | operator-sync)",
		)
		.option("--token <value>", "Portable intent token from another device")
		.option("--output <mode>", "JSON output mode: full | compact")
		.option("--json", "Output machine-readable JSON")
		.action(guarded("consume", (options: IntentionCommandOptions) => {
			if (options.token) {
				const tokenState = decodeIntentToken(options.token);
				if (!tokenState) {
					throw new Error("Invalid --token value.");
				}
				const payload = {
					ok: true,
					command: "intention",
					operation: "consume",
					source: "token",
					scope: tokenState.scope,
					nextAction: `Arme novamente a intenção '${tokenState.scope}' quando necessário.`,
					nextActions: [
						`Arme novamente a intenção '${tokenState.scope}' quando necessário.`,
					],
					nextCommand: intentionArmCommand(tokenState.scope, tokenState.windowMs),
					nextCommands: [intentionArmCommand(tokenState.scope, tokenState.windowMs)],
				};
				emit(
					payload,
					options,
					`Intenção consumida para '${tokenState.scope}' (token).`,
				);
				return;
			}
			const target = resolveAttentionTarget(options);
			const statePath = operatorAttentionStatePath(target.scope);
			const state = readState(statePath);
			const nextState: OperatorAttentionGateState = {
				...state,
				armedAt: 0,
				armedIso: null,
			};
			writeState(statePath, nextState);
			const payload = {
				ok: true,
				command: "intention",
				operation: "consume",
				scope: target.scope,
				nextAction: `Arme novamente a intenção '${target.scope}' quando necessário.`,
				nextActions: [`Arme novamente a intenção '${target.scope}' quando necessário.`],
				nextCommand: intentionArmCommand(target.scope, target.windowMs),
				nextCommands: [intentionArmCommand(target.scope, target.windowMs)],
			};
			emit(payload, options, `Intenção consumida para '${target.scope}'.`);
		}));

	return command;
}

export const intentionCommand = createIntentionCommand();

function resolveAttentionTarget(options: IntentionCommandOptions): { scope: string; windowMs: number } {
	const profile = resolveOperatorAttentionProfile(options.profile);
	const scope = options.scope?.trim() || profile?.scope;
	if (!scope) {
		throw new Error("Provide --scope or --profile.");
	}
	const windowMs = options.windowMs ?? profile?.windowMs ?? defaultWindowMs();
	return { scope, windowMs };
}

function defaultWindowMs(): number {
	const parsed = Number(process.env.REFARM_OPERATOR_ATTENTION_WINDOW_MS ?? DEFAULT_WINDOW_MS);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WINDOW_MS;
	return parsed;
}

function intentionArmCommand(scope: string, windowMs: number): string {
	return `refarm intention arm --scope ${shellQuote(scope)} --window-ms ${windowMs} --json`;
}

function intentionCheckCommand(scope: string, windowMs: number): string {
	return `refarm intention check --scope ${shellQuote(scope)} --window-ms ${windowMs} --json`;
}

function intentionCheckTokenCommand(token: string): string {
	return `refarm intention check --token ${shellQuote(token)} --json`;
}

function intentionConsumeTokenCommand(token: string): string {
	return `refarm intention consume --token ${shellQuote(token)} --json`;
}

type IntentionOutputMode = "full" | "compact";

function emit(payload: Record<string, unknown>, options: IntentionCommandOptions, message: string): void {
	if (options.json) {
		const outputMode = resolveOutputMode(options.output);
		printJson(projectPayloadByOutputMode(payload, outputMode));
		return;
	}
	console.log(message);
}

function resolveOutputMode(value?: string): IntentionOutputMode {
	if (!value || value === "full") return "full";
	if (value === "compact") return "compact";
	throw new Error("--output must be one of: full, compact.");
}

function projectPayloadByOutputMode(
	payload: Record<string, unknown>,
	mode: IntentionOutputMode,
): Record<string, unknown> {
	if (mode === "full") return payload;

	const compact: Record<string, unknown> = {
		v: 1,
		ok: payload.ok,
		op: payload.operation,
		scope: payload.scope,
	};
	if (payload.source !== undefined) compact.source = payload.source;
	if (payload.windowMs !== undefined) compact.windowMs = payload.windowMs;
	if (payload.armed !== undefined) compact.armed = payload.armed;
	if (payload.expiresAt !== undefined) compact.expiresAt = payload.expiresAt;
	if (payload.intentToken !== undefined) compact.intentToken = payload.intentToken;
	if (Array.isArray(payload.nextCommands)) compact.nextCommands = payload.nextCommands;
	if (payload.nextCommand !== undefined) compact.nextCommand = payload.nextCommand;
	return compact;
}

function operatorAttentionStatePath(scope: string): string {
	const refarmHome = resolveRefarmScopeRoot();
	const dir = path.join(refarmHome, "operator-attention");
	fs.mkdirSync(dir, { recursive: true });
	const safeScope = scope.replace(/[^a-zA-Z0-9._:-]/g, "_");
	return path.join(dir, `${safeScope}.json`);
}

function readState(filePath: string): OperatorAttentionGateState {
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		return JSON.parse(raw) as OperatorAttentionGateState;
	} catch {
		return {};
	}
}

function writeState(filePath: string, state: OperatorAttentionGateState): void {
	fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function parsePositiveInt(value: string): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
		throw new Error("--window-ms must be a positive integer.");
	}
	return parsed;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

interface PortableIntentTokenState {
	scope: string;
	armedAt: number;
	windowMs: number;
}

function encodeIntentToken(state: PortableIntentTokenState): string {
	const payload = {
		v: 1,
		scope: state.scope,
		armedAt: state.armedAt,
		windowMs: state.windowMs,
	};
	const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	return `rfint.v1.${encoded}`;
}

function decodeIntentToken(token: string): PortableIntentTokenState | null {
	if (!token.startsWith("rfint.v1.")) return null;
	const encoded = token.slice("rfint.v1.".length);
	if (!encoded) return null;
	try {
		const raw = Buffer.from(encoded, "base64url").toString("utf8");
		const parsed = JSON.parse(raw) as {
			v?: number;
			scope?: unknown;
			armedAt?: unknown;
			windowMs?: unknown;
		};
		if (parsed.v !== 1) return null;
		if (typeof parsed.scope !== "string" || !parsed.scope.trim()) return null;
		const armedAt = Number(parsed.armedAt);
		const windowMs = Number(parsed.windowMs);
		if (!Number.isFinite(armedAt) || armedAt <= 0) return null;
		if (!Number.isFinite(windowMs) || windowMs <= 0) return null;
		return {
			scope: parsed.scope,
			armedAt,
			windowMs,
		};
	} catch {
		return null;
	}
}
