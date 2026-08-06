import type {
	Effort,
	EffortLogEntry,
	EffortResult,
	EffortSummary,
	EffortTransportAdapter,
} from "@refarm.dev/effort-contract-v1";

/**
 * Application operations shared by Farmhand ingress adapters.
 *
 * This boundary is transport-neutral even though FileTransportAdapter is its
 * current implementation. HTTP and file ingress depend on the operations, not
 * on each other's protocol semantics.
 */
export interface EffortOperations extends EffortTransportAdapter {
	list(): Promise<EffortResult[]>;
	logs(effortId: string): Promise<EffortLogEntry[] | null>;
	retry(effortId: string): Promise<boolean>;
	cancel(effortId: string): Promise<boolean>;
	summary(): Promise<EffortSummary>;
	process(effort: Effort): Promise<void>;
	telemetry?(): Promise<unknown>;
	telemetryWindow?(minutes: number): Promise<unknown>;
}
