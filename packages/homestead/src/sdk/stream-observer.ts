import {
	streamObservationViewsByStream,
	type StreamChunkStateMap,
	type StreamObservationView,
	type StreamSessionStateMap,
} from "./stream-state.js";

export interface StreamObserverTranslator {
	t(key: string, params?: Record<string, string>): string;
}

export function sortedStreamObservationViews(
	sessions: StreamSessionStateMap,
	chunks: StreamChunkStateMap,
): StreamObservationView[] {
	return Object.values(streamObservationViewsByStream(sessions, chunks)).sort(
		(left, right) =>
			(left.streamRef ?? "").localeCompare(right.streamRef ?? ""),
	);
}

export function renderStreamObservationPill(
	view: StreamObservationView,
	translator?: StreamObserverTranslator,
): string {
	const label = view.promptRef ?? view.streamRef ?? streamText(translator, "stream_label");
	const status =
		view.status ??
		(view.isTerminal
			? streamText(translator, "stream_completed")
			: streamText(translator, "stream_observed"));
	const content =
		view.content ||
		(view.isActive
			? streamText(translator, "streaming")
			: streamText(translator, "waiting_for_content"));
	const tone = view.isActive ? "🟢" : view.isTerminal ? "✅" : "🟡";

	return `
      <article class="refarm-pill" data-stream-ref="${escapeHtml(view.streamRef ?? "")}">
        <span aria-hidden="true">${tone}</span>
        <strong class="refarm-pill-label">${escapeHtml(label)}</strong>
        <span class="refarm-pill-meta">${escapeHtml(status)}</span>
        <span class="refarm-pill-content">${escapeHtml(content)}</span>
      </article>
    `;
}

export function renderStreamStatusbarHtml(
	views: StreamObservationView[],
	translator?: StreamObserverTranslator,
): string {
	return views
		.map((view) => renderStreamObservationPill(view, translator))
		.join("");
}

export function renderStreamPanelHtml(
	views: StreamObservationView[],
	translator?: StreamObserverTranslator,
): string {
	if (views.length === 0) return "";

	return `
    <section class="refarm-surface refarm-surface-tinted refarm-panel" aria-label="${escapeHtml(streamText(translator, "live_agent_stream_panel"))}">
      <header class="refarm-panel-header">
        <div>
          <p class="refarm-eyebrow">${escapeHtml(streamText(translator, "live_stream_telemetry"))}</p>
          <h2 style="font-size: 1rem; margin: 0;">${escapeHtml(streamText(translator, "agent_streams"))}</h2>
        </div>
        <span class="refarm-pill-meta" style="font-size: 0.75rem;">${escapeHtml(streamText(translator, "streams_observed_count", { count: String(views.length) }))}</span>
      </header>
      <div class="refarm-stack">
        ${views.map((view) => renderStreamPanelCard(view, translator)).join("")}
      </div>
    </section>
  `;
}

function renderStreamPanelCard(
	view: StreamObservationView,
	translator?: StreamObserverTranslator,
): string {
	const label = view.promptRef ?? view.streamRef ?? streamText(translator, "stream_label");
	const status =
		view.status ??
		(view.isTerminal
			? streamText(translator, "stream_completed")
			: streamText(translator, "stream_observed"));
	const content =
		view.content ||
		(view.isActive
			? streamText(translator, "streaming")
			: streamText(translator, "waiting_for_content"));
	const tone = view.isActive
		? streamText(translator, "stream_active")
		: view.isTerminal
			? streamText(translator, "stream_complete")
			: streamText(translator, "stream_observed");

	return `
    <article class="refarm-surface-card" data-stream-ref="${escapeHtml(view.streamRef ?? "")}">
      <div class="refarm-card-row">
        <strong class="refarm-card-title">${escapeHtml(label)}</strong>
        <span class="refarm-badge">${escapeHtml(tone)}</span>
      </div>
      <div class="refarm-card-meta">
        <span>${escapeHtml(status)}</span>
        ${view.streamRef ? `<span>${escapeHtml(view.streamRef)}</span>` : ""}
      </div>
      <p class="refarm-card-body">${escapeHtml(content)}</p>
    </article>
  `;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function streamText(
	translator: StreamObserverTranslator | undefined,
	key: string,
	params?: Record<string, string>,
): string {
	if (translator) return translator.t(`refarm:core/${key}`, params);
	return fallbackStreamText(key, params);
}

function fallbackStreamText(
	key: string,
	params?: Record<string, string>,
): string {
	switch (key) {
		case "agent_streams":
			return "Agent streams";
		case "live_agent_stream_panel":
			return "Live agent stream panel";
		case "live_stream_telemetry":
			return "Live stream telemetry";
		case "stream_active":
			return "Active";
		case "stream_complete":
			return "Complete";
		case "stream_completed":
			return "completed";
		case "stream_label":
			return "stream";
		case "stream_observed":
			return "observed";
		case "streaming":
			return "Streaming…";
		case "streams_observed_count":
			return `${params?.count ?? "0"} observed`;
		case "waiting_for_content":
			return "Waiting for content…";
		default:
			return key;
	}
}
