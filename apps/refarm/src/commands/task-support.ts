import { isRuntimeAgentPluginId } from "@refarm.dev/config";
import {
	assertChannelControlCapability,
	parseTaskTransport as parseDispatchTransport,
	resolveChannelControlSurfaceAdapter,
	resolveChannelFromTransport,
	type ChannelControlSurfaceAdapter,
	type DispatchTransport,
} from "@refarm.dev/dispatch-surface";
import type {
	Effort,
	EffortLogEntry,
	EffortResult,
	EffortSummary,
	EffortTransportAdapter,
} from "@refarm.dev/effort-contract-v1";
import chalk from "chalk";
import { InvalidArgumentError } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { quoteCommandArg, refarmCommand } from "./command-handoff.js";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "./json-output.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";
import { resolveSidecarUrl } from "./sidecar-url.js";
import {
	observedEffortStatus,
	observedTaskResultError,
} from "./task-observation.js";
import {
	buildTaskLogsCommand,
	buildTaskStatusCommand,
	type TaskSessionCheckpoint,
	type TaskSessionEffortRecord,
} from "./task-session.js";
import { isFinalEffortStatus } from "./task-status.js";

export interface TaskOperationsAdapter extends EffortTransportAdapter {
	list(): Promise<EffortResult[]>;
	logs(effortId: string): Promise<EffortLogEntry[] | null>;
	retry(effortId: string): Promise<boolean>;
	cancel(effortId: string): Promise<boolean>;
	summary(): Promise<EffortSummary>;
}

export type TaskTransport = DispatchTransport;

export function parseTaskTransport(value: string): TaskTransport {
	try {
		return parseDispatchTransport(value);
	} catch (error) {
		throw new InvalidArgumentError(
			error instanceof Error ? error.message : String(error),
		);
	}
}

export function parsePositiveIntOption(value: string, label: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new InvalidArgumentError(`${label} must be a positive integer.`);
	}
	return parsed;
}

export function observedEffortFields(result: EffortResult): {
	observedStatus: EffortResult["status"];
	observedErrors?: string[];
} {
	const observedStatus = observedEffortStatus(result);
	const observedErrors = result.results
		.map((taskResult) => observedTaskResultError(taskResult.result))
		.filter((error): error is string => Boolean(error));
	return {
		observedStatus,
		...(observedErrors.length > 0 ? { observedErrors } : {}),
	};
}

function emptyEffortSummary(): EffortSummary {
	return {
		total: 0,
		pending: 0,
		inProgress: 0,
		done: 0,
		partial: 0,
		failed: 0,
		timedOut: 0,
		cancelled: 0,
	};
}

function incrementEffortSummary(
	summary: EffortSummary,
	status: EffortResult["status"],
): void {
	summary.total += 1;
	switch (status) {
		case "pending":
			summary.pending += 1;
			break;
		case "in-progress":
			summary.inProgress += 1;
			break;
		case "done":
			summary.done += 1;
			break;
		case "partial":
			summary.partial += 1;
			break;
		case "failed":
			summary.failed += 1;
			break;
		case "timed-out":
			summary.timedOut += 1;
			break;
		case "cancelled":
			summary.cancelled += 1;
			break;
	}
}

export function observedEffortList(efforts: EffortResult[]): Array<{
	effortId: string;
	status: EffortResult["status"];
	observedStatus: EffortResult["status"];
	observedErrors?: string[];
}> {
	return efforts.map((effort) => ({
		effortId: effort.effortId,
		status: effort.status,
		...observedEffortFields(effort),
	}));
}

export function observedEffortSummary(efforts: EffortResult[]): EffortSummary {
	const summary = emptyEffortSummary();
	for (const effort of efforts) {
		incrementEffortSummary(summary, observedEffortStatus(effort));
	}
	return summary;
}

export function formatEffortSummary(summary: EffortSummary): string {
	return `total=${summary.total} pending=${summary.pending} in-progress=${summary.inProgress} done=${summary.done} partial=${summary.partial} failed=${summary.failed} timed-out=${summary.timedOut} cancelled=${summary.cancelled}`;
}

