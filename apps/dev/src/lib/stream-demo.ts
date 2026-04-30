import type { SovereignNode, Tractor } from "@refarm.dev/tractor";

const DEMO_STREAM_REF = "urn:tractor:stream:agent-response:studio-demo";

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
