import {
	createHomesteadHostRendererDescriptor,
	type HomesteadHostRendererDescriptor,
} from "@refarm.dev/homestead/sdk/host-renderer";

export const REFARM_ME_WEB_RENDERER = createHomesteadHostRendererDescriptor(
	"refarm-me-web",
	"web",
	{
		label: "Refarm.me Web",
		metadata: { app: "apps/me" },
	},
);

export const REFARM_ME_RENDERERS = [
	REFARM_ME_WEB_RENDERER,
] as const satisfies readonly HomesteadHostRendererDescriptor[];
