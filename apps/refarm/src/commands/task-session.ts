import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
	Effort,
	EffortLogEntry,
	EffortResult,
	EffortStatus,
} from "@refarm.dev/effort-contract-v1";

const SESSION_VERSION = 1 as const;
const DEFAULT_MAX_EFFORTS = 25;

const FINAL_STATUSES = new Set<EffortStatus>(["done", "failed", "cancelled"]);

export type SessionStatus = EffortStatus | "not-found";

export interface TaskSessionEffortRecord {
	effortId: string;
	transport: string;
	submittedAt?: string;
	direction?: string;
	source?: string;
	lastStatus?: SessionStatus;
	lastStatusAt?: string;
	lastCommand?: "run" | "status" | "list" | "logs" | "retry" | "cancel";
	lastLogAt?: string;
	statusCommand: string;
	logsCommand: string;
}

export interface TaskSessionCheckpoint {
	version: typeof SESSION_VERSION;
	updatedAt: string;
	activeEffortId?: string;
	efforts: TaskSessionEffortRecord[];
}

export interface TaskSessionRecorder {
	rememberRun(input: { effort: Effort; transport: string }): void;
	rememberStatus(input: {
		effortId: string;
		transport: string;
		result: EffortResult | null;
	}): void;
	rememberList(input: { transport: string; efforts: EffortResult[] }): void;
	rememberLogs(input: {
		effortId: string;
		transport: string;
		logs: EffortLogEntry[];
	}): void;
	rememberControl(input: {
		effortId: string;
		transport: string;
		action: "retry" | "cancel";
	}): void;
	getCheckpoint(): TaskSessionCheckpoint | null;
}

function nowIso(): string {
	return new Date().toISOString();
}

function buildStatusCommand(effortId: string, transport: string): string {
	return `refarm task status ${effortId} --transport ${transport}`;
}

function buildLogsCommand(effortId: string, transport: string): string {
	return `refarm task logs ${effortId} --transport ${transport}`;
}

function emptyCheckpoint(): TaskSessionCheckpoint {
	return {
		version: SESSION_VERSION,
		updatedAt: nowIso(),
		efforts: [],
	};
}

function normalizeCheckpoint(raw: unknown): TaskSessionCheckpoint {
	if (!raw || typeof raw !== "object") return emptyCheckpoint();
	const maybe = raw as Record<string, unknown>;
	const efforts: TaskSessionEffortRecord[] = Array.isArray(maybe.efforts)
		? (maybe.efforts as unknown[])
				.filter((entry) => entry && typeof entry === "object")
				.map((entry) => {
					const current = entry as Record<string, unknown>;
					const effortId =
						typeof current.effortId === "string" ? current.effortId : "";
					const transport =
						typeof current.transport === "string" ? current.transport : "file";
					return {
						effortId,
						transport,
						submittedAt:
							typeof current.submittedAt === "string"
								? current.submittedAt
								: undefined,
						direction:
							typeof current.direction === "string"
								? current.direction
								: undefined,
						source:
							typeof current.source === "string" ? current.source : undefined,
						lastStatus:
							typeof current.lastStatus === "string"
								? (current.lastStatus as SessionStatus)
								: undefined,
						lastStatusAt:
							typeof current.lastStatusAt === "string"
								? current.lastStatusAt
								: undefined,
						lastCommand:
							typeof current.lastCommand === "string"
								? (current.lastCommand as TaskSessionEffortRecord["lastCommand"])
								: undefined,
						lastLogAt:
							typeof current.lastLogAt === "string"
								? current.lastLogAt
								: undefined,
						statusCommand:
							typeof current.statusCommand === "string"
								? current.statusCommand
								: buildStatusCommand(effortId, transport),
						logsCommand:
							typeof current.logsCommand === "string"
								? current.logsCommand
								: buildLogsCommand(effortId, transport),
					};
				})
				.filter((entry) => entry.effortId.length > 0)
		: [];

	return {
		version: SESSION_VERSION,
		updatedAt: typeof maybe.updatedAt === "string" ? maybe.updatedAt : nowIso(),
		activeEffortId:
			typeof maybe.activeEffortId === "string"
				? maybe.activeEffortId
				: undefined,
		efforts,
	};
}

export class FileTaskSessionRecorder implements TaskSessionRecorder {
	private readonly sessionsDir: string;
	private readonly sessionFilePath: string;

	constructor(
		baseDir = path.join(os.homedir(), ".refarm"),
		private readonly maxEfforts = DEFAULT_MAX_EFFORTS,
	) {
		this.sessionsDir = path.join(baseDir, "sessions");
		this.sessionFilePath = path.join(this.sessionsDir, "task-session.v1.json");
		fs.mkdirSync(this.sessionsDir, { recursive: true });
	}

