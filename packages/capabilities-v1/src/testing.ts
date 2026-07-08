import {
	isCapabilityGroup,
	resolveGroupAction,
	type CapabilityEntry,
	type CapabilityInput,
	type CapabilityRegistry,
} from "@refarm.dev/cli/capabilities";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface CapabilityTestHarnessOptions {
	tempPrefix?: string;
}

export interface CapabilityTestHarness {
	runVerb<T = Record<string, unknown>>(
		registry: CapabilityRegistry,
		name: string,
		input?: CapabilityInput,
	): Promise<T>;
	runGroup<T = Record<string, unknown>>(
		registry: CapabilityRegistry,
		name: string,
		tokens: string[],
	): Promise<T>;
	tempStatePath(fileName?: string): string;
	cleanup(): void;
}

const defaultInput: CapabilityInput = {
	args: {},
	options: {},
	json: true,
};

export function createCapabilityTestHarness(
	options: CapabilityTestHarnessOptions = {},
): CapabilityTestHarness {
	const tempDirs: string[] = [];
	const tempPrefix = options.tempPrefix ?? "refarm-capability-test-";

	function entry(registry: CapabilityRegistry, name: string): CapabilityEntry {
		const found = registry.list().find((candidate) => candidate.name === name);
		if (!found) throw new Error(`no capability ${name}`);
		return found;
	}

	return {
		async runVerb<T = Record<string, unknown>>(
			registry: CapabilityRegistry,
			name: string,
			input: CapabilityInput = defaultInput,
		): Promise<T> {
			const found = entry(registry, name);
			if (isCapabilityGroup(found)) throw new Error(`capability ${name} is a group`);
			return (await found.run(input)) as T;
		},

		async runGroup<T = Record<string, unknown>>(
			registry: CapabilityRegistry,
			name: string,
			tokens: string[],
		): Promise<T> {
			const found = entry(registry, name);
			if (!isCapabilityGroup(found)) throw new Error(`capability ${name} is not a group`);
			const resolved = resolveGroupAction(found, tokens);
			if (!resolved) throw new Error(`cannot resolve ${name} ${tokens.join(" ")}`);
			return (await resolved.action.run(resolved.input)) as T;
		},

		tempStatePath(fileName = "manifest.json"): string {
			const dir = mkdtempSync(path.join(tmpdir(), tempPrefix));
			tempDirs.push(dir);
			return path.join(dir, fileName);
		},

		cleanup(): void {
			while (tempDirs.length > 0) {
				rmSync(tempDirs.pop()!, { force: true, recursive: true });
			}
		},
	};
}
