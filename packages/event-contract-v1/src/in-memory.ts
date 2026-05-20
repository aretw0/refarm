import type { EventBusController, EventHandler } from "./types.js";

export function createInMemoryEventBus(): EventBusController {
	const subscribers = new Map<string, Set<EventHandler>>();

	function on(channel: string, handler: EventHandler) {
		if (!subscribers.has(channel)) {
			subscribers.set(channel, new Set());
		}
		subscribers.get(channel)!.add(handler);
		return () => subscribers.get(channel)?.delete(handler);
	}

	return {
		emit(channel, data) {
			subscribers.get(channel)?.forEach((handler) => handler(data));
		},

		on,

		once(channel, handler) {
			const unsub = on(channel, (data) => {
				unsub();
				handler(data);
			});
			return unsub;
		},

		clear() {
			subscribers.clear();
		},
	};
}
