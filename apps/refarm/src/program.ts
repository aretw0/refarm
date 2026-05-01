import { Command } from "commander";
import { initCommand } from "./commands/init.js";

export const program = new Command();

program
  .name("refarm")
  .description("The Sovereign Farm CLI")
  .version("0.1.0");

program.addCommand(initCommand);
