import { normalizePluginId } from "@refarm.dev/config";
import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";
import { sidecarUrl } from "./sidecar-url.js";

/** One `--plugin <path>` the daemon was handed at startup, and what became of it.
 *
 * `id` is `null` when the load FAILED before the manifest could be read — the id is genuinely
 * unknown, and `path` is what identifies the row. NEVER derived from `path` (e.g. a file stem):
 * every real plugin is installed as `.../<name>/plugin.wasm`, so every stem is the literal
 * string `"plugin"` — a stem-derived id would collide across every entry. A wrong id is worse
 * than an absent one. `because` carries the real load error, or `null` when it loaded. */
export interface RequestedPluginFact {
	id: string | null;
	path: string;
	loaded: boolean;
	because: string | null;
}

export interface RuntimePluginState {
	/** Every path the host was handed at startup, and what became of it. Host-observed only —
	 *  the daemon receives explicit paths and does not scan, so this is never a listing of
	 *  what's installed on disk (that's `readInstalledPlugins`, in plugin-inventory.ts). */
	requested: RequestedPluginFact[];
	/** ids (runtime tokens, normalized) that are live channels right now. */
	loaded: string[];
	/** ID of the loaded plugin with "integration:respond" capability, if any. */
	defaultResponder: string | null;
}

/** ids the daemon was HANDED and could identify — every `requested` entry with a non-null id,
 *  deduped. NOT the disk-installed fact (`readInstalledPlugins` answers that); this is the
 *  closest a caller with only host data can get to "does the daemon already know about this
 *  plugin, so a reload might work instead of a fresh install" — the question `ask`/`session`
 *  ask before deciding whether to recommend reload or install. */
export function requestedPluginIds(state: Pick<RuntimePluginState, "requested">): string[] {
	return [...new Set(state.requested.map((r) => r.id).filter((id): id is string => id !== null))];
}

/**
 * Whether ANY `--plugin` the daemon was handed at startup FAILED before its manifest could be
 * read (`id: null` — see `RequestedPluginFact`'s doc; the host emits this for every failed
 * load, never a guessed id). `requestedPluginIds` filters exactly these entries out, so its
 * emptiness alone cannot tell "nothing was ever requested" (genuinely not installed) apart
 * from "something was requested and installed, but failed to load with an id this scan
 * cannot know" — the THIRD state D2 exists to make expressible. `ask`/`session` consult this
 * before recommending install: a plugin that failed to load is already installed, and telling
 * an operator to install it again is the exact confusion D2 exists to close.
 */
export function anyRequestedPluginFailed(state: Pick<RuntimePluginState, "requested">): boolean {
	return state.requested.some((r) => r.id === null);
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
	maxWaitMs?: number;
}

export interface RuntimePluginReloadWaitResult {
	reloaded: string[];
	skipped: string[];
	timedOut: boolean;
}

const DEFAULT_PLUGIN_RELOAD_MAX_WAIT_MS = 120000;

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function pluginIdArray(value: unknown): string[] {
	return stringArray(value).map(normalizePluginId);
}

function reloadBody(pluginIds?: string[]): string | undefined {
	return pluginIds ? JSON.stringify({ pluginIds: pluginIds.map(normalizePluginId) }) : undefined;
}

/** Parse the host's `requested` rows defensively: a malformed entry (not an object, or missing
 *  the one field every row must have — `path`, its identifying handle) is dropped rather than
 *  guessed at, same posture as `stringArray` filtering non-strings. `id` runs through
 *  `normalizePluginId` when present — the host reports a RUNTIME token
 *  (`manifest_runtime_plugin_id`, e.g. `"agent"`), and every other id this module reports is
 *  already normalized to the manifest vocabulary; a `null` id stays `null` (never guessed from
 *  `path`, see `RequestedPluginFact`). */
function requestedArray(value: unknown): RequestedPluginFact[] {
	if (!Array.isArray(value)) return [];
	const out: RequestedPluginFact[] = [];
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) continue;
		const row = entry as Record<string, unknown>;
		if (typeof row.path !== "string") continue;
		out.push({
			id: typeof row.id === "string" ? normalizePluginId(row.id) : null,
			path: row.path,
			loaded: row.loaded === true,
			because: typeof row.because === "string" ? row.because : null,
		});
	}
	return out;
}

