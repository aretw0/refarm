import type { ExtensionSurfaceDeclaration } from "@refarm.dev/plugin-manifest";
import type { HomesteadSurfaceMount } from "./surface-slots.js";

export interface HomesteadSurfaceRenderRequest {
	pluginId: string;
	slotId: string;
	mountSource: HomesteadSurfaceMount["source"];
	surface?: ExtensionSurfaceDeclaration;
	locale: string;
	host?: HomesteadSurfaceRenderHostContext;
}

export interface HomesteadSurfaceRenderAction {
	id: string;
	label: string;
	intent?: string;
	payload?: Record<string, unknown>;
}

export interface HomesteadSurfaceRenderHostContext {
	hostId?: string;
	data?: Record<string, unknown>;
	actions?: HomesteadSurfaceRenderAction[];
}

export type HomesteadSurfaceRenderContextRequest = Omit<
	HomesteadSurfaceRenderRequest,
	"host"
>;

export type HomesteadSurfaceRenderContextProvider = (
	request: HomesteadSurfaceRenderContextRequest,
) =>
	| HomesteadSurfaceRenderHostContext
	| undefined
	| Promise<HomesteadSurfaceRenderHostContext | undefined>;

export type HomesteadSurfaceRenderResult =
	| string
	| {
			html?: string | null;
			text?: string | null;
	  }
	| null
	| undefined;

export type HomesteadSurfaceRenderContent =
	| { kind: "html"; value: string }
	| { kind: "text"; value: string };

/**
 * Normalize plugin-provided Homestead surface render results into a DOM write
 * strategy. Plain strings are treated as text; trusted plugins must opt in to
 * raw HTML by returning `{ html }` explicitly.
 */
export function homesteadSurfaceRenderContent(
	result: HomesteadSurfaceRenderResult,
): HomesteadSurfaceRenderContent | undefined {
	if (typeof result === "string") {
		return { kind: "text", value: result };
	}

	if (!result || typeof result !== "object") return undefined;

	if (typeof result.html === "string") {
		return { kind: "html", value: result.html };
	}

	if (typeof result.text === "string") {
		return { kind: "text", value: result.text };
	}

	return undefined;
}
