import type {
	HomesteadSurfaceActionDiagnostic,
	MountedHomesteadSurface,
	RejectedHomesteadSurfaceActivation,
} from "./surface-inspector.js";
import type {
	HomesteadSurfaceRenderAction,
	HomesteadSurfaceRenderHostContext,
} from "./surface-renderer.js";

export const HOMESTEAD_HOST_RENDERER_KINDS = [
	"web",
	"tui",
	"headless",
] as const;

export type HomesteadHostRendererKind =
	(typeof HOMESTEAD_HOST_RENDERER_KINDS)[number];

export const HOMESTEAD_HOST_RENDERER_CAPABILITIES = [
	"surfaces",
	"surface-actions",
	"host-context",
	"streams",
	"telemetry",
	"diagnostics",
	"interactive",
	"rich-html",
] as const;

export type HomesteadHostRendererCapability =
	(typeof HOMESTEAD_HOST_RENDERER_CAPABILITIES)[number];

export const DEFAULT_HOMESTEAD_HOST_RENDERER_CAPABILITIES: Record<
	HomesteadHostRendererKind,
	readonly HomesteadHostRendererCapability[]
> = {
	web: [
		"surfaces",
		"surface-actions",
		"host-context",
		"streams",
		"telemetry",
		"diagnostics",
		"interactive",
		"rich-html",
	],
	tui: [
		"surfaces",
		"surface-actions",
		"host-context",
		"streams",
		"telemetry",
		"diagnostics",
		"interactive",
	],
	headless: [
		"surfaces",
		"surface-actions",
		"host-context",
		"streams",
		"telemetry",
		"diagnostics",
	],
};

export interface HomesteadHostRendererDescriptor {
	id: string;
	kind: HomesteadHostRendererKind;
	label?: string;
	capabilities: readonly HomesteadHostRendererCapability[];
	metadata?: Record<string, unknown>;
}

export interface HomesteadHostRendererDescriptorOptions {
	label?: string;
	capabilities?: readonly HomesteadHostRendererCapability[];
	metadata?: Record<string, unknown>;
}

export interface HomesteadHostRendererContract {
	renderer: HomesteadHostRendererDescriptor;
	requiredCapabilities?: readonly HomesteadHostRendererCapability[];
	slots?: readonly string[];
}

export interface HomesteadHostSurfaceState {
	mounted?: readonly MountedHomesteadSurface[];
	rejected?: readonly RejectedHomesteadSurfaceActivation[];
	actions?: readonly HomesteadSurfaceActionDiagnostic[];
	availableActions?: readonly HomesteadSurfaceRenderAction[];
	context?: HomesteadSurfaceRenderHostContext;
}

export interface HomesteadHostStreamState {
	active?: number;
	terminal?: number;
	streams?: readonly HomesteadHostStreamDescriptor[];
}

export interface HomesteadHostStreamDescriptor {
	streamRef?: string;
	promptRef?: string;
	status?: string;
	isActive?: boolean;
	isTerminal?: boolean;
}

export interface HomesteadHostRendererSnapshot {
	renderer: HomesteadHostRendererDescriptor;
	surfaces?: HomesteadHostSurfaceState;
	streams?: HomesteadHostStreamState;
	telemetryEvents?: readonly string[];
	diagnostics?: readonly string[];
}

export function isHomesteadHostRendererKind(
	value: unknown,
): value is HomesteadHostRendererKind {
	return (
		typeof value === "string" &&
		(HOMESTEAD_HOST_RENDERER_KINDS as readonly string[]).includes(value)
	);
}

export function createHomesteadHostRendererDescriptor(
	id: string,
	kind: HomesteadHostRendererKind,
	options: HomesteadHostRendererDescriptorOptions = {},
): HomesteadHostRendererDescriptor {
	return {
		id,
		kind,
		label: options.label,
		capabilities: normalizeHomesteadHostRendererCapabilities(
			options.capabilities ??
				DEFAULT_HOMESTEAD_HOST_RENDERER_CAPABILITIES[kind],
		),
		metadata: options.metadata,
	};
}

export function homesteadHostRendererCan(
	renderer: HomesteadHostRendererDescriptor,
	capability: HomesteadHostRendererCapability,
): boolean {
	return renderer.capabilities.includes(capability);
}

export function missingHomesteadHostRendererCapabilities(
	renderer: HomesteadHostRendererDescriptor,
	requiredCapabilities: readonly HomesteadHostRendererCapability[],
): HomesteadHostRendererCapability[] {
	return requiredCapabilities.filter(
		(capability) => !homesteadHostRendererCan(renderer, capability),
	);
}

export function normalizeHomesteadHostRendererCapabilities(
	capabilities: readonly HomesteadHostRendererCapability[],
): HomesteadHostRendererCapability[] {
	return [...new Set(capabilities)];
}
