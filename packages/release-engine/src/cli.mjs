#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { buildReleasePlan, runReleaseGates, formatPlan, summarizePlan } from "./index.mjs";

const args = process.argv.slice(2);

function usage() {
  console.log(`release-engine plan [options] [pkg1 pkg2 ...]\n` +
    `release-engine check [options] [pkg1 pkg2 ...]\n` +
    `release-engine gates [options]\n\n` +
    `Options:\n` +
    `  --json             Output machine-readable JSON\n` +
    `  --dry-run          Skip command execution (for gate commands)\n` +
    `  --cwd <dir>        Workspace root for plan resolution\n` +
    `  --policy <file>    Policy filename; when omitted uses embedded .refarm/config.json releasePolicy with fallback to release-policy.json/neutral defaults\n` +
    `  --only-required    Run only required release gates\n` +
    `  --check-gates      Also run gate validation after plan\n`);
  process.exit(1);
}

function collectCommandValue(token, tokens, index) {
  const next = tokens[index + 1];
  if (!next || next.startsWith("--")) {
    console.error(`Missing value for ${token}`);
    process.exit(1);
  }
  return next;
}

function parseArgsRobust(rawArgs) {
  const parsed = {
    command: null,
    cwd: process.cwd(),
    policyPath: "release-policy.json",
    dryRun: false,
    json: false,
    checkGates: false,
    onlyRequired: false,
    packages: [],
  };

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--") {
      continue;
    }

    if (arg === "plan" || arg === "check" || arg === "gates") {
      parsed.command = arg;
      continue;
    }

    switch (arg) {
      case "--json":
        parsed.json = true;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--only-required":
        parsed.onlyRequired = true;
        break;
      case "--check-gates":
        parsed.checkGates = true;
        break;
      case "--policy":
        parsed.policyPath = collectCommandValue(arg, rawArgs, i);
        i += 1;
        break;
      case "--cwd":
        parsed.cwd = path.resolve(collectCommandValue(arg, rawArgs, i));
        i += 1;
        break;
      default:
        if (arg.startsWith("--")) {
          console.error(`Unknown argument: ${arg}`);
          usage();
        }
        parsed.packages.push(arg);
        break;
    }
  }

  return parsed;
}

async function main() {
  const parsed = parseArgsRobust(args);
  if (!parsed.command) usage();

  const basePlan = buildReleasePlan({
    cwd: parsed.cwd,
    policyPath: parsed.policyPath,
    packageNames: parsed.packages,
    dryRun: parsed.dryRun,
  });

  if (parsed.command === "gates") {
    if (!basePlan.ok) {
      if (parsed.json) {
        console.log(JSON.stringify({
          ...summarizePlan(basePlan),
          command: "gates",
          gateResult: {
            ok: false,
            reason: "Plan blocked",
            blockers: basePlan.blockers,
          },
        }, null, 2));
      } else {
        console.error(formatPlan(basePlan));
      }
      process.exitCode = 1;
      return;
    }

    const gateResult = runReleaseGates(basePlan, {
      cwd: parsed.cwd,
      dryRun: parsed.dryRun,
      onlyRequired: parsed.onlyRequired,
    });

    const summary = {
      ...summarizePlan(basePlan),
      gateResult,
      command: "gates",
    };

    if (parsed.json) {
      console.log(JSON.stringify(summary, null, 2));
      process.exit(gateResult.ok ? 0 : 1);
    }

    if (!gateResult.ok) {
      console.error(`Gate failed in phase ${gateResult.phase}`);
      process.exitCode = 1;
    }
    console.log(gateResult.ok ? "Release gates passed." : "Release gates blocked.");
    console.log(formatPlan(basePlan));

    return;
  }

  if (parsed.command === "check") {
    if (!basePlan.ok) {
      if (parsed.json) {
        console.log(JSON.stringify({
          ...summarizePlan(basePlan),
          gateResult: {
            ok: false,
            reason: "Plan blocked",
            blockers: basePlan.blockers,
          },
          command: "check",
          commandNote: "Plan is blocked before gate execution.",
        }, null, 2));
      } else {
        console.error(formatPlan(basePlan));
      }
      process.exitCode = 1;
      return;
    }

    const gateResult = runReleaseGates(basePlan, {
      cwd: parsed.cwd,
      dryRun: true,
      onlyRequired: parsed.onlyRequired,
    });

    const payload = {
      ...summarizePlan(basePlan),
      gateResult,
      command: "check",
      commandNote: "Dry-run gate check complete.",
    };

    if (parsed.json) {
      console.log(JSON.stringify(payload, null, 2));
      process.exit(gateResult.ok ? 0 : 1);
    }

    console.log(formatPlan(basePlan));
    if (!gateResult.ok) process.exitCode = 1;
    return;
  }

  if (parsed.command === "plan") {
    const summary = summarizePlan(basePlan);

    if (parsed.json) {
      const payload = {
        ...summary,
        gates: basePlan.gates,
        blockers: basePlan.blockers,
        publishIntents: basePlan.publishIntents,
        command: "plan",
      };

      if (parsed.checkGates) {
        payload.gateResult = runReleaseGates(basePlan, {
          cwd: parsed.cwd,
          dryRun: parsed.dryRun,
          onlyRequired: parsed.onlyRequired,
        });
      }

      console.log(JSON.stringify(payload, null, 2));
      process.exit(basePlan.ok ? 0 : 1);
    }

    console.log(formatPlan(basePlan));
    if (!basePlan.ok) {
      process.exitCode = 1;
    }

    if (parsed.checkGates) {
      const gateResult = runReleaseGates(basePlan, {
        cwd: parsed.cwd,
        dryRun: parsed.dryRun,
        onlyRequired: parsed.onlyRequired,
      });
      console.log("\nGate check:", gateResult.ok ? "passed" : "failed");
      if (!gateResult.ok) process.exitCode = 1;
    }

    return;
  }
}

main().catch((error) => {
  console.error("release-engine error:", error?.message || error);
  process.exit(1);
});