	rememberRun(input: { effort: Effort; transport: string }): void {
		this.updateState((state) => {
			const effort = this.upsertEffort(state, input.effort.id, input.transport);
			effort.submittedAt = input.effort.submittedAt;
			effort.direction = input.effort.direction;
			effort.source = input.effort.source;
			effort.lastStatus = "pending";
			effort.lastStatusAt = nowIso();
			effort.lastCommand = "run";
			state.activeEffortId = input.effort.id;
		});
	}

	rememberStatus(input: {
		effortId: string;
		transport: string;
		result: EffortResult | null;
	}): void {
		this.updateState((state) => {
			const effort = this.upsertEffort(state, input.effortId, input.transport);
			effort.lastStatus = input.result?.status ?? "not-found";
			effort.lastStatusAt = nowIso();
			effort.lastCommand = "status";
			if (input.result?.submittedAt) {
				effort.submittedAt = input.result.submittedAt;
			}

			if (input.result && !FINAL_STATUSES.has(input.result.status)) {
				state.activeEffortId = input.effortId;
			} else if (state.activeEffortId === input.effortId) {
				state.activeEffortId = undefined;
			}
		});
	}

	rememberList(input: { transport: string; efforts: EffortResult[] }): void {
		this.updateState((state) => {
			for (const result of input.efforts.slice(0, this.maxEfforts)) {
				const effort = this.upsertEffort(
					state,
					result.effortId,
					input.transport,
				);
				effort.lastStatus = result.status;
				effort.lastStatusAt = nowIso();
				effort.lastCommand = "list";
				effort.submittedAt = result.submittedAt ?? effort.submittedAt;
			}

			const firstActive = input.efforts.find(
				(result) => !FINAL_STATUSES.has(result.status),
			);
			state.activeEffortId = firstActive?.effortId;
		});
	}

	rememberLogs(input: {
		effortId: string;
		transport: string;
		logs: EffortLogEntry[];
	}): void {
		this.updateState((state) => {
			const effort = this.upsertEffort(state, input.effortId, input.transport);
			effort.lastCommand = "logs";
			const tail = input.logs[input.logs.length - 1];
			effort.lastLogAt = tail?.timestamp;
		});
	}

	rememberControl(input: {
		effortId: string;
		transport: string;
		action: "retry" | "cancel";
	}): void {
		this.updateState((state) => {
			const effort = this.upsertEffort(state, input.effortId, input.transport);
			effort.lastCommand = input.action;
			effort.lastStatusAt = nowIso();
			state.activeEffortId = input.effortId;
		});
	}

	getCheckpoint(): TaskSessionCheckpoint | null {
		const state = this.readState();
		if (state.efforts.length === 0) return null;
		return state;
	}

	private updateState(mutator: (state: TaskSessionCheckpoint) => void): void {
		const state = this.readState();
		mutator(state);
		state.updatedAt = nowIso();
		state.efforts = state.efforts.slice(0, this.maxEfforts);
		this.writeState(state);
	}

	private upsertEffort(
		state: TaskSessionCheckpoint,
		effortId: string,
		transport: string,
	): TaskSessionEffortRecord {
		const existingIndex = state.efforts.findIndex(
			(entry) => entry.effortId === effortId,
		);
		if (existingIndex >= 0) {
			const existing = state.efforts[existingIndex];
			existing.transport = transport;
			existing.statusCommand = buildStatusCommand(effortId, transport);
			existing.logsCommand = buildLogsCommand(effortId, transport);
			state.efforts.splice(existingIndex, 1);
			state.efforts.unshift(existing);
			return existing;
		}

		const created: TaskSessionEffortRecord = {
			effortId,
			transport,
			statusCommand: buildStatusCommand(effortId, transport),
			logsCommand: buildLogsCommand(effortId, transport),
		};
		state.efforts.unshift(created);
		return created;
	}

	private readState(): TaskSessionCheckpoint {
		if (!fs.existsSync(this.sessionFilePath)) return emptyCheckpoint();
		try {
			const content = fs.readFileSync(this.sessionFilePath, "utf-8");
			return normalizeCheckpoint(JSON.parse(content));
		} catch {
			return emptyCheckpoint();
		}
	}

	private writeState(state: TaskSessionCheckpoint): void {
		fs.writeFileSync(
			this.sessionFilePath,
			JSON.stringify(state, null, 2),
			"utf-8",
		);
	}
}

export function createTaskSessionRecorder(
	baseDir?: string,
): TaskSessionRecorder {
	return new FileTaskSessionRecorder(baseDir);
}
