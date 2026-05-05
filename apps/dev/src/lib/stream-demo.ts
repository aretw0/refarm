import type {
	PluginInstance,
	SovereignNode,
	Tractor,
} from "@refarm.dev/tractor";
import { createHomesteadSurfacePluginHandle } from "@refarm.dev/homestead/sdk/plugin-handle";
import {
	createScopedHomesteadSurfaceActionHandler,
	createScopedHomesteadSurfaceContextProvider,
	type HomesteadSurfaceRenderActionHandler,
	type HomesteadSurfaceRenderContextProvider,
	type HomesteadSurfaceRenderRequest,
	type HomesteadSurfaceRenderResult,
} from "@refarm.dev/homestead/sdk/surface-renderer";

const DEMO_STREAM_REF = "urn:tractor:stream:agent-response:studio-demo";
export const STUDIO_STREAM_DEMO_STORAGE_KEY = "refarm:studio:stream-demo";
export const STUDIO_STREAM_SURFACE_PLUGIN_ID = "studio-stream-surface-demo";

export interface StudioStreamDemoControlOptions {
	enabled: boolean;
	onToggle: () => void;
}

export interface StudioStreamSurfaceContextProviderOptions {
	baseUrl?: string;
}

export interface StudioStreamSurfaceActionHandlerOptions {
	navigate?: (href: string) => void;
}

export function shouldSeedStudioStreamDemo(
	url: string,
	persistedFlag?: string | null,
): boolean {
	const searchParams = new URL(url, "http://refarm.local").searchParams;
	return (
		searchParams.has("stream-demo") ||
		searchParams.get("streamDemo") === "1" ||
		persistedFlag === "1"
	);
}

export function studioStreamDemoNodes(
	startedAt: Date = new Date(),
): SovereignNode[] {
	const startedAtIso = startedAt.toISOString();
	return [
		{
			"@context": "https://refarm.dev/schemas/stream/v1",
			"@type": "StreamSession",
			"@id": DEMO_STREAM_REF,
			stream_ref: DEMO_STREAM_REF,
			stream_kind: "agent-response",
			status: "active",
			started_at: startedAtIso,
			metadata: {
				prompt_ref: "studio-demo",
				provider_family: "demo",
				model: "apps-dev",
			},
			"refarm:sourcePlugin": "studio-demo",
		},
		{
			"@context": "https://refarm.dev/schemas/stream/v1",
			"@type": "StreamChunk",
			"@id": `${DEMO_STREAM_REF}:chunk:1`,
			stream_ref: DEMO_STREAM_REF,
			sequence: 1,
			payload_kind: "text_delta",
			content: "Cultivating a Studio stream surface in apps/dev…",
			metadata: {
				prompt_ref: "studio-demo",
			},
			"refarm:sourcePlugin": "studio-demo",
		},
		{
			"@context": "https://refarm.dev/schemas/stream/v1",
			"@type": "StreamChunk",
			"@id": `${DEMO_STREAM_REF}:chunk:2`,
			stream_ref: DEMO_STREAM_REF,
			sequence: 2,
			payload_kind: "text_delta",
			content: "Homestead owns the primitive; Studio proves the workflow.",
			metadata: {
				prompt_ref: "studio-demo",
			},
			"refarm:sourcePlugin": "studio-demo",
		},
	];
}

export async function seedStudioStreamDemo(tractor: Tractor): Promise<void> {
	for (const node of studioStreamDemoNodes()) {
		await tractor.storeNode(node, "none");
	}
}

