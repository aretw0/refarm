import {
	createHomesteadHostRendererDescriptor,
	type HomesteadHostRendererDescriptor,
	type HomesteadHostRendererKind,
} from "@refarm.dev/homestead/sdk/host-renderer";

export const REFARM_WEB_RENDERER = createHomesteadHostRendererDescriptor(
	"refarm-web",
	"web",
);

export const REFARM_TUI_RENDERER = createHomesteadHostRendererDescriptor(
	"refarm-tui",
	"tui",
);

export const REFARM_HEADLESS_RENDERER = createHomesteadHostRendererDescriptor(
	"refarm-headless",
	"headless",
);

export const REFARM_RENDERERS: Record<
	HomesteadHostRendererKind,
	HomesteadHostRendererDescriptor
> = {
	web: REFARM_WEB_RENDERER,
	tui: REFARM_TUI_RENDERER,
	headless: REFARM_HEADLESS_RENDERER,
};

export function resolveRefarmRenderer(
	kind: HomesteadHostRendererKind,
): HomesteadHostRendererDescriptor {
	return REFARM_RENDERERS[kind];
}
