import { Command } from "commander";
import { actionsCommand } from "./commands/actions.js";
import { resolveRefarmVersion } from "./commands/runtime-metadata.js";
import { askCommand } from "./commands/ask.js";
import { chatCommand } from "./commands/chat.js";
import { sessionCommand, runSessionLaunchFlow } from "./commands/session.js";
import { sessionsCommand } from "./commands/sessions.js";
import { keysCommand } from "./commands/keys.js";
import { deployCommand } from "./commands/deploy.js";
import { doctorCommand } from "./commands/doctor.js";
import { guideCommand } from "./commands/guide.js";
import { headlessCommand } from "./commands/headless.js";
import { healthCommand } from "./commands/health.js";
import { initCommand } from "./commands/init.js";
import { migrateCommand } from "./commands/migrate.js";
import { openUrlCommand } from "./commands/open-url.js";
import { pluginCommand } from "./commands/plugin.js";
import { sowCommand } from "./commands/sow.js";
import { provisionCommand } from "./commands/provision.js";
import { statusCommand } from "./commands/status.js";
import { taskCommand } from "./commands/task.js";
import { tasksCommand } from "./commands/tasks.js";
import { tuiCommand } from "./commands/tui.js";
import { telemetryCommand } from "./commands/telemetry.js";
import { treeCommand } from "./commands/tree.js";
import { webCommand } from "./commands/web.js";

export const program = new Command();

program
	.name("refarm")
	.description("Farm CLI")
	.version(resolveRefarmVersion())
	.action(async () => {
		await runSessionLaunchFlow();
	});

program.addCommand(initCommand);
program.addCommand(sowCommand);
program.addCommand(provisionCommand);
program.addCommand(guideCommand);
program.addCommand(healthCommand);
program.addCommand(webCommand);
program.addCommand(tuiCommand);
program.addCommand(headlessCommand);
program.addCommand(migrateCommand);
program.addCommand(deployCommand);
program.addCommand(doctorCommand);
program.addCommand(pluginCommand);
program.addCommand(openUrlCommand);
program.addCommand(actionsCommand);
program.addCommand(statusCommand);
program.addCommand(taskCommand);
program.addCommand(sessionCommand);
program.addCommand(chatCommand);
program.addCommand(askCommand);
program.addCommand(sessionsCommand);
program.addCommand(tasksCommand);
program.addCommand(keysCommand);
program.addCommand(telemetryCommand);
program.addCommand(treeCommand);
