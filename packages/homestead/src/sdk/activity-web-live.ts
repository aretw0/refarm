/**
 * The live wiring for the web activity pills: an `EventSource` on `/stream/activity`
 * (the daemon's SSE forwarder) feeding the pure `activity-web` renderers into a DOM node.
 *
 * This is the thin shell the render-half (`activity-web.ts`) was built to sit under.
 * Kept out of `activity-web.ts` so those stay pure/DOM-free; here we own the browser
 * concerns (EventSource, a mount node, the accumulated event buffer). The SSE frames are
 * `{ event, ...ProcessActivity }` — byte-compatible with a line of `activity.ndjson`, so
 * we parse each frame straight into a `ProcessActivity` and fold it as usual.
 */

import type { ProcessActivity } from "@refarm.dev/capabilities";
import { renderActivityPills } from "./activity-web.js";

/** The SSE path the daemon serves activity on (same-origin default via the serve proxy;
 * override for a direct sidecar origin). */
export const ACTIVITY_STREAM_PATH = "/stream/activity";

/** Only these phases are activity; a frame missing them is ignored. */
function isProcessActivity(value: unknown): value is ProcessActivity {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.activityRef === "string" &&
		(v.phase === "started" || v.phase === "progress" || v.phase === "finished")
	);
}

/** Parse one SSE `data:` payload (the flat `{event, ...ProcessActivity}` JSON) into a
 * ProcessActivity, or `null` if it is not an activity frame (e.g. an agent:* event whose
 * mapping we don't render, or malformed data). PURE. */
export function parseActivityFrame(data: string): ProcessActivity | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return null;
	}
	// The daemon folds agent:* into process:* activity server-side, so the frames that
	// carry a phase ARE ProcessActivity; agent:* frames without a phase are skipped here
	// (the pills render process-shaped activity only).
	return isProcessActivity(parsed) ? parsed : null;
}

/** How many past events to retain for the fold (a started/finished pair is small; cap so
 * a long-lived tab can't grow unbounded). Finished activities are pruned by the fold, so
 * this only bounds the raw buffer. */
const MAX_BUFFERED_EVENTS = 500;

export interface ActivityStreamHandle {
	/** Close the EventSource and stop rendering (idempotent). */
	stop(): void;
}

export interface ActivityStreamOptions {
	/** The SSE path (default `/stream/activity`, same-origin). */
	path?: string;
	/** Injected EventSource ctor — for tests / non-browser hosts. */
	eventSourceFactory?: (url: string) => EventSourceLike;
}

/** The slice of the DOM `EventSource` API we use — so a test can inject a fake. */
export interface EventSourceLike {
	onmessage: ((event: { data: string }) => void) | null;
	onerror: ((event: unknown) => void) | null;
	close(): void;
}

/** The slice of a DOM element we render into. */
export interface ActivityMountNode {
	innerHTML: string;
}

/**
 * Open the activity SSE stream and render live pills into `mount`. Each frame folds into
 * the buffer; the pills re-render on every activity frame. Returns a handle to stop.
 * The event source is injected (defaults to the global `EventSource`), so this is
 * testable headless and works wherever an EventSource-like is available.
 */
export function mountLiveActivityStream(
	mount: ActivityMountNode,
	options: ActivityStreamOptions = {},
): ActivityStreamHandle {
	const path = options.path ?? ACTIVITY_STREAM_PATH;
	const factory =
		options.eventSourceFactory ??
		((url: string) => new EventSource(url) as unknown as EventSourceLike);

	const events: ProcessActivity[] = [];
	const source = factory(path);

	const rerender = () => {
		mount.innerHTML = renderActivityPills(events);
	};

	source.onmessage = (event) => {
		const activity = parseActivityFrame(event.data);
		if (!activity) return;
		events.push(activity);
		if (events.length > MAX_BUFFERED_EVENTS) events.splice(0, events.length - MAX_BUFFERED_EVENTS);
		rerender();
	};
	source.onerror = () => {
		// The browser EventSource auto-reconnects; nothing to do but keep the last render.
	};

	return {
		stop() {
			source.close();
		},
	};
}
