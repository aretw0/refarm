import type { RuntimeTaskTarget } from "@refarm.dev/runtime";

const FARMHAND_PLUGIN_ID = "farmhand";
const PLUGIN_ID_ALIASES: Record<string, string> = {
	"pi-agent": "@refarm/pi-agent",
	"refarm/pi-agent": "@refarm/pi-agent",
	"@refarm.dev/pi-agent": "@refarm/pi-agent",
};

export interface TaskExecutorInput {
	taskId: string;
	effortId: string;
	pluginId: string;
	fn: string;
	args: unknown;
}

export async function executeTask(
	tractor: RuntimeTaskTarget,
	{ taskId, effortId, pluginId, fn, args }: TaskExecutorInput,
): Promise<void> {
	const resultId = `urn:farmhand:task:result:${taskId}`;
	const baseResultNode = {
		"@context": "https://schema.refarm.dev/",
		"@type": "FarmhandTaskResult",
		"@id": resultId,
		"refarm:sourcePlugin": FARMHAND_PLUGIN_ID,
		"task:resultFor": taskId,
		"task:effortId": effortId,
	};

	const resolvedPluginId = resolvePluginId(pluginId);
	const instance = tractor.plugins.get(resolvedPluginId);
	if (!instance) {
		await tractor.storeNode({
			...baseResultNode,
			"task:status": "error",
			"task:error": `Plugin "${resolvedPluginId}" is not loaded on this Farmhand`,
		});
		return;
	}

	try {
		const normalizedArgs =
			fn === "respond" && typeof args !== "string"
				? JSON.stringify(args ?? {})
				: args;
		const result = await instance.call(fn, normalizedArgs);
		await tractor.storeNode({
			...baseResultNode,
			"task:status": "ok",
			"task:result": JSON.stringify(result),
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		await tractor.storeNode({
			...baseResultNode,
			"task:status": "error",
			"task:error": message,
		});
	}
}

function resolvePluginId(pluginId: string): string {
	return PLUGIN_ID_ALIASES[pluginId] ?? pluginId;
}
