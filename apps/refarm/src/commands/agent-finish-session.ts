import type { OperatorResumeFinishRecord } from "@refarm.dev/cli/operator-resume";
import type { CommandPlanRunResult } from "@refarm.dev/cli/command-plan";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AGENT_FINISH_SESSION_VERSION = 1 as const;

export interface AgentFinishSessionCheckpoint {
	version: typeof AGENT_FINISH_SESSION_VERSION;
	latest?: OperatorResumeFinishRecord;
}

export interface AgentFinishSessionRecorder {
	rememberRun(record: OperatorResumeFinishRecord): void;
	getCheckpoint(): AgentFinishSessionCheckpoint | null;
	getLatest(): OperatorResumeFinishRecord | null;
}

export function buildAgentFinishRecord(input: {
	result: CommandPlanRunResult;
	selection: {
		profile?: string | null;
		lane?: string | null;
		validationScope?: string | null;
	};
	command: string;
	now?: () => string;
}): OperatorResumeFinishRecord {
	return {
		updatedAt: input.now?.() ?? new Date().toISOString(),
		status: input.result.status,
		command: input.command,
		profile: input.selection.profile ?? null,
		lane: input.selection.lane ?? null,
		validationScope: input.selection.validationScope ?? null,
		failedStepId: input.result.failedStepId,
		failedCommand: input.result.failedCommand,
		nextCommands: input.result.nextCommands,
		remainingCommands: input.result.remainingCommands,
	};
}

export class FileAgentFinishSessionRecorder
	implements AgentFinishSessionRecorder
{
	private readonly sessionsDir: string;
	private readonly sessionFilePath: string;

	constructor(baseDir = path.join(os.homedir(), ".refarm")) {
		this.sessionsDir = path.join(baseDir, "sessions");
		this.sessionFilePath = path.join(
			this.sessionsDir,
			"agent-finish-session.v1.json",
		);
	}

	rememberRun(record: OperatorResumeFinishRecord): void {
		fs.mkdirSync(this.sessionsDir, { recursive: true });
		fs.writeFileSync(
			this.sessionFilePath,
			JSON.stringify(
				{
					version: AGENT_FINISH_SESSION_VERSION,
					latest: normalizeFinishRecord(record),
				},
				null,
				2,
			),
			"utf-8",
		);
	}

	getCheckpoint(): AgentFinishSessionCheckpoint | null {
		if (!fs.existsSync(this.sessionFilePath)) return null;
		try {
			const content = fs.readFileSync(this.sessionFilePath, "utf-8");
			const raw = JSON.parse(content) as unknown;
			return normalizeCheckpoint(raw);
		} catch {
			return null;
		}
	}

	getLatest(): OperatorResumeFinishRecord | null {
		return this.getCheckpoint()?.latest ?? null;
	}
}

export function createAgentFinishSessionRecorder(
	baseDir?: string,
): AgentFinishSessionRecorder {
	return new FileAgentFinishSessionRecorder(baseDir);
}

function normalizeCheckpoint(raw: unknown): AgentFinishSessionCheckpoint | null {
	if (!raw || typeof raw !== "object") return null;
	const current = raw as Record<string, unknown>;
	const latest = normalizeFinishRecord(current.latest);
	return latest
		? {
				version: AGENT_FINISH_SESSION_VERSION,
				latest,
			}
		: null;
}

function normalizeFinishRecord(
	raw: unknown,
): OperatorResumeFinishRecord | null {
	if (!raw || typeof raw !== "object") return null;
	const current = raw as Record<string, unknown>;
	const status = current.status === "passed" || current.status === "failed"
		? current.status
		: null;
	if (!status) return null;
	const command = typeof current.command === "string" ? current.command : "";
	const updatedAt =
		typeof current.updatedAt === "string"
			? current.updatedAt
			: new Date().toISOString();
	return {
		updatedAt,
		status,
		command,
		profile: typeof current.profile === "string" ? current.profile : null,
		lane: typeof current.lane === "string" ? current.lane : null,
		validationScope:
			typeof current.validationScope === "string"
				? current.validationScope
				: null,
		failedStepId:
			typeof current.failedStepId === "string" ? current.failedStepId : null,
		failedCommand:
			typeof current.failedCommand === "string" ? current.failedCommand : null,
		nextCommands: normalizeStringArray(current.nextCommands),
		remainingCommands: normalizeStringArray(current.remainingCommands),
	};
}

function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}
