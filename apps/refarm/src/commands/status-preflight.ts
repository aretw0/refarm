import type { StatusJson } from "@refarm.dev/cli/status";
import { emitStatusOutput, type StatusOutputMode } from "./status-output.js";
import { type ResolveStatusPayloadFn, withResolvedStatusPayload } from "./status-payload.js";

export interface RunStatusPreflightOptions<TResolveOptions> {
	resolveStatusPayload: ResolveStatusPayloadFn<TResolveOptions>;
	resolveOptions: TResolveOptions;
	outputMode: StatusOutputMode;
	printSummary: (json: StatusJson) => void;
	afterEmit?: (json: StatusJson) => void;
}

export async function runStatusPreflight<TResolveOptions>(
	options: RunStatusPreflightOptions<TResolveOptions>,
): Promise<StatusJson> {
	return withResolvedStatusPayload({
		resolveStatusPayload: options.resolveStatusPayload,
		resolveOptions: options.resolveOptions,
		run: (json) => {
			emitStatusOutput({
				status: json,
				mode: options.outputMode,
				printSummary: options.printSummary,
			});
			options.afterEmit?.(json);
			return json;
		},
	});
}
