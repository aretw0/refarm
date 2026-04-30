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
      <article data-stream-ref="${escapeHtml(view.streamRef ?? "")}" style="display: inline-flex; align-items: center; gap: 0.35rem; min-width: 0; max-width: 34rem; padding: 0.15rem 0.5rem; border: 1px solid var(--refarm-border-default); border-radius: 999px; background: rgba(0,0,0,0.04);">
        <span aria-hidden="true">${tone}</span>
        <strong style="white-space: nowrap;">${escapeHtml(label)}</strong>
        <span style="opacity: 0.7; white-space: nowrap;">${escapeHtml(status)}</span>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(content)}</span>
      </article>
    `;
}

export function renderStreamStatusbarHtml(
	views: StreamObservationView[],
): string {
	return views.map((view) => renderStreamObservationPill(view)).join("");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
