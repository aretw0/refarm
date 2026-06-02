import { normalizePluginId } from "@refarm.dev/config";
import type { RuntimeTaskTarget } from "@refarm.dev/runtime";

const FARMHAND_PLUGIN_ID = "farmhand";
const AGENT_ERROR_PREFIXES = ["[pi-agent erro]", "[pi-agent stub]", "[budget]"];

export interface TaskExecutorInput {
	taskId: string;
	effortId: string;
	pluginId: string;
	fn: string;
	args: unknown;
}

function resultContent(result: unknown): string | null {
	if (typeof result === "string") return result;
	if (Array.isArray(result)) {
		const [content] = result;
		return typeof content === "string" ? content : null;
	}
	if (result && typeof result === "object") {
		const content = (result as { content?: unknown }).content;
		return typeof content === "string" ? content : null;
	}
	return null;
}

function resultErrorMessage(result: unknown): string | null {
	const content = resultContent(result);
	if (!content) return null;
	return AGENT_ERROR_PREFIXES.some((prefix) => content.startsWith(prefix))
		? content
		: null;
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
		const taskError = resultErrorMessage(result);
		if (taskError) {
			await tractor.storeNode({
				...baseResultNode,
				"task:status": "error",
				"task:error": taskError,
				"task:result": JSON.stringify(result),
			});
			return;
		}
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
