import type { PluginInstance, SovereignNode, Tractor } from "@refarm.dev/tractor";

const DEMO_STREAM_REF = "urn:tractor:stream:agent-response:studio-demo";
export const STUDIO_STREAM_DEMO_STORAGE_KEY = "refarm:studio:stream-demo";
export const STUDIO_STREAM_SURFACE_PLUGIN_ID = "studio-stream-surface-demo";

export interface StudioStreamDemoControlOptions {
	enabled: boolean;
	onToggle: () => void;
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

export function createStudioStreamSurfaceDemoPlugin(
	emitTelemetry: (event: string, payload?: unknown) => void = () => {},
): PluginInstance {
	return {
		id: STUDIO_STREAM_SURFACE_PLUGIN_ID,
		name: "Studio Stream Surface Demo",
		manifest: {
			id: STUDIO_STREAM_SURFACE_PLUGIN_ID,
			name: "Studio Stream Surface Demo",
			version: "0.1.0",
			entry: "internal:studio-stream-surface-demo",
			capabilities: {},
			extensions: {
				surfaces: [
					{
						layer: "homestead",
						kind: "panel",
						id: "studio-stream-panel",
						slot: "streams",
						capabilities: ["ui:panel:render", "ui:stream:read"],
					},
				],
			},
		} as PluginInstance["manifest"],
		call: async () => null,
		terminate: () => {},
		emitTelemetry,
		state: "running",
	};
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
	button.setAttribute(
		"aria-pressed",
		options.enabled ? "true" : "false",
	);
	button.addEventListener("click", options.onToggle);

	container.appendChild(button);
	return button;
}
