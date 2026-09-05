import { loadConfig } from "@refarm.dev/config";
import {
	createDiagnosticBundle,
	type DiagnosticBundleV1,
	type DiagnosticValue,
	verifyDiagnosticBundle,
} from "@refarm.dev/diagnostic-bundle-v1";
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveRefarmVersion } from "./runtime-metadata.js";
import { probeRuntimeLiveness, type RuntimeReadinessProbe } from "./runtime-readiness.js";

interface InspectDeps {
	now(): string;
	home(): string;
	cwd(): string;
	version(): string;
	platform(): string;
	arch(): string;
	probeRuntime(): Promise<RuntimeReadinessProbe>;
	loadConfig(root: string): Record<string, unknown>;
	env: NodeJS.ProcessEnv;
	write(path: string, content: string): Promise<void>;
}

const defaults: InspectDeps = {
	now: () => new Date().toISOString(),
	home: os.homedir,
	cwd: process.cwd,
	version: resolveRefarmVersion,
	platform: () => process.platform,
	arch: () => process.arch,
	probeRuntime: probeRuntimeLiveness,
	loadConfig: (root) => loadConfig(root) as Record<string, unknown>,
	env: process.env,
	write: (file, content) => writeFile(file, content, { mode: 0o600 }),
};

function recordCount(value: unknown): number {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? Object.keys(value).length
		: 0;
}

export function knownEnvironmentSecrets(env: NodeJS.ProcessEnv): string[] {
	return Object.entries(env)
		.filter(([key, value]) =>
			/(TOKEN|SECRET|PASSWORD|PASSWD|AUTHORIZATION|COOKIE|PRIVATE_KEY|API_KEY)/i.test(key) &&
			Boolean(value),
		)
		.map(([, value]) => value as string);
}

export async function collectInspectBundle(
	overrides: Partial<InspectDeps> = {},
): Promise<DiagnosticBundleV1> {
	const deps = { ...defaults, ...overrides };
	const home = deps.home();
	const cwd = deps.cwd();
	const runtime = await deps.probeRuntime();
	let config: Record<string, unknown> = {};
	let configReadable = true;
	try {
		config = deps.loadConfig(home);
	} catch {
		configReadable = false;
	}
	const declarations = {
		configReadable,
		workspaces: recordCount(config.workspaces),
		surfaces: recordCount(config.surfaces),
		processes: recordCount(config.processes),
		connections: recordCount(config.connections),
		delivery: recordCount(config.delivery),
	};
	return createDiagnosticBundle(
		{
			createdAt: deps.now(),
			producer: { name: "refarm", version: deps.version() },
			sections: [
				{
					id: "host",
					source: "refarm",
					data: { platform: deps.platform(), arch: deps.arch() },
				},
				{
					id: "runtime",
					source: "refarm-runtime",
					data: {
						ready: runtime.ready,
						status: runtime.status ?? null,
						timedOut: runtime.timedOut ?? false,
						error: runtime.error ?? null,
					} as DiagnosticValue,
				},
				{ id: "declarations", source: "refarm-config", data: declarations },
			],
		},
		{
			knownSecrets: knownEnvironmentSecrets(deps.env),
			privatePaths: [...new Set([home, cwd])],
		},
	);
}

function formatInspect(bundle: DiagnosticBundleV1): string {
	const runtime = bundle.sections.find((section) => section.id === "runtime")?.data as
		| { ready?: boolean }
		| undefined;
	const declarations = bundle.sections.find((section) => section.id === "declarations")?.data as
		| Record<string, number | boolean>
		| undefined;
	return [
		`Refarm inspector (${bundle.producer.version})`,
		`runtime: ${runtime?.ready ? "ready" : "not ready"}`,
		`declarations: ${declarations?.workspaces ?? 0} workspace(s), ${declarations?.surfaces ?? 0} surface(s), ${declarations?.processes ?? 0} process(es)`,
		`redactions: ${bundle.redaction.count}`,
		"Nothing was sent. Use `refarm inspect export` to write a reviewable support file.",
	].join("\n");
}

export function createInspectCommand(overrides: Partial<InspectDeps> = {}): Command {
	const command = new Command("inspect")
		.description("Inspect sanitized host diagnostics without sending or mutating anything")
		.option("--json", "Output the sanitized diagnostic-bundle.v1 document")
		.action(async (options: { json?: boolean }) => {
			const bundle = await collectInspectBundle(overrides);
			process.stdout.write(options.json ? `${JSON.stringify(bundle, null, 2)}\n` : `${formatInspect(bundle)}\n`);
		});

	command
		.command("export")
		.description("Write a sanitized, verified support bundle; never uploads it")
		.option("--output <path>", "Destination JSON file", "refarm-support.json")
		.option("--json", "Output a machine-readable receipt")
		.action(async (options: { output: string; json?: boolean }, actionCommand: Command) => {
			const deps = { ...defaults, ...overrides };
			const bundle = await collectInspectBundle(deps);
			const secrets = knownEnvironmentSecrets(deps.env);
			const verification = verifyDiagnosticBundle(bundle, {
				knownSecrets: secrets,
				privatePaths: [...new Set([deps.home(), deps.cwd()])],
			});
			if (!verification.ok) throw new Error(`support bundle refused: ${verification.issues.join("; ")}`);
			const output = path.resolve(options.output);
			await deps.write(output, `${JSON.stringify(bundle, null, 2)}\n`);
			const receipt = { ok: true, output, wire: bundle.wire, redactions: bundle.redaction.count, uploaded: false };
			const json = options.json === true || actionCommand.optsWithGlobals().json === true;
			process.stdout.write(json ? `${JSON.stringify(receipt)}\n` : `✓ support bundle written to ${output}\n  Nothing was uploaded. Inspect it before sharing.\n`);
		});
	return command;
}

export const inspectCommand = createInspectCommand();
