import type { RuntimeTaskTarget } from "@refarm.dev/runtime";
import { normalizePluginId } from "@refarm.dev/config";

const FARMHAND_PLUGIN_ID = "farmhand";

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

	const resolvedPluginId = normalizePluginId(pluginId);
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
