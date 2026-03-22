#!/usr/bin/env node
import { execSync } from "node:child_process";
import readline from "node:readline";
import { groupChanges, deriveCommitMessage } from "./git-atomic-analysis.mjs";

/**
 * Refarm Git Atomic Automator v1.1 (Testable & Interactive)
 */

export function askQuestion(query, rlInterface) {
  return new Promise((resolve) => rlInterface.question(query, resolve));
}

export async function processCommits(activeGroups, options = {}) {
  const {
    execFn = (cmd) => execSync(cmd, { stdio: "inherit" }),
    readlineInterface,
    autoYes = false
  } = options;

  for (const group of activeGroups) {
    console.log(`\n📦 Group: ${group.title}`);
    group.items.forEach(c => console.log(`  [${c.status}] ${c.path}`));
    
    const paths = group.items.map(c => c.path).join(" ");
    let commitMsg = deriveCommitMessage(group.id, group.items);
    const fullCommand = `git add ${paths} && git commit -m "${commitMsg}"`;

    console.log(`\nProposed Command:\n  ${fullCommand}`);

    let answer = autoYes ? "y" : await askQuestion("\nApply this commit? [y/n/e/q]: ", readlineInterface);
    answer = answer.toLowerCase();

    if (answer === "q") {
      console.log("👋 Exiting...");
      break;
    }

    if (answer === "e") {
      const newMsg = await askQuestion("Enter new commit message: ", readlineInterface);
      commitMsg = newMsg || commitMsg;
      const updatedCommand = `git add ${paths} && git commit -m "${commitMsg}"`;
      console.log(`Executing: ${updatedCommand}`);
      execFn(updatedCommand);
    } else if (answer === "y") {
      console.log("Executing...");
      execFn(fullCommand);
    } else {
      console.log("Skipped.");
    }
  }
}

async function runCLI() {
  const changes = [];
  try {
    const statusOutput = execSync("git status --porcelain", { encoding: "utf-8" });
    statusOutput.split("\n").filter(line => line.trim() !== "").forEach(line => changes.push(line));
  } catch (err) {}

  if (changes.length === 0) {
    console.log("✅ Solo limpo! Nada para commitar.");
    return;
  }

  const groupsObj = groupChanges(changes);
  const activeGroups = Object.values(groupsObj).filter(g => g.items.length > 0);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("\n🚜 Refarm Git Atomic Automator\n");
  console.log("This tool will guide you through atomic commits based on technical intent.");
  
  try {
    await processCommits(activeGroups, { readlineInterface: rl });
  } finally {
    rl.close();
  }
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCLI().catch(console.error);
}
