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

export function renderStreamPanelHtml(views: StreamObservationView[]): string {
	if (views.length === 0) return "";

	return `
    <section aria-label="Live agent stream panel" style="border: 1px solid var(--refarm-border-default); border-radius: 1.25rem; background: linear-gradient(135deg, rgba(35, 134, 54, 0.08), rgba(0, 0, 0, 0.02)); padding: 1rem; box-shadow: var(--refarm-shadow-sm, 0 10px 30px rgba(0,0,0,0.08));">
      <header style="display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 0.85rem;">
        <div>
          <p style="font-size: 0.7rem; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.62; margin-bottom: 0.2rem;">Live soil telemetry</p>
          <h2 style="font-size: 1rem; margin: 0;">Agent streams</h2>
        </div>
        <span style="font-size: 0.75rem; opacity: 0.7;">${views.length} observed</span>
      </header>
      <div style="display: grid; gap: 0.75rem;">
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
    <article data-stream-ref="${escapeHtml(view.streamRef ?? "")}" style="display: grid; gap: 0.45rem; padding: 0.8rem; border: 1px solid var(--refarm-border-default); border-radius: 0.9rem; background: var(--refarm-bg-elevated, rgba(255,255,255,0.72));">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
        <strong style="font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(label)}</strong>
        <span style="font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: 999px; background: rgba(35,134,54,0.12); color: var(--refarm-accent-primary); white-space: nowrap;">${escapeHtml(tone)}</span>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.72rem; opacity: 0.72;">
        <span>${escapeHtml(status)}</span>
        ${view.streamRef ? `<span>${escapeHtml(view.streamRef)}</span>` : ""}
      </div>
      <p style="margin: 0; font-size: 0.84rem; line-height: 1.45; color: var(--refarm-text-secondary); white-space: pre-wrap; overflow-wrap: anywhere;">${escapeHtml(content)}</p>
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
