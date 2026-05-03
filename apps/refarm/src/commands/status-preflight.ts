import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import {
	emitRefarmStatusOutput,
	type RefarmStatusOutputMode,
} from "./status-output.js";
import {
	type ResolveStatusPayloadFn,
	withResolvedStatusPayload,
} from "./status-payload.js";

export interface RunStatusPreflightOptions<TResolveOptions> {
	resolveStatusPayload: ResolveStatusPayloadFn<TResolveOptions>;
	resolveOptions: TResolveOptions;
	outputMode: RefarmStatusOutputMode;
	printSummary: (json: RefarmStatusJson) => void;
	afterEmit?: (json: RefarmStatusJson) => void;
}

export async function runStatusPreflight<TResolveOptions>(
	options: RunStatusPreflightOptions<TResolveOptions>,
): Promise<RefarmStatusJson> {
	return withResolvedStatusPayload({
		resolveStatusPayload: options.resolveStatusPayload,
		resolveOptions: options.resolveOptions,
		run: (json) => {
			emitRefarmStatusOutput({
				status: json,
				mode: options.outputMode,
				printSummary: options.printSummary,
			});
			options.afterEmit?.(json);
			return json;
		},
	});
}
