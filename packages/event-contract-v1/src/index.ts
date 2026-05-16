export type EventHandler<T = unknown> = (data: T) => void;
export type Unsubscribe = () => void;

export interface EventBus {
	emit(channel: string, data?: unknown): void;
	on(channel: string, handler: EventHandler): Unsubscribe;
}

export interface EventBusController extends EventBus {
	/** Remove all subscriptions across all channels. */
	clear(): void;
}

export function createEventBus(): EventBusController {
	const subscribers = new Map<string, Set<EventHandler>>();

	return {
		emit(channel, data) {
			subscribers.get(channel)?.forEach((handler) => handler(data));
		},

		on(channel, handler) {
			if (!subscribers.has(channel)) {
				subscribers.set(channel, new Set());
			}
			subscribers.get(channel)!.add(handler);
			return () => subscribers.get(channel)?.delete(handler);
		},

		clear() {
			subscribers.clear();
		},
	};
}