export function effortSummariesEqual(
	a: EffortSummary,
	b: EffortSummary,
): boolean {
	return (
		a.total === b.total &&
		a.pending === b.pending &&
		a.inProgress === b.inProgress &&
		a.done === b.done &&
		a.partial === b.partial &&
		a.failed === b.failed &&
		a.timedOut === b.timedOut &&
		a.cancelled === b.cancelled
	);
}

export function formatLogMeta(
	meta: Record<string, unknown> | undefined,
): string {
	if (!meta) return "";
	const modelScope =
		typeof meta.modelScope === "string" ? meta.modelScope : undefined;
	const modelProvider =
		typeof meta.modelProvider === "string" ? meta.modelProvider : undefined;
	const modelId = typeof meta.modelId === "string" ? meta.modelId : undefined;
	const modelRoute =
		modelProvider && modelId
			? `${modelProvider}/${modelId}`
			: (modelProvider ?? modelId);
	const parts = [
		modelScope ? `scope=${modelScope}` : undefined,
		modelRoute ? `model=${modelRoute}` : undefined,
	].filter((part): part is string => Boolean(part));
	return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function baseSummary(): EffortSummary {
	return {
		total: 0,
		pending: 0,
		inProgress: 0,
		done: 0,
		partial: 0,
		failed: 0,
		timedOut: 0,
		cancelled: 0,
	};
}

export function formatAgeSeconds(submittedAt?: string): string {
	if (!submittedAt) return "-";
	const submittedMs = Date.parse(submittedAt);
	if (Number.isNaN(submittedMs)) return "-";
	return `${Math.max(0, Math.floor((Date.now() - submittedMs) / 1000))}s`;
}

export function printTaskJsonSuccess<TExtra extends object>(
	operation: string,
	extra: TExtra,
	nextCommands: string[] = [],
): void {
	printJson(
		buildJsonSuccessEnvelope({
			command: "task",
			operation,
			extra,
			nextActions: nextCommands,
			nextCommands,
		}),
	);
}

export function taskCheckpointJsonHandoff(
	checkpoint: TaskSessionCheckpoint,
): TaskSessionCheckpoint {
	return {
		...checkpoint,
		efforts: checkpoint.efforts.map((effort) => ({
			...effort,
			statusCommand: buildTaskStatusCommand(effort.effortId, effort.transport, {
				json: true,
			}),
			logsCommand: buildTaskLogsCommand(effort.effortId, effort.transport, {
				json: true,
			}),
		})),
	};
}

export function isResumableTaskSessionEffort(
	effort: TaskSessionEffortRecord,
): boolean {
	if (!effort.lastStatus || effort.lastStatus === "not-found") return false;
	return !isFinalEffortStatus(effort.lastStatus);
}

export function reportTaskControlError(
	operation: "retry" | "cancel",
	effortId: string,
	transport: TaskTransport,
	err: unknown,
	opts: { json?: boolean },
): void {
	const message = err instanceof Error ? err.message : String(err);
	const statusCommand = buildTaskStatusCommand(effortId, transport, {
		json: opts.json,
	});
	if (opts.json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "task",
				operation,
				error: `task-${operation}-failed`,
				message,
				nextAction: statusCommand,
				nextActions: [statusCommand, RUNTIME_DOCTOR_NEXT_ACTION_COMMAND],
				nextCommand: statusCommand,
				nextCommands: [
					statusCommand,
					RUNTIME_DOCTOR_NEXT_COMMAND,
					RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				],
				extra: {
					effortId,
					transport,
					action: operation,
					accepted: false,
				},
			}),
		);
		process.exitCode = 1;
		return;
	}
	console.error(
		chalk.red(
			`${operation === "retry" ? "Retry" : "Cancel"} failed for effort ${effortId}: ${message}`,
		),
	);
	console.error(chalk.dim(`  Status:   ${statusCommand}`));
	console.error(chalk.dim(`  Diagnose: ${RUNTIME_DOCTOR_COMMAND}`));
	process.exitCode = 1;
}

