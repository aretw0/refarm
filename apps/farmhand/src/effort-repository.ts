import type {
	Effort,
	EffortLogEntry,
	EffortResult,
} from "@refarm.dev/effort-contract-v1";

/** Persistence port consumed by effort lifecycle policy. */
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
