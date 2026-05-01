import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { sowCommand } from "./commands/sow.js";
import { guideCommand } from "./commands/guide.js";
import { healthCommand } from "./commands/health.js";
import { migrateCommand } from "./commands/migrate.js";
import { deployCommand } from "./commands/deploy.js";
import { pluginCommand } from "./commands/plugin.js";
import { statusCommand } from "./commands/status.js";
import { taskCommand } from "./commands/task.js";

export const program = new Command();

program
  .name("refarm")
  .description("The Sovereign Farm CLI")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(sowCommand);
program.addCommand(guideCommand);
program.addCommand(healthCommand);
program.addCommand(migrateCommand);
program.addCommand(deployCommand);
program.addCommand(pluginCommand);
program.addCommand(statusCommand);
program.addCommand(taskCommand);
