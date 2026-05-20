export const EVENT_CAPABILITY = "event:v1" as const;

export type EventHandler<T = unknown> = (data: T) => void;
export type Unsubscribe = () => void;

export interface EventBus {
	emit(channel: string, data?: unknown): void;
	on(channel: string, handler: EventHandler): Unsubscribe;
	/** Subscribe to exactly one emission, then auto-unsubscribe. */
	once(channel: string, handler: EventHandler): Unsubscribe;
}

export interface EventBusController extends EventBus {
	/** Remove all subscriptions across all channels. */
	clear(): void;
}

export interface EventBusConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}