export function reportTaskReadError(
	operation: "status" | "logs",
	effortId: string,
	transport: TaskTransport,
	err: unknown,
	opts: { json?: boolean },
): void {
	const message = err instanceof Error ? err.message : String(err);
	const statusCommand = buildTaskStatusCommand(effortId, transport);
	const logsCommand = buildTaskLogsCommand(effortId, transport);
	const nextCommands =
		operation === "logs"
			? [statusCommand, RUNTIME_DOCTOR_NEXT_COMMAND]
			: [RUNTIME_DOCTOR_NEXT_COMMAND, RUNTIME_ENSURE_WAIT_NEXT_COMMAND];
	if (opts.json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "task",
				operation,
				error: `task-${operation}-failed`,
				message,
				nextAction:
					operation === "logs"
						? statusCommand
						: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
				nextActions:
					operation === "logs"
						? [statusCommand, RUNTIME_DOCTOR_NEXT_ACTION_COMMAND]
						: [RUNTIME_DOCTOR_NEXT_ACTION_COMMAND, RUNTIME_STATUS_COMMAND],
				nextCommand: nextCommands[0],
				nextCommands,
				extra: {
					effortId,
					transport,
					...(operation === "status" ? { logsCommand } : { statusCommand }),
				},
			}),
		);
		process.exitCode = 1;
		return;
	}
	console.error(
		chalk.red(
			`${operation === "status" ? "Status" : "Logs"} failed for effort ${effortId}: ${message}`,
		),
	);
	console.error(chalk.dim(`  Diagnose: ${RUNTIME_DOCTOR_COMMAND}`));
	process.exitCode = 1;
}

export function reportTaskListError(
	transport: TaskTransport,
	err: unknown,
	opts: { json?: boolean },
): void {
	const message = err instanceof Error ? err.message : String(err);
	if (opts.json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "task",
				operation: "list",
				error: "task-list-failed",
				message,
				nextAction: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
				nextActions: [
					RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
					RUNTIME_STATUS_COMMAND,
				],
				nextCommand: RUNTIME_DOCTOR_NEXT_COMMAND,
				nextCommands: [
					RUNTIME_DOCTOR_NEXT_COMMAND,
					RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				],
				extra: {
					transport,
				},
			}),
		);
		process.exitCode = 1;
		return;
	}
	console.error(chalk.red(`Task list failed: ${message}`));
	console.error(chalk.dim(`  Diagnose: ${RUNTIME_DOCTOR_COMMAND}`));
	process.exitCode = 1;
}

export function buildTaskRunCommand(
	plugin: string,
	fn: string,
	options: { transport: string; json?: boolean } = { transport: "file" },
): string {
	return refarmCommand([
		"task",
		"run",
		quoteCommandArg(plugin),
		quoteCommandArg(fn),
		"--args",
		quoteCommandArg("{}"),
		"--transport",
		options.transport,
		...(options.json ? ["--json"] : []),
	]);
}

class FileTransportClient implements TaskOperationsAdapter {
	private readonly tasksDir: string;
	private readonly resultsDir: string;
	private readonly logsDir: string;
	private readonly controlDir: string;

	constructor(baseDir: string) {
		this.tasksDir = path.join(baseDir, "tasks");
		this.resultsDir = path.join(baseDir, "task-results");
		this.logsDir = path.join(baseDir, "task-logs");
		this.controlDir = path.join(baseDir, "task-control");
		fs.mkdirSync(this.tasksDir, { recursive: true });
		fs.mkdirSync(this.resultsDir, { recursive: true });
		fs.mkdirSync(this.logsDir, { recursive: true });
		fs.mkdirSync(this.controlDir, { recursive: true });
	}

	async submit(effort: Effort): Promise<string> {
		fs.writeFileSync(
			path.join(this.tasksDir, `${effort.id}.json`),
			JSON.stringify(effort, null, 2),
			"utf-8",
		);

		const resultPath = path.join(this.resultsDir, `${effort.id}.json`);
		if (!fs.existsSync(resultPath)) {
			const pending: EffortResult = {
				effortId: effort.id,
				status: "pending",
				results: [],
				submittedAt: effort.submittedAt,
				lastUpdatedAt: new Date().toISOString(),
			};
			fs.writeFileSync(resultPath, JSON.stringify(pending, null, 2), "utf-8");
		}

		return effort.id;
	}

