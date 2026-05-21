import { sidecarUrl } from "./sidecar-url.js";

export interface RuntimePluginState {
	installed: string[];
	loaded: string[];
	local: string[];
	known: string[];
}

export interface RuntimePluginReloadResult {
	reloaded: string[];
	deferred: string[];
	skipped: string[];
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

export async function readRuntimePluginState(): Promise<RuntimePluginState | null> {
	try {
		const response = await fetch(sidecarUrl("/plugins"));
		if (!response.ok) return null;
		const payload = (await response.json()) as Partial<RuntimePluginState>;
		return {
			installed: stringArray(payload.installed),
			loaded: stringArray(payload.loaded),
			local: stringArray(payload.local),
			known: stringArray(payload.known),
		};
	} catch {
		return null;
	}
}

export async function reloadRuntimePlugins(
	pluginIds: string[],
): Promise<RuntimePluginReloadResult | null> {
	try {
		const response = await fetch(sidecarUrl("/plugins/reload"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pluginIds }),
		});
		if (!response.ok) return null;
		const payload = (await response.json()) as Partial<RuntimePluginReloadResult>;
		return {
			reloaded: stringArray(payload.reloaded),
			deferred: stringArray(payload.deferred),
			skipped: stringArray(payload.skipped),
		};
	} catch {
		return null;
	}
}

