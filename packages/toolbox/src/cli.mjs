#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const command = process.argv[2];

async function run() {
    try {
        switch (command) {
            case 'start':
                await import('./start.mjs');
                break;
            case 'verify':
                await import('./verify.mjs');
                break;
            case 'finish':
                await import('./finish.mjs');
                break;
            case 'rebrand':
                await import('./rebrand.mjs');
                break;
            case 'sync-labels':
                await import('./sync-labels.mjs');
                break;
            case 'reso':
                const { switchResolution } = await import('./reso.mjs');
                const mode = process.argv[3];
                const debug = process.argv.includes('--debug');
                if (mode !== 'src' && mode !== 'dist' && mode !== 'status' && mode !== 'sync-tsconfig') {
                    console.error("Usage: refarm-task reso <src|dist|status|sync-tsconfig> [--debug]");
                    process.exit(1);
                }
                await switchResolution(mode, { debug });
                break;
            default:
                console.log("🚜 Refarm Developer Toolbox");
                console.log("Usage: refarm-task <command>");
                console.log("\nCommands:");
                console.log("  start       - Begin a new feature or hotfix");
                console.log("  verify      - Run the quality gates (lint, test, build)");
                console.log("  finish      - Complete a task, verify, and open a PR");
                console.log("  rebrand     - Emergency global refactoring protocol");
                console.log("  sync-labels - Create/Update GitHub phase labels");
                console.log("  reso        - Toggle between Local (src) and Published (dist) resolution");
                process.exit(1);
        }
    } catch (err) {
        console.error(`❌ Toolbox execution failed for '${command}':`, err);
        process.exit(1);
    }
}

run();
