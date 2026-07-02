#!/usr/bin/env node

import { runImportsCommand } from "../packages/toolbox/src/imports-command.mjs";

process.exitCode = runImportsCommand(process.argv.slice(2));
