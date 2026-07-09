import type { SubmitEffort } from "./index.js";

type SubmittedEffort = Parameters<SubmitEffort>[0];

export interface MemorySubmitEffort extends SubmitEffort {
	readonly submitted: ReadonlyArray<SubmittedEffort>;
}

export function createMemorySubmitEffort(): MemorySubmitEffort {
	const submitted: SubmittedEffort[] = [];
	const submit = (async (effort: SubmittedEffort) => {
		submitted.push(effort);
		return effort.id;
	}) as MemorySubmitEffort;
	Object.defineProperty(submit, "submitted", { value: submitted });
	return submit;
}