	async query(effortId: string): Promise<EffortResult | null> {
		const file = path.join(this.resultsDir, `${effortId}.json`);
		if (!fs.existsSync(file)) return null;
		return JSON.parse(fs.readFileSync(file, "utf-8")) as EffortResult;
	}

	async list(): Promise<EffortResult[]> {
		const results: EffortResult[] = [];
		for (const filename of fs.readdirSync(this.resultsDir)) {
			if (!filename.endsWith(".json")) continue;
			const effortId = filename.replace(/\.json$/, "");
			const parsed = await this.query(effortId);
			if (parsed) results.push(parsed);
		}
		results.sort((a, b) => {
			const aStamp = a.completedAt ?? a.startedAt ?? a.submittedAt ?? "";
			const bStamp = b.completedAt ?? b.startedAt ?? b.submittedAt ?? "";
			return bStamp.localeCompare(aStamp);
		});
		return results;
	}

	async logs(effortId: string): Promise<EffortLogEntry[] | null> {
		const file = path.join(this.logsDir, `${effortId}.ndjson`);
		if (!fs.existsSync(file)) return null;

		const entries: EffortLogEntry[] = [];
		for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				entries.push(JSON.parse(trimmed) as EffortLogEntry);
			} catch {
				// ignore malformed lines
			}
		}
		return entries;
	}

	private writeControlRequest(
		effortId: string,
		action: "retry" | "cancel",
	): boolean {
		const effortPath = path.join(this.tasksDir, `${effortId}.json`);
		if (!fs.existsSync(effortPath)) return false;

		const payload = {
			effortId,
			action,
			requestedAt: new Date().toISOString(),
		};
		fs.writeFileSync(
			path.join(this.controlDir, `${effortId}.${action}.json`),
			JSON.stringify(payload, null, 2),
			"utf-8",
		);
		return true;
	}

	async retry(effortId: string): Promise<boolean> {
		return this.writeControlRequest(effortId, "retry");
	}

	async cancel(effortId: string): Promise<boolean> {
		return this.writeControlRequest(effortId, "cancel");
	}

	async summary(): Promise<EffortSummary> {
		const summary = baseSummary();
		const efforts = await this.list();
		summary.total = efforts.length;
		for (const effort of efforts) {
			switch (effort.status) {
				case "pending":
					summary.pending += 1;
					break;
				case "in-progress":
					summary.inProgress += 1;
					break;
				case "done":
					summary.done += 1;
					break;
				case "partial":
					summary.partial += 1;
					break;
				case "failed":
					summary.failed += 1;
					break;
				case "timed-out":
					summary.timedOut += 1;
					break;
				case "cancelled":
					summary.cancelled += 1;
					break;
			}
		}
		return summary;
	}
}

class HttpTransportClient implements TaskOperationsAdapter {
	constructor(private readonly baseUrl: string) {}

	async submit(effort: Effort): Promise<string> {
		const response = await fetch(`${this.baseUrl}/efforts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(effort),
		});

		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const payload = (await response.json()) as { effortId: string };
		return payload.effortId;
	}

	async query(effortId: string): Promise<EffortResult | null> {
		const response = await fetch(`${this.baseUrl}/efforts/${effortId}`);
		if (response.status === 404) return null;
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as EffortResult;
	}

	async list(): Promise<EffortResult[]> {
		const response = await fetch(`${this.baseUrl}/efforts`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as EffortResult[];
	}

	async logs(effortId: string): Promise<EffortLogEntry[] | null> {
		const response = await fetch(`${this.baseUrl}/efforts/${effortId}/logs`);
		if (response.status === 404) return null;
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as EffortLogEntry[];
	}

	private async command(
		effortId: string,
		action: "retry" | "cancel",
	): Promise<boolean> {
		const response = await fetch(
			`${this.baseUrl}/efforts/${effortId}/${action}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
			},
		);
		if (response.status === 409 || response.status === 404) return false;
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return true;
	}

	async retry(effortId: string): Promise<boolean> {
		return this.command(effortId, "retry");
	}

	async cancel(effortId: string): Promise<boolean> {
		return this.command(effortId, "cancel");
	}

	async summary(): Promise<EffortSummary> {
		const response = await fetch(`${this.baseUrl}/efforts/summary`);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as EffortSummary;
	}
}

