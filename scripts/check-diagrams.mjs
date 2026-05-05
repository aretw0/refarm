#!/usr/bin/env node

/**
 * Validate and regenerate Mermaid diagrams
 *
 * Regenerates SVG files from .mermaid sources.
 * On CI: Run with --ci flag to verify no uncommitted changes after regeneration.
 *
 * Usage:
 *   node scripts/check-diagrams.mjs          // Regenerate all diagrams
 *   node scripts/check-diagrams.mjs --ci     // Regenerate and verify no changes needed
 */

import { execSync, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "docs");
const specsDiagramsDir = path.join(projectRoot, "specs", "diagrams");
const mermaidConfigFile = path.join(specsDiagramsDir, "mermaid.config.json");

const CI_MODE = process.argv.includes("--ci");

// Find all .mermaid files
function findMermaidFiles() {
  const mermaidFiles = [];
  const searchRoots = [docsDir, specsDiagramsDir];

  function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory() && !file.startsWith(".")) {
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
        console.error("  npm run diagrams:fix\n");
        console.error("Then commit the regenerated .svg files.");
        process.exit(1);
      } else {
        console.log("✅ All diagrams are in sync.");
      }
    } catch (error) {
      console.error("⚠️  Could not check git status (not in a git repo?)");
      // Don't fail on CI verification if not in git repo
    }
  } else {
    console.log(
      "✅ All diagrams regenerated. Please commit the .svg files."
    );
  }
}

validateDiagrams();

