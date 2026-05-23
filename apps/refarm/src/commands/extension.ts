import { Command } from "commander";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const INDEX_JS_TEMPLATE = (name: string, id: string) => `\
// ${id} — local refarm extension
// Loaded directly by the Refarm runtime (no WASM compilation needed).
// Edit this file and run '/reload' in the refarm REPL to apply changes.

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

export interface ExtJson {
  id: string;
  name: string;
  version: string;
  capabilities: { provides: string[] };
}

export function buildExtJson(name: string): ExtJson {
  return {
    id: `@local/${name}`,
    name: name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    version: "0.0.1",
    capabilities: { provides: ["ai:respond"] },
  };
}

function extensionBaseDir(cwd: string, homeDir: string, isGlobal: boolean): string {
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

export interface ExtensionListReport {
  extensions: ExtensionEntry[];
}

export interface CreatedExtensionReport extends ExtensionEntry {
  slug: string;
  indexPath: string;
  nextActions: string[];
}

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
        results.push({ id: ext.id, name: ext.name, version: ext.version, dir: extDir, scope });
      } catch {
        // skip unreadable manifests
      }
    }
  };

  scan(path.join(cwd, ".refarm", "extensions"), "project");
  scan(path.join(homeDir, ".refarm", "extensions"), "global");
  return results;
}

export function buildExtensionListReport(cwd: string, homeDir: string): ExtensionListReport {
  return { extensions: listExtensions(cwd, homeDir) };
}

function printCreatedExtension(report: CreatedExtensionReport): void {
  console.log(`Created extension '${report.slug}' at ${report.dir} (${report.scope})`);
  console.log(`  id: ${report.id}`);
  console.log(`  Edit: ${report.indexPath}`);
  console.log(`  Activate: ${report.nextActions[0]}`);
}

async function newExtension(
  name: string,
  isGlobal: boolean,
  options: { json?: boolean } = {},
): Promise<void> {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    console.error(
      `Invalid extension name '${name}': use lowercase letters, digits, and hyphens only (e.g. my-tool)`,
    );
    process.exitCode = 1;
    return;
  }
  const cwd = process.cwd();
  const homeDir = os.homedir();
  const baseDir = extensionBaseDir(cwd, homeDir, isGlobal);
  const extDir = path.join(baseDir, name);

  if (existsSync(extDir)) {
    console.error(`Extension '${name}' already exists at ${extDir}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(extDir, { recursive: true });

  const ext = buildExtJson(name);
  await writeFile(path.join(extDir, "ext.json"), JSON.stringify(ext, null, 2) + "\n", "utf-8");
  const indexPath = path.join(extDir, "index.js");
  await writeFile(indexPath, INDEX_JS_TEMPLATE(name, ext.id), "utf-8");

  const scope = isGlobal ? "global" : "project";
  const report: CreatedExtensionReport = {
    ...ext,
    slug: name,
    dir: extDir,
    scope,
    indexPath,
    nextActions: ["run '/reload' in the refarm REPL, or restart the Refarm runtime"],
  };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printCreatedExtension(report);
}

async function saveExtension(name: string, toGlobal: boolean): Promise<void> {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    console.error(
      `Invalid extension name '${name}': use lowercase letters, digits, and hyphens only (e.g. my-tool)`,
    );
    process.exitCode = 1;
    return;
  }
  const cwd = process.cwd();
  const homeDir = os.homedir();

  const srcDir = toGlobal
    ? path.join(cwd, ".refarm", "extensions", name)
    : path.join(homeDir, ".refarm", "extensions", name);

  const destDir = toGlobal
    ? path.join(homeDir, ".refarm", "extensions", name)
    : path.join(cwd, ".refarm", "extensions", name);

  if (!existsSync(srcDir)) {
    const fromScope = toGlobal ? "project" : "global";
    console.error(`Extension '${name}' not found in ${fromScope} scope (${srcDir})`);
    process.exitCode = 1;
    return;
  }

  await mkdir(path.dirname(destDir), { recursive: true });
  await rename(srcDir, destDir);

  const toScope = toGlobal ? "global" : "project";
  console.log(`Extension '${name}' moved to ${toScope} scope (${destDir})`);
}

function listHandler(options: { json?: boolean } = {}): void {
  const report = buildExtensionListReport(process.cwd(), os.homedir());
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const entries = report.extensions;
  if (entries.length === 0) {
    console.log("No local extensions. Create one: refarm extension new <name>");
    return;
  }

  const idW = Math.max(...entries.map((e) => e.id.length), 2);
  const verW = Math.max(...entries.map((e) => e.version.length), 7);

  console.log(`  ${"ID".padEnd(idW)}  ${"VERSION".padEnd(verW)}  SCOPE`);
  for (const { id, version, scope } of entries) {
    console.log(`  ${id.padEnd(idW)}  ${version.padEnd(verW)}  ${scope}`);
  }
}

export const extensionCommand = new Command("extension").description(
  "Manage local JS extensions (no WASM compilation needed)",
);

extensionCommand.addHelpText(
  "after",
  `

Examples:
  $ refarm extension new my-tool
  $ refarm extension new my-tool --json
  $ refarm extension list
  $ refarm extension list --json
  $ refarm extension save my-tool --global

Notes:
  Local extensions are loaded by the Refarm runtime. After editing one, run
  /reload in the refarm REPL or restart the runtime.
`,
);

extensionCommand
  .command("new <name>")
  .description("Scaffold a new local extension in .refarm/extensions/<name>/")
  .option("-g, --global", "Create in ~/.refarm/extensions/ (available in all projects)", false)
  .option("--json", "Output machine-readable created extension metadata")
  .action(async (name: string, options: { global: boolean; json?: boolean }) => {
    await newExtension(name, options.global, { json: options.json });
  });

extensionCommand
  .command("list")
  .description("List local extensions in this project and globally")
  .option("--json", "Output machine-readable extension inventory")
  .action(listHandler);

extensionCommand
  .command("save <name>")
  .description("Move a project extension to global scope (or vice versa)")
  .option("-g, --global", "Move from project to global scope", false)
  .option("-l, --local", "Move from global to project scope", false)
  .action(async (name: string, options: { global: boolean; local: boolean }) => {
    if (!options.global && !options.local) {
      console.error("Specify --global (project→global) or --local (global→project)");
      process.exitCode = 1;
      return;
    }
    await saveExtension(name, options.global);
  });

extensionCommand
  .command("publish <name>")
  .description("Show the current path from a local extension to a plugin package")
  .action((name: string) => {
    console.log(`Publishing local extension '${name}' is not automated yet.`);
    console.log("Current path:");
    console.log(`  1. Keep iterating locally: refarm extension list`);
    console.log(`  2. Apply changes:         /reload @local/${name}`);
    console.log("  3. Package WASM manually: refarm plugin bundle <plugin.wasm>");
    console.log("  4. Check runtime state:   refarm plugin status");
    process.exitCode = 1;
  });
