import { normalizePluginId } from "@refarm.dev/config";
import { sidecarUrl } from "./sidecar-url.js";

export interface RuntimePluginState {
	installed: string[];
	loaded: string[];
	local: string[];
	known: string[];
}

export interface RuntimePluginReloadResult {
	reloadId?: string;
	reloaded: string[];
	deferred: string[];
	skipped: string[];
}

export interface RuntimePluginReloadWaitOptions {
	onDeferred?(pluginId: string): void;
	pollIntervalMs?: number;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function reloadBody(pluginIds?: string[]): string | undefined {
	return pluginIds
		? JSON.stringify({ pluginIds: pluginIds.map(normalizePluginId) })
		: undefined;
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
	pluginIds?: string[],
): Promise<RuntimePluginReloadResult | null> {
	try {
		const response = await fetch(sidecarUrl("/plugins/reload"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: reloadBody(pluginIds),
		});
		if (!response.ok) return null;
		const payload = (await response.json()) as Partial<RuntimePluginReloadResult>;
		return {
			reloadId: typeof payload.reloadId === "string" ? payload.reloadId : undefined,
			reloaded: stringArray(payload.reloaded),
			deferred: stringArray(payload.deferred),
			skipped: stringArray(payload.skipped),
		};
	} catch {
		return null;
	}
}

export async function reloadRuntimePluginsAndWait(
	pluginIds?: string[],
	options: RuntimePluginReloadWaitOptions = {},
): Promise<{ reloaded: string[]; skipped: string[] } | null> {
	const initial = await reloadRuntimePlugins(pluginIds);
	if (!initial) return null;

	const pending = new Set(initial.deferred);
	const completed = new Set(initial.reloaded);
	const failed = new Set(initial.skipped);
	if (!initial.reloadId || pending.size === 0) {
		return { reloaded: [...completed], skipped: [...failed] };
	}

	for (const pluginId of pending) {
		options.onDeferred?.(pluginId);
	}

	const pollIntervalMs = options.pollIntervalMs ?? 500;
	while (pending.size > 0) {
		await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));

		const response = await fetch(
			sidecarUrl(`/plugins/reload/status/${initial.reloadId}`),
		);
		if (!response.ok) break;

		const status = (await response.json()) as {
			pending?: unknown;
			completed?: unknown;
			failed?: unknown;
		};
		const stillPending = stringArray(status.pending);
		for (const pluginId of stringArray(status.completed)) {
			if (pending.delete(pluginId)) completed.add(pluginId);
		}
		for (const pluginId of stringArray(status.failed)) {
			if (pending.delete(pluginId)) failed.add(pluginId);
		}
		for (const pluginId of [...pending]) {
			if (!stillPending.includes(pluginId)) {
				pending.delete(pluginId);
				if (!completed.has(pluginId)) failed.add(pluginId);
			}
		}
	}

	return { reloaded: [...completed], skipped: [...failed] };
}
