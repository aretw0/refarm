import { Command } from "commander";
import chalk from "chalk";
import { SovereignRegistry } from "@refarm.dev/registry";
import { execFileSync } from "node:child_process";
import { basename, extname } from "node:path";

export const pluginCommand = new Command("plugin")
  .description("Manage Refarm plugins");

/**
 * Lazy registry singleton — creates a fresh in-memory SovereignRegistry per process.
 * Future: persist state to ~/.refarm/registry.json via importState/exportState.
 */
function createRegistry(): SovereignRegistry {
  return new SovereignRegistry();
}

pluginCommand
  .command("list")
  .description("List all installed plugins")
  .action(async () => {
    const registry = createRegistry();
    const plugins = registry.listPlugins();

    if (plugins.length === 0) {
      console.log(chalk.gray("No plugins installed. Use 'refarm plugin install <id>' to add some."));
      return;
    }

    console.log(chalk.green("🌱 Installed Plugins:"));
    for (const entry of plugins) {
      const statusColor = entry.status === "active" ? chalk.green :
                          entry.status === "validated" ? chalk.cyan : chalk.gray;
      console.log(`  ${chalk.bold(entry.manifest.id)} @ ${entry.manifest.version} — ${statusColor(entry.status)}`);
    }
  });

pluginCommand
  .command("install <id>")
  .description("Install a plugin by its ID from the Sovereign Graph")
  .option("-s, --source <url>", "Remote source URL")
  .action(async (id: string, options: { source?: string }) => {
    const sourceUrl = options.source ?? `https://registry.refarm.dev/plugins/${id}.json`;
    const registry = createRegistry();

    console.log(chalk.blue(`🚀 Installing plugin ${chalk.bold(id)}...`));
    console.log(chalk.gray(`   Source: ${sourceUrl}`));

    try {
      const entry = await registry.resolveRemote(id, sourceUrl);
      console.log(chalk.green(`✅ Plugin ${chalk.bold(id)} resolved and registered.`));
      console.log(chalk.gray(`   Version: ${entry.manifest.version}`));
      console.log(chalk.gray(`   Status: ${entry.status}`));
      console.log(chalk.yellow(`ℹ️  To activate, start a Tractor node (e.g. refarm tractor start)`));
    } catch (e: any) {
      console.error(chalk.red(`❌ Installation failed: ${e.message}`));
      process.exitCode = 1;
    }
  });

pluginCommand
  .command("remove <id>")
  .description("Remove an installed plugin")
  .action(async (id: string) => {
    const registry = createRegistry();
    const plugin = registry.getPlugin(id);

    if (!plugin) {
      console.error(chalk.red(`❌ Plugin ${id} not found in registry.`));
      process.exitCode = 1;
      return;
    }

    if (plugin.status !== "active") {
      console.log(chalk.yellow(`⚠️  Plugin ${id} is not active (status: ${plugin.status}). Nothing to deactivate.`));
      return;
    }

    await registry.deactivatePlugin(id);
    console.log(chalk.green(`✅ Plugin ${id} deactivated.`));
  });

pluginCommand
  .command("search <query>")
  .description("Search for plugins in the Sovereign Graph")
  .action(async (query: string) => {
    console.log(chalk.blue(`🔍 Searching for '${query}' in the Sovereign Graph...`));
    console.log(chalk.gray("(Search requires a Tractor node — coming soon)"));
  });

pluginCommand
  .command("bundle <input>")
  .description("Compile a WASM plugin to a JS component using jco transpile")
  .option("-o, --output <dir>", "Output directory", "./dist")
  .option("-n, --name <name>", "Plugin name (defaults to input filename without extension)")
  .action((input: string, options: { output: string; name?: string }) => {
    const name = options.name ?? basename(input, extname(input));
    const outDir = options.output;

    console.log(chalk.blue(`📦 Bundling plugin ${chalk.bold(name)} from ${input}...`));
    console.log(chalk.gray(`   Output: ${outDir}`));

    try {
      execFileSync("npx", ["jco", "transpile", input, "-o", outDir, "--name", name], {
        stdio: "inherit",
      });
      console.log(chalk.green(`✅ Plugin bundled to ${outDir}/${name}.js`));
    } catch (e: any) {
      console.error(chalk.red(`❌ Bundle failed: ${e.message}`));
      process.exitCode = 1;
    }
  });
