#!/usr/bin/env node

/**
 * Validate and regenerate Mermaid diagrams
 *
 * Regenerates SVG files from .mermaid sources under docs/, specs/diagrams/, and examples/
 * (each example ships its own diagram set next to its code). Uses the branded, deterministic
 * mermaid.config.json so re-renders are byte-stable.
 *
 * Usage:
 *   node scripts/check-diagrams.mjs          // Regenerate all diagrams
 *   node scripts/check-diagrams.mjs --fix    // Same (explicit; what `diagrams:fix` runs)
 *   node scripts/check-diagrams.mjs --ci     // Regenerate + fail (or warn) if SVGs drifted
 */

import { execSync, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { packageScriptCommand } from "../packages/config/src/package-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "docs");
const specsDiagramsDir = path.join(projectRoot, "specs", "diagrams");
// Each example ships its OWN diagram set next to its code (examples/<name>/diagrams/*.mermaid),
// so the architecture picture travels with the example. The walk below finds them recursively.
const examplesDir = path.join(projectRoot, "examples");
const mermaidConfigFile = path.join(specsDiagramsDir, "mermaid.config.json");

const CI_MODE = process.argv.includes("--ci");
// --fix is an explicit alias for the default "regenerate all" behavior (kept so the
// `diagrams:fix` npm script is honest about what it does).
const FIX_MODE = process.argv.includes("--fix");
const STRICT_SVG_SYNC = process.env.REFARM_DIAGRAM_SYNC_STRICT !== "0";
// Dirs the recursive walk must never descend into (build output, deps, generated).
const SKIP_DIRS = new Set(["node_modules", "dist", "dist-web", "build", ".turbo", "coverage"]);

function scriptCommand(script) {
  return packageScriptCommand(script, { cwd: projectRoot }).display;
}

// Find all .mermaid files
function findMermaidFiles() {
  const mermaidFiles = [];
  const searchRoots = [docsDir, specsDiagramsDir, examplesDir];

  function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      // Skip dot-dirs (.astro/.turbo/.dgk) AND build/dep dirs (node_modules/dist/…) — the
      // latter matters now that we walk examples/, whose node_modules would otherwise be scanned.
      if (stat.isDirectory() && !file.startsWith(".") && !SKIP_DIRS.has(file)) {
        walkDir(fullPath);
      } else if (file.endsWith(".mermaid")) {
        mermaidFiles.push(fullPath);
      }
    }
  }

  for (const root of searchRoots) {
    if (fs.existsSync(root)) {
      walkDir(root);
    }
  }
  return mermaidFiles;
}

// Generate SVG from Mermaid source
function generateSvg(mermaidFile) {
  const svgFile = mermaidFile.replace(".mermaid", ".svg");

  try {
    const puppeteerConfig = path.join(projectRoot, "scripts", "puppeteer-no-sandbox.json");
    const mmdc = path.join(projectRoot, "node_modules", ".bin", "mmdc");
    execFileSync(mmdc, [
      "-i", mermaidFile,
      "-o", svgFile,
      "-c", mermaidConfigFile,
      "-p", puppeteerConfig,
    ], { stdio: "pipe" });
    return svgFile;
  } catch (error) {
    console.error(`❌ Failed to generate SVG for ${mermaidFile}`);
    console.error(error.message);
    process.exit(1);
  }
}

// Main validation logic
function validateDiagrams() {
  const mermaidFiles = findMermaidFiles();

  if (mermaidFiles.length === 0) {
    console.log("✅ No Mermaid diagrams found.");
    return;
  }

  console.log(`🔄 Found ${mermaidFiles.length} Mermaid diagram(s)\n`);

  for (const mermaidFile of mermaidFiles) {
    const relPath = path.relative(projectRoot, mermaidFile);
    generateSvg(mermaidFile);
    console.log(`✅ Regenerated ${relPath}`);
  }

  console.log();

  if (CI_MODE) {
    // On CI: Check if git detected any changes
    try {
      const gitStatus = execSync("git status --porcelain", {
        cwd: projectRoot,
        encoding: "utf-8",
      });

      const changedSvgFiles = gitStatus
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.includes(".svg"));

      if (changedSvgFiles.length > 0) {
        console.error(
          "❌ SVG files are out of sync with their Mermaid sources.\n"
        );
        console.error("Changed SVG files:");
        for (const line of changedSvgFiles) {
          console.error(`  ${line}`);
        }
        console.error("");
        console.error("To fix, run locally:");
        console.error(`  ${scriptCommand("diagrams:fix")}\n`);
        console.error("Then commit the regenerated .svg files.");
        if (!STRICT_SVG_SYNC) {
          console.warn("⚠️  SVG sync drift is advisory for this run (REFARM_DIAGRAM_SYNC_STRICT=0).");
          return;
        }
        process.exit(1);
      } else {
        console.log("✅ All diagrams are in sync.");
      }
    } catch (error) {
      console.error("⚠️  Could not check git status (not in a git repo?)");
      // Don't fail on CI verification if not in git repo
    }
  } else if (FIX_MODE) {
    console.log("✅ All diagrams regenerated (--fix). Commit the updated .svg files.");
  } else {
    console.log("✅ All diagrams regenerated. Please commit the .svg files.");
  }
}

validateDiagrams();
