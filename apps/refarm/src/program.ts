import { Command } from "commander";
import { askCommand } from "./commands/ask.js";
import { deployCommand } from "./commands/deploy.js";
import { doctorCommand } from "./commands/doctor.js";
import { guideCommand } from "./commands/guide.js";
import { headlessCommand } from "./commands/headless.js";
import { healthCommand } from "./commands/health.js";
import { initCommand } from "./commands/init.js";
import { migrateCommand } from "./commands/migrate.js";
import { pluginCommand } from "./commands/plugin.js";
import { sowCommand } from "./commands/sow.js";
import { statusCommand } from "./commands/status.js";
import { taskCommand } from "./commands/task.js";
import { webCommand } from "./commands/web.js";

export const program = new Command();

program.name("refarm").description("The Sovereign Farm CLI").version("0.1.0");

program.addCommand(initCommand);
program.addCommand(sowCommand);
program.addCommand(guideCommand);
program.addCommand(healthCommand);
program.addCommand(webCommand);
program.addCommand(headlessCommand);
program.addCommand(migrateCommand);
program.addCommand(deployCommand);
program.addCommand(doctorCommand);
program.addCommand(pluginCommand);
program.addCommand(statusCommand);
program.addCommand(taskCommand);
program.addCommand(askCommand);
