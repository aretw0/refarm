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

  // 1. Path-based Breadcrumbs (Scope)
  const pathParts = path.split("/");
  if (pathParts.includes("packages") || pathParts.includes("apps") || pathParts.includes("validations")) {
    const scope = pathParts[pathParts.indexOf("packages") + 1] || 
                  pathParts[pathParts.indexOf("apps") + 1] ||
                  pathParts[pathParts.indexOf("validations") + 1];
    if (scope) signals.add(`scope:${scope}`);
  }

  // 2. Package.json Dependency Extraction
  if (path.endsWith("package.json")) {
    const depRegex = /^[+-]\s+"(@?[\w\.-]+(?:\/[\w\.-]+)?)":\s+"([^"]+)"/gm;
    const blacklist = new Set(["name", "version", "description", "main", "types", "module", "exports", "scripts", "dependencies", "devDependencies", "peerDependencies", "private", "engines", "packageManager", "overrides", "bin", "files", "type", "author", "license", "homepage", "repository", "bugs", "keywords", "publishConfig"]);
    let match;
    while ((match = depRegex.exec(d)) !== null) {
      const depName = match[1];
      const val = match[2];
      const isDepLike = /^(?:\^|~|\*|workspace:|npm:|http|git|\d+\.)/.test(val);
      if (!blacklist.has(depName) && isDepLike) {
        signals.add(`dep:${depName.split("/").pop()}`);
      }
    }
  }

  // 3. TypeScript / Code Semantic Extraction
  if (d.includes("@ts-expect-error") || d.includes("@ts-ignore")) signals.add("ts-directive");
  if (d.includes('"paths"') || d.includes("paths:") || d.includes("homestead/") || d.includes("tractor/")) signals.add("tsconfig-paths");
  if (d.includes("homestead/ui") || d.includes("homestead/sdk")) signals.add("homestead-subpath");
  
  const exportRegex = /^\+\s*(?:export\s+)?(?:const|function|class|type|interface|enum)\s+(\w+)/gm;
  let expMatch;
  while ((expMatch = exportRegex.exec(d)) !== null) {
    if (!["const", "function", "class", "type", "interface", "enum"].includes(expMatch[1])) {
      signals.add(`export:${expMatch[1]}`);
    }
  }

  // Legacy signals preserved for compatibility / tests
  if (d.includes("getPluginApi") || d.includes("findByApi")) signals.add("plugin-api-rename");
  if (d.includes("vi.mock") || d.includes("vi.fn") || d.includes("vitest")) signals.add("test-mock");
  if (d.includes("bench(") || d.includes("describe(") || d.includes("it(")) signals.add("test-suite");
  if (d.includes("overrides") || d.includes("flatted") || d.includes("audit")) signals.add("security");

  // Barn / plugin lifecycle
  if (d.includes("installPlugin") || d.includes("uninstallPlugin") || d.includes("listPlugins")) signals.add("barn-api");
  if (d.includes("integrity") || d.includes("sha256") || d.includes("SHA-256")) signals.add("barn-integrity");
  if (d.includes("PluginEntry") || d.includes("PluginCatalog")) signals.add("barn-types");

  // Path-based flags
  if (path.includes(".test.") || path.includes(".bench.")) signals.add("test-file");
  if (path.endsWith(".md")) signals.add("docs");

  return signals;
}

// ---------------------------------------------------------------------------
// Dynamic message generation
// ---------------------------------------------------------------------------

