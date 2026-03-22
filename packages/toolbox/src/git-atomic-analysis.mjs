#!/usr/bin/env node
import { execSync } from "node:child_process";
import { statSync, existsSync } from "node:fs";

/**
 * Refarm Git Atomic Architect v7.0 (Semantic Diff-Aware)
 *
 * Generates commit messages from the actual diff content of each file,
 * not from static pre-written strings. Groups are derived from intent,
 * not from historical session context.
 */

// ---------------------------------------------------------------------------
// Diff extraction
// ---------------------------------------------------------------------------

export function getFileDiff(path) {
  try {
    if (!existsSync(path)) return { raw: "", isNew: false, isDeleted: true };
    if (statSync(path).isDirectory()) return { raw: "", isNew: true, isDeleted: false };

    const statusLine = execSync(`git status --porcelain -- "${path}"`, { encoding: "utf-8" }).trim();
    const isNew = statusLine.startsWith("??") || statusLine.startsWith("A ");

    const raw = isNew
      ? execSync(`head -n 80 "${path}"`, { encoding: "utf-8" })
      : execSync(`git diff HEAD -- "${path}"`, { encoding: "utf-8" });

    return { raw, isNew, isDeleted: false };
  } catch {
    return { raw: "", isNew: false, isDeleted: false };
  }
}

// ---------------------------------------------------------------------------
// Semantic signal extraction from diff
// ---------------------------------------------------------------------------

export function extractSignals(path, diff) {
  const signals = new Set();
  const d = diff.raw || "";

  // TypeScript / type system
  if (d.includes("@ts-expect-error") || d.includes("@ts-ignore")) signals.add("ts-directive");
  if (d.includes('"paths"') || d.includes("paths:") || d.includes("homestead/") || d.includes("tractor/")) signals.add("tsconfig-paths");
  if (d.includes("homestead/ui") || d.includes("homestead/sdk")) signals.add("homestead-subpath");
  if (d.includes("getPluginApi") || d.includes("findByApi")) signals.add("plugin-api-rename");
  if (d.includes("noEmit") || d.includes("tsconfig")) signals.add("tsconfig");
  if (d.includes("moduleResolution") || d.includes("noExternal")) signals.add("module-resolution");

  // Testing
  if (d.includes("vi.mock") || d.includes("vi.fn") || d.includes("vitest")) signals.add("test-mock");
  if (d.includes("bench(") || d.includes("describe(") || d.includes("it(")) signals.add("test-suite");
  if (d.includes("@ts-expect-error") && path.includes(".test.")) signals.add("test-ts-cleanup");

  // Barn / plugin lifecycle
  if (d.includes("installPlugin") || d.includes("uninstallPlugin") || d.includes("listPlugins")) signals.add("barn-api");
  if (d.includes("integrity") || d.includes("sha256") || d.includes("SHA-256")) signals.add("barn-integrity");
  if (d.includes("PluginEntry") || d.includes("PluginCatalog")) signals.add("barn-types");

  // Security
  if (d.includes("overrides") || d.includes("flatted") || d.includes("audit")) signals.add("security");

  // Infrastructure
  if (d.includes("vite-tsconfig-paths") || d.includes("vitePlugin")) signals.add("vite-plugin");
  if (d.includes("astro") || d.includes("Astro")) signals.add("astro");

  // Path-based signals
  if (path.includes("barn/")) signals.add("barn");
  if (path.includes("tractor")) signals.add("tractor");
  if (path.includes("homestead")) signals.add("homestead");
  if (path.includes("toolbox")) signals.add("toolbox");
  if (path.includes("apps/")) signals.add("app");
  if (path.includes(".test.") || path.includes(".bench.")) signals.add("test-file");
  if (path.includes("tsconfig")) signals.add("tsconfig-file");
  if (path.endsWith(".md")) signals.add("docs");

  return signals;
}

// ---------------------------------------------------------------------------
// Dynamic message generation
// ---------------------------------------------------------------------------

