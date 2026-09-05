export interface EffortQueueOptions {
	force: boolean;
}

export type EffortQueueHandler = (
	effortId: string,
	options: EffortQueueOptions,
) => Promise<void>;

/** Serial, de-duplicating effort scheduler independent of ingress and persistence. */
export class EffortQueue {
	private readonly effortIds: string[] = [];
	private readonly optionsByEffortId = new Map<string, EffortQueueOptions>();
	private draining = false;

	constructor(private readonly handler: EffortQueueHandler) {}

	get depth(): number {
		return this.effortIds.length;
	}

	enqueue(effortId: string, options: { force?: boolean } = {}): void {
		const force = options.force ?? false;
		const existing = this.optionsByEffortId.get(effortId);
		if (existing) {
			if (force && !existing.force) {
				this.optionsByEffortId.set(effortId, { force: true });
			}
			return;
		}

		this.optionsByEffortId.set(effortId, { force });
		this.effortIds.push(effortId);
		void this.drain();
	}

	private async drain(): Promise<void> {
		if (this.draining) return;
		this.draining = true;
		try {
			while (this.effortIds.length > 0) {
				const effortId = this.effortIds.shift();
				if (!effortId) continue;

				const options = this.optionsByEffortId.get(effortId) ?? { force: false };
				this.optionsByEffortId.delete(effortId);
				await this.handler(effortId, options);
			}
		} finally {
			this.draining = false;
		}
	}
}