export function deriveCommitMessage(groupId, items) {
  const allSignals = new Set(items.flatMap(i => [...(i.signals || [])]));
  const scopes = [...allSignals].filter(s => s.startsWith("scope:")).map(s => s.replace("scope:", ""));
  const primaryScope = scopes.length === 1 ? scopes[0] : "";
  const scopePrefix = primaryScope ? `(${primaryScope})` : "";

  const getDeps = () => [...allSignals].filter(s => s.startsWith("dep:")).map(s => s.replace("dep:", ""));
  const getExports = () => [...allSignals].filter(s => s.startsWith("export:")).map(s => s.replace("export:", ""));

  switch (groupId) {
    case "security": {
      return `fix(security): resolve npm audit vulnerabilities via dependency overrides`;
    }

    case "typecheck_fix": {
      const parts = [];
      if (allSignals.has("homestead-subpath")) {
        parts.push("add homestead/ui and homestead/sdk subpath aliases");
      }
      return `fix(types): ${parts.join("; ") || "resolve TypeScript module resolution errors"}`;
    }

    case "test_cleanup": {
      const exports = getExports();
      const parts = [];
      if (allSignals.has("plugin-api-rename")) parts.push("update bench calls to use plugins.findByApi");
      if (exports.length > 0) parts.push(`update tests for ${exports.join(", ")}`);
      
      const detail = parts.join("; ");
      return `fix(test): ${detail || "clean up test type errors"}`;
    }

    case "barn_impl": {
      const exports = getExports();
      let detail = exports.length > 0 ? `implement ${exports.join(", ")}` : "";
      if (!detail && allSignals.has("barn-api")) detail = "implement installPlugin, listPlugins, uninstallPlugin";
      
      return `feat(barn): ${detail || "implement plugin lifecycle management"}`;
    }

    case "barn_specs": {
      return `docs(barn): evolve specifications for plugin lifecycle and access control`;
    }

    case "toolbox": {
      return `feat(toolbox): improve developer tooling`;
    }

    case "docs": {
      const docPaths = items.map(i => i.path.split("/").pop()).join(", ");
      return `docs${scopePrefix}: update ${docPaths}`;
    }

    case "pkg_updates": {
      const deps = getDeps();
      const scopePart = primaryScope ? `(${primaryScope})` : "";
      if (deps.length > 0) {
        return `chore${scopePart}: update dependencies (${deps.join(", ")})`;
      }
      return `chore${scopePart}: update configuration files`;
    }

    default: {
      if (groupId.startsWith("scope:")) {
        const scope = groupId.replace("scope:", "");
        const deps = getDeps();
        const exports = getExports();
        if (deps.length > 0) return `chore(${scope}): update ${deps.join(", ")}`;
        if (exports.length > 0) return `feat(${scope}): implement ${exports.join(", ")}`;
        const files = items.map(i => i.path.split("/").pop()).filter(Boolean);
        return `chore(${scope}): update ${files.join(", ") || "package"}`;
      }
      const deps = getDeps();
      if (deps.length > 0) return `chore${scopePrefix}: update ${deps.join(", ")}`;
      const files = items.map(i => i.path.split("/").pop()).filter(Boolean);
      return `chore${scopePrefix}: update ${files.join(", ") || "various files"}`;
    }
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

  const dynamicGroups = new Map();

  for (const change of changes) {
    const status = change.slice(0, 2).trim();
    const path = change.slice(3).trim();
    const diff = getDiffFn(path);
    const signals = extractSignals(path, diff);
    const item = { status, path, signals, diff };

    const scopes = [...signals].filter(s => s.startsWith("scope:")).map(s => s.replace("scope:", ""));
    const primaryScope = scopes[0];

    // Priority Classification
    if (path.includes("git-atomic") || path.includes("git-commit") || path.includes("toolbox/src/") || path.includes("toolbox/test/")) {
      groups.toolbox.items.push(item);
    } else if (signals.has("security")) {
      groups.security.items.push(item);
    } else if (signals.has("homestead-subpath") && path.includes("tsconfig")) {
      groups.typecheck_fix.items.push(item);
    } else if (signals.has("barn-api") || signals.has("barn-integrity") || (signals.has("scope:barn") && signals.has("test-file"))) {
      groups.barn_impl.items.push(item);
    } else if (path.includes("barn") && (path.endsWith(".md") || path.includes("docs/"))) {
      groups.barn_specs.items.push(item);
    } else if (signals.has("plugin-api-rename") || signals.has("test-file")) {
      groups.test_cleanup.items.push(item);
    } else if (path.endsWith(".md") || path.includes("docs/")) {
      groups.docs.items.push(item);
    } else if (primaryScope) {
      // If it has a clear scope, create or use a dynamic group for that scope
      const gid = `scope:${primaryScope}`;
      if (!dynamicGroups.has(gid)) {
        dynamicGroups.set(gid, { id: gid, title: `📦 Package: ${primaryScope}`, items: [] });
      }
      dynamicGroups.get(gid).items.push(item);
    } else if (path.includes("package.json") || path.includes("tsconfig") || path.includes("turbo.json")) {
      groups.pkg_updates.items.push(item);
    } else {
      groups.other.items.push(item);
    }
  }

  const result = { ...groups, ...Object.fromEntries(dynamicGroups) };
  // Remove empty groups to avoid clutter, except if they are standard ones that might be needed
  return result;
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
