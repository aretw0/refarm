#!/usr/bin/env node
import { createTaskCommand } from "../../apps/refarm/dist/commands/task.js";

const taskCommand = createTaskCommand();
await taskCommand.parseAsync(process.argv.slice(2), { from: "user" });
