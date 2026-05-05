#!/usr/bin/env node
import { execSync } from "node:child_process";
import readline from "node:readline";
import {
  groupChanges,
  deriveCommitMessage,
  assessCommitImportance,
} from "./git-atomic-analysis.mjs";

/**
 * Refarm Git Atomic Automator v1.1 (Testable & Interactive)
 */

export function askQuestion(query, rlInterface) {
  return new Promise((resolve) => rlInterface.question(query, resolve));
}

export function buildCommitCommand(paths, commitMsg) {
  const quotedPaths = paths.map((path) => JSON.stringify(path)).join(" ");
  return `git add ${quotedPaths} && git commit -m ${JSON.stringify(commitMsg)}`;
}

export function isGenericCommitMessage(message) {
  if (!message || typeof message !== "string") return true;
  const trimmed = message.trim();
  if (!trimmed) return true;

  return (
    /\bvarious files\b/i.test(trimmed) ||
    /\bupdate implementation\b/i.test(trimmed) ||
    /^(?:chore|docs|refactor|fix|feat)(?:\([^)]+\))?:\s*update\b/i.test(trimmed)
  );
}

function isEnabled(value) {
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function parseCommitAutoOptions(argv = process.argv, env = process.env) {
  return {
    strictImportant:
      argv.includes("--strict-important") || isEnabled(env.GIT_COMMIT_AUTO_STRICT),
  };
}

export async function resolveCommitMessage(group, suggestedMessage, options = {}) {
  const {
    readlineInterface,
    autoYes = false,
    strictImportant = false,
    forcePrompt = false,
  } = options;
  const importance = assessCommitImportance(group.id, group.items);
  const lowConfidenceGroup = group.id === "other" || group.id === "infra_general";

  const requiresManualMessage =
    importance.important || (strictImportant && lowConfidenceGroup);

  if (!requiresManualMessage && !forcePrompt) return suggestedMessage;

  if (importance.important) {
    console.log("\n⚠️ Important commit group detected");
    console.log(`  Reasons: ${importance.reasons.join(", ")}`);
  } else if (strictImportant && lowConfidenceGroup) {
    console.log("\n⚠️ Strict mode: low-confidence group requires explicit message");
    console.log("  Reason: generic misc/infra bucket can hide unrelated changes");
  }
  console.log(`  Suggested baseline: ${suggestedMessage}`);

  if (autoYes) {
    console.log("  autoYes=true -> using suggested baseline message.");
    return suggestedMessage;
  }

  // Keep edge-case semantics human-owned: force explicit confirmation here.
  while (true) {
    const prompt = strictImportant
      ? "Enter final commit message ([q]=quit): "
      : "Enter final commit message ([s]=use suggested, [q]=quit): ";
    const answer = (
      await askQuestion(prompt, readlineInterface)
    ).trim();

    if (answer.toLowerCase() === "q") {
      return null;
    }
    if (!strictImportant && answer.toLowerCase() === "s") {
      return suggestedMessage;
    }
    if (answer.length > 0) {
      if (strictImportant && isGenericCommitMessage(answer)) {
        console.log(
          "Message too generic for strict mode. Be specific about what changed.",
        );
        continue;
      }
      return answer;
    }

    console.log("Commit message cannot be empty for important groups.");
  }
}

export async function processCommits(activeGroups, options = {}) {
  const {
    execFn = (cmd) => execSync(cmd, { stdio: "inherit" }),
    readlineInterface,
    autoYes = false,
    strictImportant = false,
  } = options;

  for (const group of activeGroups) {
    console.log(`\n📦 Group: ${group.title}`);
    group.items.forEach(c => console.log(`  [${c.status}] ${c.path}`));

    const paths = group.items.map(c => c.path);
    const suggestedMsg = deriveCommitMessage(group.id, group.items);
    let commitMsg = await resolveCommitMessage(group, suggestedMsg, {
      readlineInterface,
      autoYes,
      strictImportant,
    });
    if (commitMsg === null) {
      console.log("👋 Exiting...");
      break;
    }
    const fullCommand = buildCommitCommand(paths, commitMsg);

    console.log(`\nProposed Command:\n  ${fullCommand}`);

    let answer = autoYes ? "y" : await askQuestion("\nApply this commit? [y/n/e/q]: ", readlineInterface);
    answer = answer.toLowerCase();

    if (answer === "q") {
      console.log("👋 Exiting...");
      break;
    }

    if (answer === "e") {
      const newMsg = await askQuestion("Enter new commit message: ", readlineInterface);
      if (strictImportant && isGenericCommitMessage(newMsg)) {
        console.log("Skipped. Strict mode rejected generic edited message.");
        continue;
      }
      commitMsg = newMsg || commitMsg;
      const updatedCommand = buildCommitCommand(paths, commitMsg);
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
  const parsedOptions = parseCommitAutoOptions(process.argv, process.env);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("\n🚜 Refarm Git Atomic Automator\n");
  console.log("This tool will guide you through atomic commits based on technical intent.");
  if (parsedOptions.strictImportant) {
    console.log("Strict important mode: ON (explicit, non-generic messages required).");
  }

  try {
    await processCommits(activeGroups, {
      readlineInterface: rl,
      strictImportant: parsedOptions.strictImportant,
    });
  } finally {
    rl.close();
  }
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCLI().catch(console.error);
}
