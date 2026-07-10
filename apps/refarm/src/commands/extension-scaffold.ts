/**
 * The local-plugin scaffold: the pure model + fs writes behind `plugin new` /
 * `extension new`. Split out of `extension.ts` (ADR-086) so the `plugin`
 * CapabilityGroup can reuse `buildCreatedPluginReport` WITHOUT pulling
 * `extension.ts`'s `capability-registry` import — that closed an import cycle
 * (capability-registry → plugin-capability → extension → capability-registry) and
 * broke registry initialization at load. This module is a leaf: it imports only
 * `@refarm.dev/*` + `node:*`, never the registry.
 *
 * "Pure" here means returns-an-envelope and never prints; the fs writes are the
 * point of `new`, done directly (the same way buildInstallReport writes). cwd /
 * homeDir are injected so the builder is host-agnostic and testable over a tmpdir.
 */
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type JsonErrorEnvelope,
	type JsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
import { pluginSurfaceName } from "@refarm.dev/capability-host";
import { quoteCommandArg, refarmCommand } from "@refarm.dev/cli/command-handoff";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function extensionReloadCommand(name: string, json = false): string {
	return refarmCommand([
		"plugin",
		"reload",
		quoteCommandArg(`@local/${name}`),
		...(json ? ["--json"] : []),
	]);
}

export interface DispatchVerbScaffold {
	pluginKey: string;
	verb: string;
	target: string;
	dispatchEvent: string;
	surfaceName: string;
}

export function normalizeDispatchVerb(
	name: string,
	rawVerb?: string,
): DispatchVerbScaffold | undefined {
	if (!rawVerb) return undefined;
	const value = rawVerb.trim();
	const match = value.match(/^([a-z0-9][a-z0-9-]*):([a-z0-9][a-z0-9-]*)$/);
	if (match) {
		const pluginKey = match[1]!;
		const verb = match[2]!;
		return {
			pluginKey,
			verb,
			target: `${pluginKey}:${verb}`,
			dispatchEvent: `${pluginKey}:dispatch`,
			surfaceName: pluginSurfaceName(pluginKey, verb),
		};
	}
	if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
		throw new Error("invalid-extension-verb");
	}
	return {
		pluginKey: name,
		verb: value,
		target: `${name}:${value}`,
		dispatchEvent: `${name}:dispatch`,
		surfaceName: pluginSurfaceName(name, value),
	};
}

const DEFAULT_INDEX_JS_TEMPLATE = (name: string, id: string) => `\
// ${id} — local refarm extension
// Loaded directly by the Refarm runtime (no WASM compilation needed).
// Edit this file and run 'refarm plugin reload ${id} --json' to apply changes.

export const integration = {
  /**
   * Called by 'refarm ask <prompt>'.
   * argsJson: JSON string { prompt: string }
   * Returns: JSON string { content, model, provider, usage }
   */
  async respond(argsJson) {
    const args = typeof argsJson === 'string' ? JSON.parse(argsJson) : argsJson;
    const prompt = args?.prompt ?? '';

    // TODO: replace with your extension logic
    return JSON.stringify({
      content: \`[${name}] \${prompt}\`,
      model: 'local-extension',
      provider: 'local',
      usage: { tokens_in: 0, tokens_out: 0, estimated_usd: 0 },
    });
  },
};
`;

const DISPATCH_INDEX_JS_TEMPLATE = (
	name: string,
	id: string,
	dispatch: DispatchVerbScaffold,
) => `\
// ${id} — local dispatch extension
// Edit this file and run 'refarm plugin reload ${id} --json' to apply changes.

const DISPATCH_EVENT = "${dispatch.dispatchEvent}";

function parseDispatch(args) {
  const [event, payloadJson] = Array.isArray(args) ? args : [undefined, args];
  if (event !== DISPATCH_EVENT) return undefined;
  try {
    const payload = typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;
    if (!payload || typeof payload !== "object") return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

async function handleDispatch(payload) {
  switch (payload.verb) {
    case "${dispatch.verb}":
      // TODO: replace with your ${name} extension logic
      return JSON.stringify({
        ok: true,
        verb: "${dispatch.verb}",
        input: payload,
      });
    default:
      return JSON.stringify({
        ok: false,
        error: "unsupported-verb",
        verb: payload.verb,
      });
  }
}

export const integration = {
  async "on-event"(args) {
    return this.onEvent(args);
  },

  async onEvent(args) {
    const payload = parseDispatch(args);
    if (!payload) return;
    return handleDispatch(payload);
  },
};
`;

export function indexJsTemplate(
	name: string,
	id: string,
	dispatch?: DispatchVerbScaffold,
): string {
	return dispatch
		? DISPATCH_INDEX_JS_TEMPLATE(name, id, dispatch)
		: DEFAULT_INDEX_JS_TEMPLATE(name, id);
}

export interface ExtJson {
	id: string;
	name: string;
	version: string;
	capabilities: { provides: string[]; subscribes?: string[] };
}

export function buildExtJson(name: string, options: { verb?: string } = {}): ExtJson {
	const dispatch = normalizeDispatchVerb(name, options.verb);
	return {
		id: `@local/${name}`,
		name: name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
		version: "0.0.1",
		capabilities: dispatch
			? { provides: [dispatch.target], subscribes: [dispatch.dispatchEvent] }
			: { provides: ["ai:respond"] },
	};
}

export function extensionBaseDir(
	cwd: string,
	homeDir: string,
	isGlobal: boolean,
): string {
	return isGlobal
		? path.join(homeDir, ".refarm", "extensions")
		: path.join(cwd, ".refarm", "extensions");
}

export interface ExtensionEntry {
	id: string;
	name: string;
	version: string;
	dir: string;
	scope: "project" | "global";
}

