import {
	streamObservationViewsByStream,
	type StreamChunkStateMap,
	type StreamObservationView,
	type StreamSessionStateMap,
} from "@refarm.dev/tractor";

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
): string {
	const label = view.promptRef ?? view.streamRef ?? "stream";
	const status = view.status ?? (view.isTerminal ? "completed" : "observed");
	const content =
		view.content || (view.isActive ? "Streaming…" : "Waiting for content…");
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
): string {
	return views.map((view) => renderStreamObservationPill(view)).join("");
}

export function renderStreamPanelHtml(views: StreamObservationView[]): string {
	if (views.length === 0) return "";

	return `
    <section class="refarm-surface refarm-surface-tinted refarm-panel" aria-label="Live agent stream panel">
      <header class="refarm-panel-header">
        <div>
          <p class="refarm-eyebrow">Live soil telemetry</p>
          <h2 style="font-size: 1rem; margin: 0;">Agent streams</h2>
        </div>
        <span class="refarm-pill-meta" style="font-size: 0.75rem;">${views.length} observed</span>
      </header>
      <div class="refarm-stack">
        ${views.map((view) => renderStreamPanelCard(view)).join("")}
      </div>
    </section>
  `;
}

function renderStreamPanelCard(view: StreamObservationView): string {
	const label = view.promptRef ?? view.streamRef ?? "stream";
	const status = view.status ?? (view.isTerminal ? "completed" : "observed");
	const content = view.content || (view.isActive ? "Streaming…" : "Waiting for content…");
	const tone = view.isActive ? "Active" : view.isTerminal ? "Complete" : "Observed";

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