export function deriveCommitMessage(groupId, items) {
  // Collect all signals across items in the group
  const allSignals = new Set(items.flatMap(i => [...(i.signals || [])]));
  const paths = items.map(i => i.path);

  switch (groupId) {
    case "typecheck_fix": {
      const parts = [];
      if (allSignals.has("homestead-subpath")) {
        const apps = [...new Set(paths.map(p => p.split("/")[1]))].join(", ");
        parts.push(`add homestead/ui and homestead/sdk subpath aliases in ${apps}`);
      }
      if (allSignals.has("plugin-api-rename")) parts.push("replace getPluginApi with plugins.findByApi in benchmarks");
      if (allSignals.has("test-ts-cleanup")) parts.push("remove unused @ts-expect-error directive");
      return `fix(types): ${parts.join("; ") || "resolve TypeScript module resolution errors"}`;
    }

    case "test_cleanup": {
      const parts = [];
      if (allSignals.has("plugin-api-rename")) parts.push("update bench calls to use plugins.findByApi");
      if (allSignals.has("test-ts-cleanup")) parts.push("drop unused @ts-expect-error in integration test");
      return `fix(test): ${parts.join("; ") || "clean up test type errors"}`;
    }

    case "barn_impl": {
      const parts = [];
      if (allSignals.has("barn-api")) parts.push("implement installPlugin, listPlugins, uninstallPlugin");
      if (allSignals.has("barn-integrity")) parts.push("add SHA-256 integrity verification");
      if (allSignals.has("barn-types")) parts.push("define PluginEntry interface");
      if (allSignals.has("test-suite")) parts.push("expand BDD integration tests");
      return `feat(barn): ${parts.join("; ") || "implement plugin lifecycle management"}`;
    }

    case "barn_specs": {
      return `docs(barn): evolve specifications for plugin lifecycle and access control`;
    }

    case "security": {
      return `fix(security): resolve npm audit vulnerabilities via dependency overrides`;
    }

    case "toolbox": {
      const parts = [];
      if (allSignals.has("toolbox")) parts.push("update git-atomic-analysis");
      return `feat(toolbox): ${parts.join("; ") || "improve developer tooling"}`;
    }

    case "docs": {
      const docPaths = paths.map(p => p.split("/").pop()).join(", ");
      return `docs: update ${docPaths}`;
    }

    case "pkg_updates": {
      // Try to be specific about what changed
      const parts = [];
      if (allSignals.has("tsconfig-paths") || allSignals.has("homestead-subpath")) {
        const apps = [...new Set(paths.filter(p => p.includes("apps/")).map(p => p.split("/")[1]))].join(", ");
        if (apps) parts.push(`fix subpath resolution in ${apps}`);
      }
      if (allSignals.has("tsconfig")) parts.push("align tsconfig settings");
      return `chore: ${parts.join("; ") || `update ${paths.map(p => p.split("/").slice(-2).join("/")).join(", ")}`}`;
    }

    default:
      return `chore: update ${paths.map(p => p.split("/").slice(-2).join("/")).join(", ")}`;
  }
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

export function groupChanges(changes, getDiffFn = getFileDiff) {
  const groups = {
    security:     { id: "security",     title: "🔒 Security: Audit & Overrides",         items: [] },
    typecheck_fix:{ id: "typecheck_fix",title: "🔧 Fix: TypeScript Module Resolution",    items: [] },
    test_cleanup: { id: "test_cleanup", title: "🧪 Fix: Test Type Errors",                items: [] },
    barn_impl:    { id: "barn_impl",    title: "🧺 Feat: Barn Implementation",            items: [] },
    barn_specs:   { id: "barn_specs",   title: "🧺 Docs: Barn Specifications",            items: [] },
    toolbox:      { id: "toolbox",      title: "🧰 Feat: Toolbox Improvements",           items: [] },
    docs:         { id: "docs",         title: "📚 Docs: Documentation Updates",          items: [] },
    pkg_updates:  { id: "pkg_updates",  title: "📦 Chore: Package & Config Updates",      items: [] },
    other:        { id: "other",        title: "📦 Misc: General Updates",                items: [] },
  };

  for (const change of changes) {
    const status = change.slice(0, 2).trim();
    const path = change.slice(3).trim();
    const diff = getDiffFn(path);
    const signals = extractSignals(path, diff);
    const item = { status, path, signals, diff };

    // Classification hierarchy — toolbox files are always self-referential, classify first
    if (path.includes("git-atomic") || path.includes("git-commit") || path.includes("toolbox/src/") || path.includes("toolbox/test/")) {
      groups.toolbox.items.push(item);
    } else if (signals.has("security")) {
      groups.security.items.push(item);
    } else if (signals.has("homestead-subpath") && signals.has("tsconfig-file")) {
      // tsconfig files with homestead subpath fixes → typecheck_fix
      groups.typecheck_fix.items.push(item);
    } else if (signals.has("plugin-api-rename") || (signals.has("test-ts-cleanup") && signals.has("test-file"))) {
      // test files with type-related fixes → test_cleanup
      groups.test_cleanup.items.push(item);
    } else if (signals.has("barn-api") || signals.has("barn-integrity") || signals.has("barn-types") || (signals.has("barn") && signals.has("test-file"))) {
      groups.barn_impl.items.push(item);
    } else if (path.includes("barn") && (path.endsWith(".md") || path.includes("docs/"))) {
      groups.barn_specs.items.push(item);
    } else if (path.endsWith(".md") || path.includes("docs/")) {
      groups.docs.items.push(item);
    } else if (path.includes("packages/") || path.includes("apps/") || path.includes("scripts/")) {
      groups.pkg_updates.items.push(item);
    } else {
      groups.other.items.push(item);
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

export function runCLI() {
  const isJsonMode = process.argv.includes("--json");
  const changes = [];

  try {
    const statusOutput = execSync("git status --porcelain", { encoding: "utf-8" });
    statusOutput.split("\n").filter(line => line.trim() !== "").forEach(line => changes.push(line));
  } catch {}

  if (changes.length === 0) {
    if (isJsonMode) console.log(JSON.stringify({ groups: [] }));
    else console.log("✅ Solo limpo! Nenhuma mudança pendente no git.");
    return;
  }

  const groups = groupChanges(changes);
  const activeGroups = Object.values(groups).filter(g => g.items.length > 0);

  if (isJsonMode) {
    const output = activeGroups.map(g => ({
      ...g,
      msg: deriveCommitMessage(g.id, g.items),
      items: g.items.map(i => ({ status: i.status, path: i.path, signals: [...i.signals] }))
    }));
    console.log(JSON.stringify({ groups: output }, null, 2));
    return;
  }

  console.log("\n🚜 # Refarm Git Atomic Architect v7.0 (Semantic Diff-Aware)\n");
  for (const group of activeGroups) {
    const msg = deriveCommitMessage(group.id, group.items);
    console.log(`## ${group.title}`);
    group.items.forEach(c => {
      const sig = c.signals.size > 0 ? `-> [${[...c.signals].join(", ")}]` : "";
      console.log(`  [${c.status}] ${c.path} ${sig}`);
    });
    const paths = group.items.map(c => `"${c.path}"`).join(" ");
    console.log(`\n  Suggested Command:`);
    console.log(`  git add ${paths} && git commit -m "${msg}"\n`);
  }
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCLI();
}
