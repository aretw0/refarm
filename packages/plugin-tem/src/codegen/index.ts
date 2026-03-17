#!/usr/bin/env node
/**
 * tem-codegen CLI
 *
 * Converts a WeightsBundle JSON file to a TypeScript source file
 * with embedded Float32Array-compatible weight literals.
 *
 * Usage:
 *   npx tem-codegen --weights ./checkpoint-bundle.json --out ./src/core/generated/weights.ts
 *
 * The input JSON must conform to the WeightsBundle interface from core/weights.ts.
 * Generate one from a torch_tem checkpoint using the Python export script:
 *   python tools/export_tem_bundle.py --checkpoint model.pt --out bundle.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { bundleToTypeScript, validateBundleShapes } from "./weights-to-ts";
import type { WeightsBundle } from "../core/weights";

function parseArgs(argv: string[]): { weights: string; out: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }

  if (!args["weights"]) {
    console.error("Usage: tem-codegen --weights <bundle.json> --out <weights.ts>");
    process.exit(1);
  }
  if (!args["out"]) {
    console.error("Usage: tem-codegen --weights <bundle.json> --out <weights.ts>");
    process.exit(1);
  }

  return { weights: args["weights"], out: args["out"] };
}

function main() {
  const { weights: weightsPath, out: outPath } = parseArgs(process.argv.slice(2));

  const bundleRaw = readFileSync(resolve(weightsPath), "utf-8");
  const bundle = JSON.parse(bundleRaw) as WeightsBundle;

  try {
    validateBundleShapes(bundle);
  } catch (err) {
    console.error(`Shape validation failed: ${(err as Error).message}`);
    process.exit(1);
  }

  const src = bundleToTypeScript(bundle);

  const outDir = dirname(resolve(outPath));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outPath), src, "utf-8");

  console.log(`✓ Wrote ${outPath} (${src.length} bytes)`);
  console.log(`  Config: nG=${JSON.stringify(bundle.config.nG)} nX=${bundle.config.nX} nActions=${bundle.config.nActions}`);
}

main();
