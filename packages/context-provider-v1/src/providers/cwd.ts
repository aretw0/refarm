import { CONTEXT_CAPABILITY } from "../types.js";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";

export class CwdContextProvider implements ContextProvider {
	readonly name = "cwd";
	readonly capability = CONTEXT_CAPABILITY;

	async provide(request: ContextRequest): Promise<ContextEntry[]> {
		return [{ label: "cwd", content: request.cwd, priority: 10 }];
	}
}