export function renderStudioStreamSurfaceDemo(
	request: HomesteadSurfaceRenderRequest,
): HomesteadSurfaceRenderResult {
	const surfaceId = escapeStudioStreamSurfaceText(
		request.surface?.id ?? "studio-stream-panel",
	);
	const slotId = escapeStudioStreamSurfaceText(request.slotId);
	const hostId = escapeStudioStreamSurfaceText(
		request.host?.hostId ?? "unknown host",
	);
	const streamRef = escapeStudioStreamSurfaceText(
		String(request.host?.data?.streamRef ?? DEMO_STREAM_REF),
	);
	const actionLinks = (request.host?.actions ?? [])
		.map((action) => {
			const actionId = escapeStudioStreamSurfaceText(action.id);
			const href =
				typeof action.payload?.href === "string" ? action.payload.href : "#";
			return `<a class="refarm-btn refarm-btn-pill" data-refarm-surface-action-id="${actionId}" data-refarm-studio-surface-action="${actionId}" href="${escapeStudioStreamSurfaceText(href)}">${escapeStudioStreamSurfaceText(action.label)}</a>`;
		})
		.join("");
	return {
		html: `<section class="refarm-surface-card refarm-stack" data-refarm-studio-stream-surface="${surfaceId}">
			<p class="refarm-eyebrow">Executable Studio surface</p>
			<h3>Daily stream cockpit</h3>
			<p>This panel is rendered by <code class="refarm-code">${STUDIO_STREAM_SURFACE_PLUGIN_ID}</code> through Homestead's <code class="refarm-code">renderHomesteadSurface</code> hook.</p>
			<p>Mounted in <strong>${slotId}</strong> with stream read capability and host context from <code class="refarm-code">${hostId}</code>.</p>
			<p>Tracking <code class="refarm-code">${streamRef}</code>.</p>
			${actionLinks ? `<div class="refarm-cluster">${actionLinks}</div>` : ""}
		</section>`,
	};
}

export function createStudioStreamSurfaceContextProvider(
	options: StudioStreamSurfaceContextProviderOptions = {},
): HomesteadSurfaceRenderContextProvider {
	const baseUrl = options.baseUrl ?? "/";
	return createScopedHomesteadSurfaceContextProvider(
		{
			pluginId: STUDIO_STREAM_SURFACE_PLUGIN_ID,
			surfaceId: "studio-stream-panel",
		},
		() => ({
			hostId: "apps/dev",
			data: {
				streamRef: DEMO_STREAM_REF,
				surfacePurpose: "daily-driver stream experimentation",
			},
			actions: [
				{
					id: "open-stream-workbench",
					label: "Open stream workbench",
					intent: "studio:navigate",
					payload: { href: `${baseUrl}streams?stream-demo` },
				},
			],
		}),
	);
}

export function createStudioStreamSurfaceActionHandler(
	options: StudioStreamSurfaceActionHandlerOptions = {},
): HomesteadSurfaceRenderActionHandler {
	return createScopedHomesteadSurfaceActionHandler(
		{
			pluginId: STUDIO_STREAM_SURFACE_PLUGIN_ID,
			surfaceId: "studio-stream-panel",
		},
		({ action }) => {
			if (action.intent !== "studio:navigate") return;

			const href = action.payload?.href;
			if (typeof href !== "string" || href.length === 0) {
				throw new Error(
					`Studio surface action ${action.id} is missing an href`,
				);
			}

			const navigate =
				options.navigate ??
				((targetHref: string) => {
					window.location.href = targetHref;
				});
			navigate(href);
		},
	);
}

export function createStudioStreamSurfaceDemoPlugin(
	emitTelemetry: (event: string, payload?: unknown) => void = () => {},
): PluginInstance {
	return createHomesteadSurfacePluginHandle({
		id: STUDIO_STREAM_SURFACE_PLUGIN_ID,
		name: "Studio Stream Surface Demo",
		call: async (fn, args) =>
			fn === "renderHomesteadSurface"
				? renderStudioStreamSurfaceDemo(args as HomesteadSurfaceRenderRequest)
				: null,
		surfaces: [
			{
				kind: "panel",
				id: "studio-stream-panel",
				slot: "streams",
				capabilities: ["ui:panel:render", "ui:stream:read"],
			},
		],
		emitTelemetry,
	});
}

export function mountStudioStreamDemoControl(
	container: HTMLElement,
	options: StudioStreamDemoControlOptions,
): HTMLButtonElement {
	container
		.querySelector<HTMLElement>("[data-refarm-studio-stream-demo]")
		?.remove();

	const button = document.createElement("button");
	button.type = "button";
	button.className = "refarm-btn refarm-btn-pill";
	button.dataset.refarmStudioStreamDemo = "true";
	button.textContent = options.enabled
		? "Disable Studio stream demo"
		: "Enable Studio stream demo";
	button.setAttribute("aria-pressed", options.enabled ? "true" : "false");
	button.addEventListener("click", options.onToggle);

	container.appendChild(button);
	return button;
}

function escapeStudioStreamSurfaceText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
