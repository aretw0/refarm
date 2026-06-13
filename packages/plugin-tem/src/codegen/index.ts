#!/usr/bin/env node
/**
 * tem-codegen CLI
 *
 * Converts a WeightsBundle JSON file to a TypeScript source file
 * with embedded Float32Array-compatible weight literals.
 *
 * Usage:
 *   <package-manager> exec tem-codegen --weights ./checkpoint-bundle.json --out ./src/core/generated/weights.ts
 *
 * The input JSON must conform to the WeightsBundle interface from core/weights.ts.
 * Generate one from a torch_tem checkpoint using the Python export script:
 *   python tools/export_tem_bundle.py --checkpoint model.pt --out bundle.json
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { WeightsBundle } from "../core/weights";
import { bundleToTypeScript, validateBundleShapes } from "./weights-to-ts";

function parseArgs(argv: string[]): { weights: string; out: string } | null {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i]!.startsWith("--")) {
      args[argv[i]!.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }

  if (!args["weights"]) {
    console.error("Usage: tem-codegen --weights <bundle.json> --out <weights.ts>");
    process.exitCode = 1;
    return null;
  }
  if (!args["out"]) {
    console.error("Usage: tem-codegen --weights <bundle.json> --out <weights.ts>");
    process.exitCode = 1;
    return null;
  }

  return { weights: args["weights"], out: args["out"] };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) return;
  const { weights: weightsPath, out: outPath } = parsed;

  const bundleRaw = readFileSync(resolve(weightsPath), "utf-8");
  const bundle = JSON.parse(bundleRaw) as WeightsBundle;

  try {
    validateBundleShapes(bundle);
  } catch (err) {
    console.error(`Shape validation failed: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const src = bundleToTypeScript(bundle);

  const outDir = dirname(resolve(outPath));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outPath), src, "utf-8");

  console.log(`✓ Wrote ${outPath} (${src.length} bytes)`);
  console.log(`  Config: nG=${JSON.stringify(bundle.config.nG)} nX=${bundle.config.nX} nActions=${bundle.config.nActions}`);
}

main();
