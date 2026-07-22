import { createCapabilityWebSurfacePlugin } from "@refarm.dev/capability-homestead-surface";
import {
	buildJsonSuccessEnvelope,
	createLocalCapabilityDeps,
	defineCapabilityHost,
	type CapabilityDescriptor,
} from "@refarm.dev/capability-host";
import type { RuntimePluginHandle } from "@refarm.dev/runtime";

export const REFARM_ME_PERSONAL_CAPABILITY_SURFACE_PLUGIN_ID =
	"refarm-me-personal-capability-surface";

/** The hub's live posture — the SAME facts the bespoke hero panel narrates, exposed as
 *  data so registry-derived verbs can serve them. A thunk, so the host samples the
 *  CURRENT state at dispatch time, not a snapshot taken at construction. */
export interface RefarmMePersonalStatus {
	profileName: string;
	identityStatus: string;
	syncStatus: string;
	graphMode: string;
	storageScope: string;
	syncScope: string;
	pluginRegistryCount: number;
	discoveredContentPluginCount: number;
	referenceDriverCapabilityIds: readonly string[];
	scheduledWorkSummary: {
		total: number;
		due: number;
		scheduled: number;
		unsupported: number;
	} | null;
}

/**
 * The citizen hub's PERSONAL verbs, declared once (convergence Slice 2). These are the
 * registry twin of the bespoke hero panel: `status` serves the hub's posture, `profile`
 * the citizen's scopes — each an honest JSON envelope any surface can project.
 */
export function createRefarmMePersonalCapabilities(
	status: () => RefarmMePersonalStatus,
): CapabilityDescriptor[] {
	return [
		{
			name: "status",
			summary: "Estado do meu espaço soberano — identidade, sincronização e grafo",
			renderers: {
				tui: { section: "pessoal" },
				web: { route: "/status", icon: "status" },
			},
			run: () => {
				const current = status();
				return buildJsonSuccessEnvelope({
					command: "me",
					operation: "status",
					extra: {
						identityStatus: current.identityStatus,
						syncStatus: current.syncStatus,
						graphMode: current.graphMode,
						pluginRegistryCount: current.pluginRegistryCount,
						discoveredContentPluginCount: current.discoveredContentPluginCount,
						referenceDriverCapabilityCount: current.referenceDriverCapabilityIds.length,
						scheduledWorkSummary: current.scheduledWorkSummary,
					},
				});
			},
		},
		{
			name: "profile",
			summary: "Meu perfil — nome e escopos do meu espaço pessoal",
			renderers: {
				tui: { section: "pessoal" },
				web: { route: "/profile", icon: "profile" },
			},
			run: () => {
				const current = status();
				return buildJsonSuccessEnvelope({
					command: "me",
					operation: "profile",
					extra: {
						profileName: current.profileName,
						storageScope: current.storageScope,
						syncScope: current.syncScope,
					},
				});
			},
		},
	];
}

/**
 * The personal panel DERIVED from a registry (convergence Slice 2): the product dogfoods
 * `createCapabilityWebSurfacePlugin` — the same primitive the examples and the wallet
 * use — instead of a bespoke render path. Mounted ALONGSIDE the hero panel, never
 * replacing it: the hub keeps its breadth (hero + chat + wallet + this), the refactor is
 * the mounting mechanism.
 */
export function createRefarmMePersonalCapabilitySurface(
	status: () => RefarmMePersonalStatus,
	options: { slot?: string } = {},
): RuntimePluginHandle {
	const host = defineCapabilityHost({
		id: "apps/me/personal",
		command: "me",
		description: "O espaço pessoal do cidadão",
		version: "0.0.0",
		capabilities: () => ({
			deps: createLocalCapabilityDeps(),
			extensions: createRefarmMePersonalCapabilities(status),
		}),
	});
	return createCapabilityWebSurfacePlugin(host.registry(), {
		pluginId: REFARM_ME_PERSONAL_CAPABILITY_SURFACE_PLUGIN_ID,
		name: "Refarm.me Personal Capabilities",
		title: "Meu espaço pessoal",
		...(options.slot ? { slot: options.slot } : {}),
	}) as RuntimePluginHandle;
}