export type ExtensionListReport = JsonSuccessEnvelope<{
	extensions: ExtensionEntry[];
}>;

/** Scan `.refarm/extensions/` (project then global) for authored local plugins.
 *  Lives here (the leaf) so both `extension list` and the unified `plugin list`
 *  reader (ADR-086) can read local plugins without the registry import cycle. */
export function listExtensions(cwd: string, homeDir: string): ExtensionEntry[] {
	const results: ExtensionEntry[] = [];

	const scan = (baseDir: string, scope: "project" | "global") => {
		if (!existsSync(baseDir)) return;
		const entries = readdirSync(baseDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const extDir = path.join(baseDir, entry.name);
			const extJsonPath = path.join(extDir, "ext.json");
			if (!existsSync(extJsonPath)) continue;
			try {
				const ext = JSON.parse(readFileSync(extJsonPath, "utf-8")) as ExtJson;
				results.push({
					id: ext.id,
					name: ext.name,
					version: ext.version,
					dir: extDir,
					scope,
				});
			} catch {
				// skip unreadable manifests
			}
		}
	};

	scan(path.join(cwd, ".refarm", "extensions"), "project");
	scan(path.join(homeDir, ".refarm", "extensions"), "global");
	return results;
}

export function buildExtensionListReport(
	cwd: string,
	homeDir: string,
): ExtensionListReport {
	return buildJsonSuccessEnvelope({
		command: "extension",
		operation: "list",
		extra: {
			extensions: listExtensions(cwd, homeDir),
		},
	});
}

export interface CreatedExtensionReport extends ExtensionEntry {
	// The verb this scaffold was created under (ADR-086). Defaults to "extension"
	// for the legacy call-site; `plugin new` stamps "plugin".
	command: "extension" | "plugin";
	operation: "new";
	ok: true;
	slug: string;
	indexPath: string;
	surfaceName?: string;
	surfaceCommand?: string;
	nextAction: string;
	nextActions: string[];
	nextCommand?: string;
	nextCommands?: string[];
}

/** Inputs for the pure plugin-scaffold builder. cwd/homeDir are injected (not read
 *  from process.*) so the builder is host-agnostic and testable over a tmpdir. */
export interface CreatePluginScaffoldInput {
	name: string;
	isGlobal: boolean;
	verb?: string;
	cwd: string;
	homeDir: string;
	/** The verb this scaffold is created under (ADR-086); stamped into the report +
	 *  list handoff. Defaults to "extension" so the legacy call-site is unchanged. */
	commandName?: "extension" | "plugin";
}

/**
 * Scaffold a new local plugin (ADR-086): validate the name + verb, write the
 * `ext.json` and `index.js` under `.refarm/extensions/<name>/`, and RETURN the
 * created-report envelope (or a JSON error envelope) — it never prints or touches
 * `process.exitCode`. The surface hooks own text render + exit intent.
 */
export async function buildCreatedPluginReport(
	input: CreatePluginScaffoldInput,
): Promise<CreatedExtensionReport | JsonErrorEnvelope> {
	const commandName = input.commandName ?? "extension";
	const { name, isGlobal, verb, cwd, homeDir } = input;
	if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
		return buildJsonErrorEnvelope({
			command: commandName,
			operation: "new",
			error: "invalid-name",
			message: `Invalid ${commandName} name '${name}': use lowercase letters, digits, and hyphens only (e.g. my-tool)`,
			nextAction: `refarm ${commandName} new my-tool`,
		});
	}
	let dispatch: DispatchVerbScaffold | undefined;
	try {
		dispatch = normalizeDispatchVerb(name, verb);
	} catch {
		return buildJsonErrorEnvelope({
			command: commandName,
			operation: "new",
			error: "invalid-verb",
			message: `Invalid ${commandName} verb '${verb}': use a bare verb (e.g. open) or a qualified verb (e.g. wallet:open)`,
			nextAction: `refarm ${commandName} new ${name} --verb open`,
		});
	}
	const baseDir = extensionBaseDir(cwd, homeDir, isGlobal);
	const extDir = path.join(baseDir, name);
	if (existsSync(extDir)) {
		return buildJsonErrorEnvelope({
			command: commandName,
			operation: "new",
			error: "already-exists",
			message: `${commandName === "plugin" ? "Plugin" : "Extension"} '${name}' already exists at ${extDir}`,
			nextAction: `refarm ${commandName} list`,
		});
	}

	await mkdir(extDir, { recursive: true });
	const ext = buildExtJson(name, { verb });
	await writeFile(
		path.join(extDir, "ext.json"),
		JSON.stringify(ext, null, 2) + "\n",
		"utf-8",
	);
	const indexPath = path.join(extDir, "index.js");
	await writeFile(indexPath, indexJsTemplate(name, ext.id, dispatch), "utf-8");

	const scope = isGlobal ? "global" : "project";
	const reloadCommand = extensionReloadCommand(name, true);
	const listHandoff = refarmCommand([commandName, "list", "--json"]);
	const surfaceCommand = dispatch
		? refarmCommand([dispatch.surfaceName, "--json"])
		: undefined;
	return {
		command: commandName,
		operation: "new",
		ok: true,
		...ext,
		slug: name,
		dir: extDir,
		scope,
		indexPath,
		...(dispatch ? { surfaceName: dispatch.surfaceName } : {}),
		...(surfaceCommand ? { surfaceCommand } : {}),
		nextAction: reloadCommand,
		nextActions: [
			reloadCommand,
			"restart the Refarm runtime",
			`inside refarm chat, run /reload @local/${name} (or /r @local/${name})`,
		],
		nextCommand: reloadCommand,
		nextCommands: [reloadCommand, listHandoff],
	};
}