class HttpChannelTransportClient implements TaskOperationsAdapter {
	private readonly channel: string;
	private readonly adapter: ChannelControlSurfaceAdapter;

	constructor(
		private readonly baseUrl: string,
		channel: string,
		adapter?: ChannelControlSurfaceAdapter,
	) {
		this.channel = channel;
		this.adapter =
			adapter ?? resolveChannelControlSurfaceAdapter(channel).adapter;
	}

	private channelEffortsPath(): string {
		return this.adapter.buildSubmitPath(this.baseUrl, this.channel);
	}

	async submit(effort: Effort): Promise<string> {
		assertChannelControlCapability(this.adapter, "submit");
		const response = await fetch(this.channelEffortsPath(), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(effort),
		});

		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const payload = (await response.json()) as { effortId: string };
		return payload.effortId;
	}

	async query(effortId: string): Promise<EffortResult | null> {
		assertChannelControlCapability(this.adapter, "query");
		const response = await fetch(
			this.adapter.buildQueryPath(this.baseUrl, this.channel, effortId),
		);
		if (response.status === 404) return null;
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as EffortResult;
	}

	async list(): Promise<EffortResult[]> {
		assertChannelControlCapability(this.adapter, "list");
		const response = await fetch(
			this.adapter.buildListPath(this.baseUrl, this.channel),
		);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as EffortResult[];
	}

	async logs(effortId: string): Promise<EffortLogEntry[] | null> {
		assertChannelControlCapability(this.adapter, "logs");
		const response = await fetch(
			this.adapter.buildLogsPath(this.baseUrl, this.channel, effortId),
		);
		if (response.status === 404) return null;
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as EffortLogEntry[];
	}

	private async command(
		effortId: string,
		action: "retry" | "cancel",
	): Promise<boolean> {
		assertChannelControlCapability(this.adapter, action);
		const path =
			action === "retry"
				? this.adapter.buildRetryPath(this.baseUrl, this.channel, effortId)
				: this.adapter.buildCancelPath(this.baseUrl, this.channel, effortId);
		const response = await fetch(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
		});
		if (response.status === 409 || response.status === 404) return false;
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return true;
	}

	async retry(effortId: string): Promise<boolean> {
		return this.command(effortId, "retry");
	}

	async cancel(effortId: string): Promise<boolean> {
		return this.command(effortId, "cancel");
	}

	async summary(): Promise<EffortSummary> {
		assertChannelControlCapability(this.adapter, "summary");
		const response = await fetch(
			this.adapter.buildSummaryPath(this.baseUrl, this.channel),
		);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return (await response.json()) as EffortSummary;
	}
}

export function resolveAdapter(transport: string): TaskOperationsAdapter {
	const resolvedTransport = parseTaskTransport(transport);
	const channel = resolveChannelFromTransport(resolvedTransport);
	if (channel) {
		const { adapter } = resolveChannelControlSurfaceAdapter(channel);
		return new HttpChannelTransportClient(
			resolveSidecarUrl(),
			channel,
			adapter,
		);
	}
	if (resolvedTransport === "http") {
		return new HttpTransportClient(resolveSidecarUrl());
	}

	return new FileTransportClient(path.join(os.homedir(), ".refarm"));
}

export function deriveAttemptCount(result: EffortResult): number {
	if (typeof result.attemptCount === "number") {
		return result.attemptCount;
	}
	return result.results.reduce(
		(acc, taskResult) => acc + Number(taskResult.attempts ?? 0),
		0,
	);
}

export function safeSessionRecord(fn: () => void): void {
	try {
		fn();
	} catch {
		// session persistence must never break task operations
	}
}

export function isRuntimeAgentRespondTask(plugin: string, fn: string): boolean {
	return isRuntimeAgentPluginId(plugin) && fn === "respond";
}

export function resolveTaskAdapter(
	transport: TaskTransport,
	adapterResolver: (transport: string) => TaskOperationsAdapter,
): { transport: TaskTransport; adapter: TaskOperationsAdapter } {
	return {
		transport,
		adapter: adapterResolver(transport),
	};
}
