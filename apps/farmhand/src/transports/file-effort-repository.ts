import type {
	Effort,
	EffortLogEntry,
	EffortResult,
} from "@refarm.dev/effort-contract-v1";
import fs from "node:fs";
import path from "node:path";

export interface EffortRepository {
	writeEffort(effort: Effort): void;
	hasEffort(effortId: string): boolean;
	readEffort(effortId: string): Effort | null;
	listResults(): EffortResult[];
	readResult(effortId: string): EffortResult | null;
	writeResult(result: EffortResult): void;
	readLogs(effortId: string): EffortLogEntry[] | null;
	appendLog(effortId: string, entry: EffortLogEntry): void;
}

/** Filesystem persistence for efforts. It owns wire formats, not lifecycle policy. */
export class FileEffortRepository implements EffortRepository {
	readonly tasksDir: string;
	readonly resultsDir: string;
	readonly logsDir: string;
	readonly controlDir: string;

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

	writeEffort(effort: Effort): void {
		fs.writeFileSync(this.effortPath(effort.id), JSON.stringify(effort, null, 2), "utf-8");
	}

	hasEffort(effortId: string): boolean {
		return fs.existsSync(this.effortPath(effortId));
	}

	readEffort(effortId: string): Effort | null {
		const effortPath = this.effortPath(effortId);
		if (!fs.existsSync(effortPath)) return null;
		try {
			const parsed = JSON.parse(fs.readFileSync(effortPath, "utf-8")) as Effort;
			if (!parsed.id || !Array.isArray(parsed.tasks)) return null;
			return parsed;
		} catch {
			return null;
		}
	}

	listResults(): EffortResult[] {
		const results: EffortResult[] = [];
		for (const filename of fs.readdirSync(this.resultsDir)) {
			if (!filename.endsWith(".json")) continue;
			const effortId = filename.replace(/\.json$/, "");
			const parsed = this.readResult(effortId);
			if (parsed) results.push(parsed);
		}

		results.sort((a, b) => {
			const aStamp = a.completedAt ?? a.startedAt ?? a.submittedAt ?? "";
			const bStamp = b.completedAt ?? b.startedAt ?? b.submittedAt ?? "";
			return bStamp.localeCompare(aStamp);
		});
		return results;
	}

	readResult(effortId: string): EffortResult | null {
		const resultPath = this.resultPath(effortId);
		if (!fs.existsSync(resultPath)) return null;
		try {
			return JSON.parse(fs.readFileSync(resultPath, "utf-8")) as EffortResult;
		} catch {
			return null;
		}
	}

	writeResult(result: EffortResult): void {
		fs.writeFileSync(this.resultPath(result.effortId), JSON.stringify(result, null, 2), "utf-8");
	}

	readLogs(effortId: string): EffortLogEntry[] | null {
		const logPath = this.logsPath(effortId);
		if (!fs.existsSync(logPath)) return null;
		const lines = fs
			.readFileSync(logPath, "utf-8")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		const entries: EffortLogEntry[] = [];
		for (const line of lines) {
			try {
				entries.push(JSON.parse(line) as EffortLogEntry);
			} catch {
				// Preserve readable entries when one NDJSON line is malformed.
			}
		}
		return entries;
	}

	appendLog(effortId: string, entry: EffortLogEntry): void {
		fs.appendFileSync(this.logsPath(effortId), `${JSON.stringify(entry)}\n`, "utf-8");
	}

	private effortPath(effortId: string): string {
		return path.join(this.tasksDir, `${effortId}.json`);
	}

	private resultPath(effortId: string): string {
		return path.join(this.resultsDir, `${effortId}.json`);
	}

	private logsPath(effortId: string): string {
		return path.join(this.logsDir, `${effortId}.ndjson`);
	}
}
