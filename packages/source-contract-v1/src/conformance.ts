import { isMaterializeResult } from "./schema.js";
import {
	SOURCE_CAPABILITY,
	type SourceConformanceResult,
	type SourceProvider,
} from "./types.js";

const DEFAULT_SAMPLE_REF = "local:/__source_conformance__/sample";

export async function runSourceV1Conformance(
	provider: SourceProvider,
	sampleRef: string = DEFAULT_SAMPLE_REF,
): Promise<SourceConformanceResult> {
	const failures: string[] = [];

	if (provider.capability !== SOURCE_CAPABILITY) {
		failures.push("provider.capability must be 'source:v1'");
	}

	if (!provider.pluginId || provider.pluginId.trim().length === 0) {
		failures.push("provider.pluginId must be a non-empty string");
	}

	if (!Array.isArray(provider.kinds) || provider.kinds.length === 0) {
		failures.push("provider.kinds must be non-empty");
	}

	try {
		const first = await provider.resolve(sampleRef);
		const second = await provider.resolve(sampleRef);
		if (first.path !== second.path) {
			failures.push("resolve() must return the same path for the same ref");
		}
	} catch (error) {
		failures.push(`resolve() threw: ${String(error)}`);
	}

	let materializedPath: string | undefined;
	try {
		const result = await provider.materialize(sampleRef);
		if (!isMaterializeResult(result)) {
			failures.push("materialize() must return a valid MaterializeResult");
		} else {
			materializedPath = result.location.path;
		}
	} catch (error) {
		failures.push(`materialize() threw: ${String(error)}`);
	}

	try {
		const status = await provider.status(sampleRef);
		if (!status.materialized) {
			failures.push("status() must report materialized=true after materialize()");
		}
		if (materializedPath && status.path && status.path !== materializedPath) {
			failures.push("status().path must match materialize() location.path");
		}
	} catch (error) {
		failures.push(`status() threw: ${String(error)}`);
	}

	try {
		const refreshed = await provider.refresh(sampleRef);
		if (!isMaterializeResult(refreshed)) {
			failures.push("refresh() must return a valid MaterializeResult");
		}
	} catch (error) {
		failures.push(`refresh() threw: ${String(error)}`);
	}

	const failed = failures.length;
	return { pass: failed === 0, total: 7, failed, failures };
}
