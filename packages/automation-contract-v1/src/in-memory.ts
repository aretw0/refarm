import type { AutomationAdapter, AutomationBody } from "./types.js";
import type { Effort } from "@refarm.dev/effort-contract-v1";

export interface InMemoryAutomationOptions {
	body?: AutomationBody;
	pluginFn?: (input: unknown) => Effort | null;
}

export function createInMemoryAutomationAdapter(
	_opts: InMemoryAutomationOptions = {},
): AutomationAdapter {
	throw new Error("not implemented — will be replaced in Task 3");
}
