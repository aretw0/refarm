import {
	createHomesteadHostRendererDescriptor,
	isHomesteadHostRendererKind,
	type HomesteadHostRendererDescriptor,
	type HomesteadHostRendererKind,
} from "@refarm.dev/homestead/sdk/host-renderer";

export const STUDIO_WEB_RENDERER = createHomesteadHostRendererDescriptor(
	"refarm-dev-web",
	"web",
	{
		label: "Refarm Studio Web",
		metadata: { app: "apps/dev" },
	},
);

export const STUDIO_HEADLESS_RENDERER = createHomesteadHostRendererDescriptor(
	"refarm-dev-headless",
	"headless",
	{
		label: "Refarm Studio Headless",
		metadata: { app: "apps/dev" },
	},
);

export const STUDIO_RENDERERS = [
	STUDIO_WEB_RENDERER,
	STUDIO_HEADLESS_RENDERER,
] as const satisfies readonly HomesteadHostRendererDescriptor[];

export type StudioRendererKind = (typeof STUDIO_RENDERERS)[number]["kind"];

export function findStudioRenderer(
	kind: HomesteadHostRendererKind | string | undefined,
): HomesteadHostRendererDescriptor | undefined {
	if (!isHomesteadHostRendererKind(kind)) return undefined;
	return STUDIO_RENDERERS.find((renderer) => renderer.kind === kind);
}

export function resolveStudioRenderer(
	kind: HomesteadHostRendererKind | string | undefined,
	fallback: HomesteadHostRendererDescriptor = STUDIO_WEB_RENDERER,
): HomesteadHostRendererDescriptor {
	return findStudioRenderer(kind) ?? fallback;
}
