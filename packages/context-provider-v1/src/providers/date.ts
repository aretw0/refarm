import { CONTEXT_CAPABILITY } from "../types.js";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";

export class DateContextProvider implements ContextProvider {
	readonly name = "date";
	readonly capability = CONTEXT_CAPABILITY;

	async provide(_request: ContextRequest): Promise<ContextEntry[]> {
		const now = new Date();
		const day = now.toLocaleDateString("en-US", { weekday: "long" });
		const iso = now.toISOString().slice(0, 10);
		return [{ label: "date", content: `${iso}, ${day}`, priority: 20 }];
	}
}
