import { printJson } from "@refarm.dev/capabilities/envelope";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveOperatorAttentionProfile } from "./operator-attention-profile.js";

interface IntentionCommandOptions {
	scope?: string;
	windowMs?: number;
	profile?: string;
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

export function createIntentionCommand(deps: IntentionCommandDeps = {}): Command {
	const command = new Command("intention").description(
		"Manage explicit operator-attention intent across devices and workflows",
	);

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
		.option("--json", "Output machine-readable JSON")
		.action((options: IntentionCommandOptions) => {
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
				nextAction: `Verifique a prontidão da intenção '${target.scope}'.`,
				nextActions: [`Verifique a prontidão da intenção '${target.scope}'.`],
				nextCommand: intentionCheckCommand(target.scope, target.windowMs),
				nextCommands: [intentionCheckCommand(target.scope, target.windowMs)],
			};
			emit(payload, options.json ?? false, `Intenção armada para '${target.scope}'.`);
		});

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
		.option("--json", "Output machine-readable JSON")
		.action((options: IntentionCommandOptions) => {
			const now = deps.now?.() ?? Date.now();
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
				options.json ?? false,
				armed
					? `Intenção pronta para '${target.scope}'.`
					: `Intenção ainda não armada para '${target.scope}'.`,
			);
			process.exitCode = armed ? 0 : 2;
		});

	command
		.command("consume")
		.description("Consume operator-attention intent")
		.option("--scope <scope>", "Attention scope to consume")
		.option(
			"--profile <name>",
			"Named intent profile (cross-device-handoff | mobile-ready | operator-sync)",
		)
		.option("--json", "Output machine-readable JSON")
		.action((options: IntentionCommandOptions) => {
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
			emit(payload, options.json ?? false, `Intenção consumida para '${target.scope}'.`);
		});

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

function emit(payload: Record<string, unknown>, json: boolean, message: string): void {
	if (json) {
		printJson(payload);
		return;
	}
	console.log(message);
}

function resolveRefarmHome(): string {
	const envHome = process.env.REFARM_HOME?.trim();
	if (envHome) return envHome;

	const cwdRefarm = path.join(process.cwd(), ".refarm");
	if (fs.existsSync(cwdRefarm)) return cwdRefarm;

	return path.join(os.homedir(), ".refarm");
}

function operatorAttentionStatePath(scope: string): string {
	const refarmHome = resolveRefarmHome();
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
