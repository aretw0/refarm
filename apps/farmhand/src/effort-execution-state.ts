/** Mutable execution facts shared by lifecycle control and runtime telemetry. */
export class EffortExecutionState {
	private readonly inFlightEffortIds = new Set<string>();
	private readonly cancellationEffortIds = new Set<string>();

	get inFlightCount(): number {
		return this.inFlightEffortIds.size;
	}

	get cancellationCount(): number {
		return this.cancellationEffortIds.size;
	}

	isInFlight(effortId: string): boolean {
		return this.inFlightEffortIds.has(effortId);
	}

	begin(effortId: string): boolean {
		if (this.inFlightEffortIds.has(effortId)) return false;
		this.inFlightEffortIds.add(effortId);
		return true;
	}

	finish(effortId: string): void {
		this.inFlightEffortIds.delete(effortId);
	}

	requestCancellation(effortId: string): void {
		this.cancellationEffortIds.add(effortId);
	}

	isCancellationRequested(effortId: string): boolean {
		return this.cancellationEffortIds.has(effortId);
	}

	clearCancellation(effortId: string): void {
		this.cancellationEffortIds.delete(effortId);
	}
}