export async function readRuntimePluginState(): Promise<RuntimePluginState | null> {
	try {
		const response = await fetchSidecarWithTimeout(sidecarUrl("/plugins"));
		if (!response.ok) return null;
		const payload = (await response.json()) as Record<string, unknown>;
		return {
			requested: requestedArray(payload.requested),
			loaded: pluginIdArray(payload.loaded),
			defaultResponder:
				typeof payload.defaultResponder === "string"
					? normalizePluginId(payload.defaultResponder)
					: null,
		};
	} catch {
		return null;
	}
}

export async function reloadRuntimePlugins(
	pluginIds?: string[],
): Promise<RuntimePluginReloadResult | null> {
	try {
		const response = await fetchSidecarWithTimeout(sidecarUrl("/plugins/reload"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: reloadBody(pluginIds),
		});
		if (!response.ok) return null;
		const payload = (await response.json()) as Partial<RuntimePluginReloadResult>;
		return {
			reloadId: typeof payload.reloadId === "string" ? payload.reloadId : undefined,
			reloaded: pluginIdArray(payload.reloaded),
			deferred: pluginIdArray(payload.deferred),
			skipped: pluginIdArray(payload.skipped),
		};
	} catch {
		return null;
	}
}

export async function reloadRuntimePluginsAndWait(
	pluginIds?: string[],
	options: RuntimePluginReloadWaitOptions = {},
): Promise<RuntimePluginReloadWaitResult | null> {
	const initial = await reloadRuntimePlugins(pluginIds);
	if (!initial) return null;

	const configuredMaxWaitMs = Number.parseInt(
		options.maxWaitMs?.toString() ??
			process.env.REFARM_PLUGIN_RELOAD_MAX_WAIT_MS ??
			String(DEFAULT_PLUGIN_RELOAD_MAX_WAIT_MS),
		10,
	);
	const maxWaitMs = Number.isNaN(configuredMaxWaitMs)
		? DEFAULT_PLUGIN_RELOAD_MAX_WAIT_MS
		: configuredMaxWaitMs;
	const deadlineMs = maxWaitMs > 0 ? Date.now() + maxWaitMs : Date.now();
	const pollIntervalMs = options.pollIntervalMs ?? 500;
	let timedOut = false;

	const pending = new Set(initial.deferred);
	const completed = new Set(initial.reloaded);
	const failed = new Set(initial.skipped);
	if (!initial.reloadId || pending.size === 0) {
		return { reloaded: [...completed], skipped: [...failed], timedOut: false };
	}

	for (const pluginId of pending) {
		options.onDeferred?.(pluginId);
	}

	while (pending.size > 0) {
		if (Date.now() >= deadlineMs) {
			timedOut = true;
			for (const pluginId of pending) failed.add(pluginId);
			pending.clear();
			break;
		}

		await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));

		const response = await fetchSidecarWithTimeout(
			sidecarUrl(`/plugins/reload/status/${initial.reloadId}`),
		);
		if (!response.ok) {
			timedOut = true;
			for (const pluginId of pending) failed.add(pluginId);
			pending.clear();
			break;
		}

		const status = (await response.json()) as {
			pending?: unknown;
			completed?: unknown;
			failed?: unknown;
		};
		const stillPending = pluginIdArray(status.pending);
		for (const pluginId of pluginIdArray(status.completed)) {
			if (pending.delete(pluginId)) completed.add(pluginId);
		}
		for (const pluginId of pluginIdArray(status.failed)) {
			if (pending.delete(pluginId)) failed.add(pluginId);
		}
		for (const pluginId of [...pending]) {
			if (!stillPending.includes(pluginId)) {
				pending.delete(pluginId);
				if (!completed.has(pluginId)) failed.add(pluginId);
			}
		}
	}

	return { reloaded: [...completed], skipped: [...failed], timedOut };
}
