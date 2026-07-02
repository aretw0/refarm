import type {
	MaterializeOptions,
	MaterializeResult,
	SourceLocation,
	SourceProvider,
	SourceStatus,
} from "./types.js";
import { SOURCE_CAPABILITY } from "./types.js";

function parseLocal(ref: string): string {
	return ref.startsWith("local:") ? ref.slice("local:".length) : ref;
}

export function createInMemorySourceProvider(): SourceProvider {
	const present = new Set<string>();

	async function resolve(ref: string): Promise<SourceLocation> {
		return { kind: "local", path: parseLocal(ref) };
	}

	async function materialize(
		ref: string,
		_opts?: MaterializeOptions,
	): Promise<MaterializeResult> {
		const path = parseLocal(ref);
		const alreadyPresent = present.has(path);
		present.add(path);
		return {
			location: { kind: "local", path },
			action: alreadyPresent ? "noop" : "linked",
			stale: false,
		};
	}

	return {
		pluginId: "@refarm.dev/source-memory-test",
		capability: SOURCE_CAPABILITY,
		kinds: ["local"],
		resolve,
		materialize,
		async status(ref: string): Promise<SourceStatus> {
			const path = parseLocal(ref);
			return { kind: "local", materialized: present.has(path), path };
		},
		async refresh(ref: string, opts?: MaterializeOptions): Promise<MaterializeResult> {
			return materialize(ref, { ...opts, force: true });
		},
	};
}
