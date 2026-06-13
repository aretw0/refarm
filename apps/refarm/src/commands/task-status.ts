import type { EffortStatus } from "@refarm.dev/effort-contract-v1";

export const FINAL_EFFORT_STATUSES = new Set<EffortStatus>([
	"done",
	"partial",
	"failed",
	"timed-out",
	"cancelled",
]);

export function isFinalEffortStatus(status: EffortStatus): boolean {
	return FINAL_EFFORT_STATUSES.has(status);
}
