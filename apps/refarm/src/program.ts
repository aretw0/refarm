import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { sowCommand } from "./commands/sow.js";

export const program = new Command();

program
  .name("refarm")
  .description("The Sovereign Farm CLI")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(sowCommand);
