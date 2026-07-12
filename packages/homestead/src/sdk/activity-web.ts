import type { ProcessActivity } from "@refarm.dev/capabilities";

/**
 * The WEB renderer for the surface-neutral activity signal — a pill that shows the
 * operator "working" for any process (an agent turn, a login, a dispatch), mirroring the
 * CLI spinner and the TUI line. The events arrive over the daemon's SSE transport (the
 * same `process:*` the CLI tails from a file), so the render half here plus that transport
 * gives the web surface the "sense of processing" every other surface has.
 *
 * These are PURE HTML producers (no DOM, no fetch) so they are trivially testable and
 * hold the regression: given a ProcessActivity, produce the pill. The live wiring (an
 * EventSource on /stream/activity feeding these) is a thin shell over them.
 */

/** A live activity the web is tracking (started, not yet finished), plus its latest note. */
export interface LiveWebActivity {
	activityRef: string;
	label: string;
	kind: string;
	note?: string;
}

/** Fold an ordered stream of `process:*` events into the CURRENTLY-live activities (a
 * started-but-not-finished set), most-recent last. A surface renders these as pills; a
 * finished event removes its activity. PURE — the caller owns the event source. */
export function liveActivitiesFromEvents(events: readonly ProcessActivity[]): LiveWebActivity[] {
	const byRef = new Map<string, LiveWebActivity>();
	for (const event of events) {
		switch (event.phase) {
			case "started":
				byRef.set(event.activityRef, {
					activityRef: event.activityRef,
					label: event.label,
					kind: event.kind,
				});
				break;
			case "progress": {
				const live = byRef.get(event.activityRef);
				if (live) live.note = event.note;
				break;
			}
			case "finished":
				byRef.delete(event.activityRef);
				break;
		}
	}
	return [...byRef.values()];
}

/** Render one live activity as a "working" pill — the 🟢 spinner tone the stream pill
 * already uses for active work, reusing the `refarm-pill` CSS. PURE. */
export function renderActivityPill(activity: LiveWebActivity): string {
	const status = activity.note ? escapeHtml(activity.note) : "working…";
	return [
		`<article class="refarm-pill refarm-pill-activity" data-activity-ref="${escapeHtml(activity.activityRef)}" data-activity-kind="${escapeHtml(activity.kind)}">`,
		`  <span class="refarm-pill-tone">🟢</span>`,
		`  <strong class="refarm-pill-label">${escapeHtml(activity.label)}</strong>`,
		`  <span class="refarm-pill-meta">${status}</span>`,
		`</article>`,
	].join("\n");
}

/** Render the current live activities as a row of pills (empty string when idle — the
 * surface shows nothing when no work is running). PURE. */
export function renderActivityPills(events: readonly ProcessActivity[]): string {
	return liveActivitiesFromEvents(events).map(renderActivityPill).join("\n");
}

/** Minimal HTML-attribute/text escaping (mirrors stream-observer's private helper). */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
