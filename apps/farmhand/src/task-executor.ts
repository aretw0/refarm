import type { Tractor } from "@refarm.dev/tractor";

const FARMHAND_PLUGIN_ID = "farmhand";

export interface TaskExecutorInput {
	taskId: string;
	effortId: string;
	pluginId: string;
	fn: string;
	args: unknown;
}

export async function executeTask(
	tractor: Pick<Tractor, "plugins" | "storeNode">,
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

	const instance = tractor.plugins.get(pluginId);
	if (!instance) {
		await tractor.storeNode({
			...baseResultNode,
			"task:status": "error",
			"task:error": `Plugin "${pluginId}" is not loaded on this Farmhand`,
		});
		return;
	}

	try {
		const result = await instance.call(fn, args);
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
