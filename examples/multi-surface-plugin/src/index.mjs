export async function setup() {
	return { ready: true, plugin: "@refarm.example/multi-surface" };
}

export async function renderHomesteadSurface(request = {}) {
	const surface = request.surface ?? {};
	const surfaceId = String(surface.id ?? "unknown-surface");
	const slotId = String(request.slotId ?? surface.slot ?? "unknown-slot");
	const actionLinks = (request.host?.actions ?? [])
		.map((action) => {
			const actionId = escapeHtml(action.id);
			return `<button type="button" class="refarm-btn refarm-btn-pill" data-refarm-surface-action-id="${actionId}">${escapeHtml(action.label)}</button>`;
		})
		.join("");
	return {
		html: `<section class="refarm-card refarm-stack" data-refarm-example-surface="${escapeHtml(surfaceId)}" data-refarm-example-slot="${escapeHtml(slotId)}">
			<p class="refarm-eyebrow">Plugin-provided Homestead surface</p>
			<h2>Daily stream cockpit</h2>
			<p>This panel is rendered by an executable plugin module through <code>renderHomesteadSurface</code>.</p>
			<ul class="refarm-list-plain">
				<li>Surface: <strong>${escapeHtml(surfaceId)}</strong></li>
				<li>Slot: <strong>${escapeHtml(slotId)}</strong></li>
				<li>Capabilities: <strong>${escapeHtml((surface.capabilities ?? []).join(", ") || "none")}</strong></li>
			</ul>
			${actionLinks ? `<div class="refarm-cluster">${actionLinks}</div>` : ""}
		</section>`,
	};
}

export async function summarizeTerminalStream(input = {}) {
	const chunks = Array.isArray(input.chunks) ? input.chunks : [];
	return {
		summary: chunks
			.map((chunk) => String(chunk.content ?? chunk))
			.join(" ")
			.trim(),
		chunkCount: chunks.length,
	};
}

export default {
	setup,
	renderHomesteadSurface,
	summarizeTerminalStream,
};

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
