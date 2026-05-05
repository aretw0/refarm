import type { RefarmStatusJson } from "@refarm.dev/cli/status";

export interface ResolvedStatusPayload {
	json: RefarmStatusJson;
	shutdown?: () => Promise<void>;
}

export type ResolveStatusPayloadFn<TOptions> = (
	options: TOptions,
) => Promise<ResolvedStatusPayload>;

export async function withResolvedStatusPayload<TOptions, TResult>(options: {
	resolveStatusPayload: ResolveStatusPayloadFn<TOptions>;
	resolveOptions: TOptions;
	run: (json: RefarmStatusJson) => Promise<TResult> | TResult;
}): Promise<TResult> {
	const { json, shutdown } = await options.resolveStatusPayload(
		options.resolveOptions,
	);

	try {
		return await options.run(json);
	} finally {
		await shutdown?.();
	}
}
