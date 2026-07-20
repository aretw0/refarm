// A LIVE, growing HTML table driven by a STREAM of events — the browser twin of surface-terminal's
// live-view engine (runLiveView + renderTable). Same source → render → grow shape, its own DOM idiom:
// point it at a source of `agent:*` runtime events (replayed, or an SSE stream) and the table updates live.
// The core (mountLiveEventTable + arrayEventSource) is DOM-only and injectable, so it is unit-tested in
// jsdom with a scripted source — no real EventSource. Brand-neutral.

import { renderTableHtml, type HtmlTableColumn } from "./index.js";

/**
 * A push-based source of live events — the browser twin of surface-terminal's pull-based `LiveSource`.
 * `subscribe` delivers each event as it arrives plus an optional end signal, and returns an unsubscribe fn.
 */
export interface LiveEventSource<T> {
	subscribe(onEvent: (event: T) => void, onEnd?: () => void): () => void;
}

/** Replay a fixed array (microtask-scheduled so subscribers observe incremental growth) then end — the
 * deterministic source for tests + demos. The web twin of `arrayLiveSource`. */
export function arrayEventSource<T>(events: readonly T[]): LiveEventSource<T> {
	return {
		subscribe(onEvent, onEnd) {
			let cancelled = false;
			void (async () => {
				for (const event of events) {
					await Promise.resolve();
					if (cancelled) return;
					onEvent(event);
				}
				if (!cancelled) onEnd?.();
			})();
			return () => {
				cancelled = true;
			};
		},
	};
}

/**
 * An SSE-backed source: open an `EventSource` on `url` and yield each parsed message. Browser-only glue
 * (the live server tail) — the render/grow LOGIC it feeds is unit-tested via {@link arrayEventSource}, so
 * only this thin EventSource wiring stays a manual/integration concern.
 */
export function eventSourceStream<T>(url: string, parse: (data: string) => T): LiveEventSource<T> {
	return {
		subscribe(onEvent, onEnd) {
			const source = new EventSource(url);
			source.onmessage = (message) => onEvent(parse(message.data));
			source.onerror = () => {
				// EventSource.onerror ALSO fires on recoverable drops the browser will auto-reconnect from —
				// only treat a CLOSED stream as the end, so a momentary blip doesn't permanently kill the tail.
				if (source.readyState === EventSource.CLOSED) onEnd?.();
			};
			return () => source.close();
		},
	};
}

export interface MountLiveEventTableOptions<T> {
	/** Where to render the growing table. */
	container: HTMLElement;
	/** The stream of events. */
	source: LiveEventSource<T>;
	/** Table columns (same shape renderTableHtml + the TUI renderTable read). */
	columns: HtmlTableColumn[];
	/** Map an event to a table row. The index is a MONOTONIC event counter (0,1,2,…) — the event's absolute
	 * position in the run, NOT the visible-window slot, so it stays correct under `maxRows`. */
	toRow: (event: T, index: number) => Record<string, unknown>;
	caption?: string;
	/** Keep only the last N rows — a rolling window; default unbounded. */
	maxRows?: number;
}

/**
 * Mount a LIVE, growing table into `container`: render the (initially empty) table, then on each event from
 * `source` append its row (dropping the oldest past `maxRows`) and re-render via renderTableHtml. The web
 * twin of surface-terminal's `runLiveView` — same source→render→grow contract, projected to the DOM. PURE
 * given an injected source, so it is testable headless in jsdom. Returns an unsubscribe fn.
 */
export function mountLiveEventTable<T>(opts: MountLiveEventTableOptions<T>): () => void {
	const rows: Array<Record<string, unknown>> = [];
	let count = 0; // a MONOTONIC event counter — NOT rows.length, which is capped by maxRows
	const render = (): void => {
		opts.container.innerHTML = renderTableHtml(
			opts.columns,
			rows,
			opts.caption !== undefined ? { caption: opts.caption } : {},
		);
	};
	render();
	return opts.source.subscribe((event) => {
		rows.push(opts.toRow(event, count++));
		if (opts.maxRows !== undefined && rows.length > opts.maxRows) rows.shift();
		render();
	});
}
