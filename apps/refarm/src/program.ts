import { Command } from "commander";

export const program = new Command();

program
  .name("refarm")
  .description("The Sovereign Farm CLI")
  .version("0.1.0");
