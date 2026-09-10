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
 *   node scripts/check-diagrams.mjs --ci     // Verify each SVG matches its source — NO BROWSER
 *   node scripts/check-diagrams.mjs --stamp  // Record the source hash without re-rendering
 *
 * ## The gate asks whether the diagram is CURRENT, not whether the bytes match (ISS-046)
 *
 * It used to render every diagram and then run `git status`, so any difference in the RENDERING
 * ENVIRONMENT failed it. That is a bad proxy for the thing anyone cares about, and it was
 * measurably fragile: the browser was already pinned and identical to CI's, and it still drifted,
 * because `mermaid.config.json` names `IBM Plex Sans` and most machines do not have it — so the
 * text was laid out in whatever fontconfig fell back to, moving every coordinate by ~6%.
 *
 * Chasing that means pinning the font, then fontconfig, then the mermaid version, forever, and
 * every pin decays. So the gate stopped asking the environment question and started asking the
 * only one that is a defect:
 *
 *   IS THIS SVG DERIVED FROM THE CURRENT SOURCE?
 *
 * Each generated SVG carries a trailing comment with `sha256(mermaid source + config + renderer
 * version)`. `--ci` reads that, recomputes it, and compares — no browser, no fonts, instant, and
 * deterministic by construction rather than by pinning. A machine that renders in a different face
 * produces a different-looking but EQUALLY CURRENT diagram, and the gate correctly says nothing.
 *
 * What it no longer catches: a hand-edited SVG whose recorded hash still matches. That is not
 * drift, it is forgery, and byte comparison never caught it either — the forger would simply have
 * committed the bytes.
 */

import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { createRequire } from "module";
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
/** Record the hash on the SVGs already committed, WITHOUT re-rendering them.
 *
 * The migration path, and the reason this is not just a flag nobody uses: re-rendering to stamp
 * would replace every committed SVG with THIS machine's rendering — the exact environment-specific
 * bytes the change exists to stop caring about. Stamping leaves them as they are and starts the
 * gate from what is already in git. */
const STAMP_MODE = process.argv.includes("--stamp");
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

/** The marker line appended to every generated SVG. A trailing XML comment: valid after the root
 *  element, invisible to every renderer, and greppable. */
const SOURCE_MARKER_PREFIX = "<!-- refarm-diagram-source: sha256=";

/**
 * PURE-ish. What this SVG must be derived from, as one hash.
 *
 * THREE INPUTS, and each earns its place:
 *   - the `.mermaid` source, obviously;
 *   - `mermaid.config.json`, because a theme edit changes every diagram and must invalidate them;
 *   - the renderer's VERSION, because a mermaid upgrade can change the drawing without changing
 *     one byte of source — the one real thing byte-comparison caught that a source hash would
 *     otherwise miss.
 */
function expectedSourceHash(mermaidFile) {
  // Resolved through the ENTRY POINT and walked up, because the package does not export its own
  // package.json. Reading the version out of this repo's devDependencies instead would record a
  // RANGE, and a patch bump that changes the drawing would not invalidate a single diagram.
  let dir = path.dirname(createRequire(import.meta.url).resolve("@mermaid-js/mermaid-cli"));
  while (!fs.existsSync(path.join(dir, "package.json")) && path.dirname(dir) !== dir) {
    dir = path.dirname(dir);
  }
  const renderer = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  return createHash("sha256")
    .update(fs.readFileSync(mermaidFile))
    .update(fs.readFileSync(mermaidConfigFile))
    .update(`@mermaid-js/mermaid-cli@${renderer.version}`)
    .digest("hex");
}

/** The hash this SVG records, or `null` when it records none — a THIRD state, and the one every
 *  file is in before the first stamp. Reporting it as "stale" would be a lie about a file nobody
 *  has failed to update. */
function recordedSourceHash(svgFile) {
  if (!fs.existsSync(svgFile)) return null;
  const contents = fs.readFileSync(svgFile, "utf8");
  const index = contents.lastIndexOf(SOURCE_MARKER_PREFIX);
  if (index === -1) return null;
  return contents.slice(index + SOURCE_MARKER_PREFIX.length).trim().replace(/\s*-->\s*$/u, "");
}

/** Write (or replace) the marker on an SVG that already exists. */
function stampSourceHash(mermaidFile) {
  const svgFile = mermaidFile.replace(".mermaid", ".svg");
  if (!fs.existsSync(svgFile)) return false;
  const body = fs
    .readFileSync(svgFile, "utf8")
    .replace(new RegExp(`\\n?${SOURCE_MARKER_PREFIX}[^>]*-->\\s*$`, "u"), "")
    .trimEnd();
  fs.writeFileSync(svgFile, `${body}\n${SOURCE_MARKER_PREFIX}${expectedSourceHash(mermaidFile)} -->\n`);
  return true;
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

  // ── --ci: verify, and touch no browser ────────────────────────────────────────
  //
  // The whole point of the source hash. Reading a recorded string and recomputing it takes
  // milliseconds, so this can live in `after-edit` rather than only in a CI job, and it cannot
  // fail for a reason that is about the machine it runs on.
  if (CI_MODE) {
    const stale = [];
    const unstamped = [];
    for (const mermaidFile of mermaidFiles) {
      const relPath = path.relative(projectRoot, mermaidFile);
      const svgFile = mermaidFile.replace(".mermaid", ".svg");
      const recorded = recordedSourceHash(svgFile);
      if (recorded === null) unstamped.push(relPath);
      else if (recorded !== expectedSourceHash(mermaidFile)) stale.push(relPath);
    }

    // THREE STATES, not two: a diagram nobody has stamped yet has not FAILED to be updated, and
    // saying so is different from saying it is stale. Both block, and they block with different
    // sentences and different remedies.
    if (unstamped.length > 0) {
      console.error(`❌ ${unstamped.length} diagram(s) record no source hash — they predate this gate.\n`);
      for (const file of unstamped) console.error(`  ${file}`);
      console.error(`\nRecord it without re-rendering:\n  ${scriptCommand("diagrams:stamp")}\n`);
    }
    if (stale.length > 0) {
      console.error(`❌ ${stale.length} diagram(s) are STALE — the source changed and the SVG did not.\n`);
      for (const file of stale) console.error(`  ${file}`);
      console.error(`\nRe-render and commit:\n  ${scriptCommand("diagrams:fix")}\n`);
    }
    if (unstamped.length > 0 || stale.length > 0) {
      if (!STRICT_SVG_SYNC) {
        console.warn("⚠️  Diagram sync is advisory for this run (REFARM_DIAGRAM_SYNC_STRICT=0).");
        return;
      }
      process.exit(1);
    }
    console.log(`✅ All ${mermaidFiles.length} diagrams are derived from their current sources.`);
    return;
  }

  // ── --stamp: record the hash on what is already committed ─────────────────────
  if (STAMP_MODE) {
    let stamped = 0;
    for (const mermaidFile of mermaidFiles) {
      if (stampSourceHash(mermaidFile)) stamped += 1;
    }
    console.log(`✅ Recorded the source hash on ${stamped} SVG(s), without re-rendering any.`);
    return;
  }

  for (const mermaidFile of mermaidFiles) {
    const relPath = path.relative(projectRoot, mermaidFile);
    generateSvg(mermaidFile);
    stampSourceHash(mermaidFile);
    console.log(`✅ Regenerated ${relPath}`);
  }

  console.log();

  if (FIX_MODE) {

    console.log("✅ All diagrams regenerated (--fix). Commit the updated .svg files.");
  } else {
    console.log("✅ All diagrams regenerated. Please commit the .svg files.");
  }
}

validateDiagrams();
