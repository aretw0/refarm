export const CONTEXT_CAPABILITY = "context:v1" as const;

export interface ContextRequest {
	cwd: string;
	query?: string;
}

export interface ContextEntry {
	label: string;
	content: string;
	priority?: number;
}

export interface ContextProvider {
	readonly name: string;
	readonly capability: typeof CONTEXT_CAPABILITY;
	provide(request: ContextRequest): Promise<ContextEntry[]>;
}
