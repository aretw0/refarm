#!/usr/bin/env node
import { execSync } from "node:child_process";
import { statSync, existsSync, readFileSync } from "node:fs";

/**
 * Refarm Git Atomic Architect v8.1 (Rust & Release Aware)
 *
 * Generates commit messages from the actual diff content of each file.
 * Now with full support for Rust crates, Changesets, and Templates.
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
      ? readFileSync(path, { encoding: "utf-8" }).split("\n").slice(0, 80).join("\n")
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
  const pathParts = path.split(/[/\\]/);
  const pIdx = pathParts.indexOf("packages");
  const aIdx = pathParts.indexOf("apps");
  const vIdx = pathParts.indexOf("validations");
  const tIdx = pathParts.indexOf("templates");
  const scope = (pIdx !== -1 ? pathParts[pIdx + 1] : null) || 
                (aIdx !== -1 ? pathParts[aIdx + 1] : null) ||
                (vIdx !== -1 ? pathParts[vIdx + 1] : null) ||
                (tIdx !== -1 ? pathParts[tIdx + 1] : null);
  if (scope) signals.add(`scope:${scope}`);

  // Markdown files are grouped semantically as docs, but their prose should not
  // leak code-like signals such as test mocks or subpath references.
  if (path.endsWith(".md")) {
    signals.add("docs");
    return signals;
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
  
  const exportRegex = /^\+\s*export\s+(?:async\s+)?(?:const|function|class|type|interface|enum)\s+(\w+)/gm;
  let expMatch;
  while ((expMatch = exportRegex.exec(d)) !== null) {
    signals.add(`export:${expMatch[1]}`);
  }

  // Legacy signals preserved for compatibility / tests
  if (d.includes("getPluginApi") || d.includes("findByApi")) signals.add("plugin-api-rename");
  if (/\bvi\.(?:mock|fn|spyOn|doMock)\s*\(/.test(d) || /from\s+["']vitest["']/.test(d)) signals.add("test-mock");
  if (/^\+\s*(?:describe|it|test|bench)\s*\(/m.test(d)) signals.add("test-suite");
  if (path.endsWith("package.json") && (d.includes("overrides") || d.includes("flatted") || d.includes("audit"))) signals.add("security");

  // Barn / plugin lifecycle
  if (d.includes("installPlugin") || d.includes("uninstallPlugin") || d.includes("listPlugins")) signals.add("barn-api");
  if (d.includes("integrity") || d.includes("sha256") || d.includes("SHA-256")) signals.add("barn-integrity");
  if (d.includes("PluginEntry") || d.includes("PluginCatalog")) signals.add("barn-types");

  // 4. Path-based flags
  if (path.includes(".test.") || path.includes(".bench.")) signals.add("test-file");
  if (path.endsWith(".md")) signals.add("docs");

  // 5. Infrastructure Signals
  if (path.startsWith(".github/")) signals.add("infra:github");
  if (path.includes(".github/workflows")) signals.add("infra:workflows");
  if (path.includes(".github/actions")) signals.add("infra:actions");
  if (path === "turbo.json") signals.add("infra:turbo");
  if (path === "tsconfig.json" || path.endsWith("tsconfig.build.json")) {
    if (path.includes("/")) signals.add("tsconfig-local");
    else signals.add("infra:tsconfig");
  }
  if (path.includes("vitest.config")) signals.add("infra:vitest");
  if (path.includes(".devcontainer/")) signals.add("infra:devcontainer");
  if (!scope && (path === "package-lock.json" || path === "package.json")) signals.add("infra:root-pkg");

  // 6. Rust & WASM Signals
  if (path.endsWith(".rs")) signals.add("rust-src");
  if (path.endsWith("Cargo.toml")) {
    signals.add("rust-config");
    if (d.includes("license =")) signals.add("rust-license");
    if (d.includes("publish =")) signals.add("rust-publish");
    if (d.includes("repository =") || d.includes("homepage =")) signals.add("rust-metadata");
  }
  if (path.endsWith("Cargo.lock")) signals.add("rust-lock");
  if (path.endsWith(".wit") || path.includes("/wit/")) signals.add("wit-bindings");
  if (d.includes("wasm32-wasip1")) signals.add("wasm-target");
  if (d.includes("cargo-component")) signals.add("cargo-component");

  // 7. Release & Changeset Signals
  if (path.startsWith(".changeset/")) {
    signals.add("release-automation");
    if (path.endsWith(".md") && path !== ".changeset/README.md") signals.add("changeset-item");
  }

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

    case "infra_github": {
      const parts = [];
      if (allSignals.has("infra:workflows")) parts.push("workflows");
      if (allSignals.has("infra:actions")) parts.push("custom actions");
      return `chore(ci): update GitHub ${parts.join(" and ") || "configuration"}`;
    }

    case "infra_configs": {
      const parts = [];
      if (allSignals.has("infra:turbo")) parts.push("turbo");
      if (allSignals.has("infra:tsconfig")) parts.push("root tsconfig");
      if (allSignals.has("infra:vitest")) parts.push("vitest");
      return `chore: update repository configuration (${parts.join(", ")})`;
    }

    default: {
      if (groupId.startsWith("scope:")) {
        const scope = groupId.replace("scope:", "");
        const deps = getDeps();
        const exports = getExports();
        const parts = [];
        let type = "chore";
        const hasSourceChanges = items.some((item) => item.path.includes("/src/") && !item.path.includes(".test.") && !item.path.includes(".bench."));

        // Collect intents
        if (allSignals.has("homestead-subpath") || allSignals.has("tsconfig-local")) {
          parts.push("update module resolution paths");
          type = "fix";
        }
        if (allSignals.has("test-file")) {
          parts.push(`clean up tests ${exports.length > 0 ? `for ${exports.join(", ")}` : ""}`.trim());
          type = "fix";
        }
        if (allSignals.has("barn-api")) {
          parts.push(`implement plugin lifecycle management (${exports.join(", ") || "barn"})`);
          type = "feat";
        }
        if (allSignals.has("docs")) {
          parts.push("update documentation");
          if (type === "chore") type = "docs";
        }
        if (exports.length > 0 && !allSignals.has("barn-api")) {
          parts.push(`implement ${exports.join(", ")}`);
          type = "feat";
        }
        if (hasSourceChanges && exports.length === 0 && !allSignals.has("barn-api")) {
          parts.push("update implementation");
          if (type === "chore") type = "refactor";
        }
        if (deps.length > 0) {
          parts.push(`update dependencies (${deps.join(", ")})`);
        }

        if (parts.length > 0) {
          return `${type}(${scope}): ${parts.join("; ")}`;
        }
        
        const files = items.map(i => i.path.split("/").pop()).filter(Boolean);
        return `chore(${scope}): update ${files.join(", ") || "package"}`;
      }
      const deps = getDeps();
      if (deps.length > 0) return `chore${scopePrefix}: update ${deps.join(", ")}`;
      const files = items.map(i => i.path.split("/").pop()).filter(Boolean);
      return `chore${scopePrefix}: update ${files.join(", ") || "various files"}`;
    }

    case "release_automation": {
      const isConfig = items.some(i => i.path.endsWith("config.json"));
      if (isConfig) return `chore(release): update changeset configuration`;
      return `docs(release): add changesets for versioning`;
    }

    case "infra_general": {
      const parts = [];
      if (allSignals.has("infra:devcontainer")) parts.push("devcontainer");
      if (allSignals.has("infra:root-pkg")) parts.push("root dependencies");
      return `chore(infra): update ${parts.join(" and ") || "environment configuration"}`;
    }

    case "scope_rust_crate": {
      const scope = groupId.replace("scope_rust_crate:", "");
      const parts = [];
      let type = "chore";

      if (allSignals.has("rust-src")) {
        type = items.some(i => i.status === "??") ? "feat" : "refactor";
        parts.push("update core logic");
      }
      if (allSignals.has("rust-license") || allSignals.has("rust-metadata")) {
        parts.push("align crate metadata and licensing");
      }
      if (items.some(i => i.path.endsWith("package.json") && i.status === "??")) {
        parts.push("add Turborepo integration");
        type = "feat";
      }
      if (allSignals.has("wit-bindings")) parts.push("update WIT bindings");
      if (allSignals.has("test-unit") || allSignals.has("test-suite")) parts.push("update tests");

      const detail = parts.join("; ");
      return `${type}(${scope}): ${detail || "update Rust crate"}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Commit importance classification
// ---------------------------------------------------------------------------

/**
 * Keeps "important commit" detection intentionally small and maintainable.
 * Edge-case semantics should be curated by humans during review/edit flow.
 */
export function assessCommitImportance(groupId, items = []) {
  const reasons = new Set();
  const allSignals = new Set(items.flatMap(i => [...(i.signals || [])]));
  const paths = items.map((i) => i.path || "");

  const hasPath = (predicate) => paths.some((p) => predicate(p));

  if (["security", "release_automation", "infra_github"].includes(groupId)) {
    reasons.add("security/release/CI surface");
  }

  if (groupId.startsWith("scope_rust_crate:")) {
    reasons.add("Rust/WASM crate surface");
  }

  if (allSignals.has("wit-bindings")) reasons.add("WIT interface contract");
  if (allSignals.has("infra:workflows")) reasons.add("CI workflow behavior");
  if (allSignals.has("infra:actions")) reasons.add("CI action behavior");
  if (allSignals.has("rust-config")) reasons.add("Rust build configuration");

  if (hasPath((p) => p.startsWith(".github/workflows/"))) {
    reasons.add("workflow execution path");
  }
  if (hasPath((p) => p.endsWith("Cargo.toml"))) {
    reasons.add("crate metadata/build path");
  }
  if (hasPath((p) => p.includes("/wit/") || p.endsWith(".wit"))) {
    reasons.add("component contract path");
  }

  return {
    important: reasons.size > 0,
    reasons: [...reasons],
  };
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
    release:      { id: "release_automation", title: "🚀 Release: Changesets & Automation", items: [] },
    infra_configs:{ id: "infra_configs", title: "📦 Configuration: Repository-wide",      items: [] },
    infra_general:{ id: "infra_general", title: "🛠️ Infrastructure: Environment",         items: [] },
    other:        { id: "other",        title: "📦 Misc: General Updates",                items: [] },
  };

  const dynamicGroups = new Map();

  const preprocessed = changes.map(change => {
    const status = change.slice(0, 2).trim();
    const path = change.slice(3).trim();
    const diff = getDiffFn(path);
    const signals = extractSignals(path, diff);
    const scopes = [...signals].filter(s => s.startsWith("scope:")).map(s => s.replace("scope:", ""));
    return { status, path, signals, diff, scope: scopes[0] };
  });

  // Aggregate signals per scope
  const scopeSignals = new Map();
  for (const item of preprocessed) {
    if (!item.scope) continue;
    if (!scopeSignals.has(item.scope)) scopeSignals.set(item.scope, new Set());
    const set = scopeSignals.get(item.scope);
    item.signals.forEach(s => set.add(s));
  }

  for (const item of preprocessed) {
    const { path, signals, scope } = item;
    const allScopeSignals = scope ? scopeSignals.get(scope) : signals;

    // Priority Classification
    if (path.includes("git-atomic") || path.includes("git-commit") || path.includes("toolbox/src/") || path.includes("toolbox/test/")) {
      groups.toolbox.items.push(item);
    } else if (signals.has("release-automation")) {
      groups.release.items.push(item);
    } else if (scope) {
      const isRust = allScopeSignals.has("rust-config") || allScopeSignals.has("rust-src") || 
                     allScopeSignals.has("rust-lock") || allScopeSignals.has("wasm-target") || 
                     allScopeSignals.has("wit-bindings");
      
      const gid = isRust ? `scope_rust_crate:${scope}` : `scope:${scope}`;
      
      if (!dynamicGroups.has(gid)) {
        const title = isRust ? `🦀 Rust Crate: ${scope}` : `📦 Package: ${scope}`;
        dynamicGroups.set(gid, { id: gid, title, items: [] });
      }
      dynamicGroups.get(gid).items.push(item);
    } else if (signals.has("infra:github")) {
      const gid = "infra_github";
      if (!dynamicGroups.has(gid)) {
        dynamicGroups.set(gid, { id: gid, title: "🚀 Infrastructure: GitHub CI/CD", items: [] });
      }
      dynamicGroups.get(gid).items.push(item);
    } else if (signals.has("infra:turbo") || signals.has("infra:tsconfig") || signals.has("infra:vitest")) {
      groups.infra_configs.items.push(item);
    } else if (signals.has("security")) {
      groups.security.items.push(item);
    } else if (signals.has("infra:devcontainer") || signals.has("infra:root-pkg")) {
      groups.infra_general.items.push(item);
    } else if (path.endsWith(".md") || path.includes("docs/")) {
      groups.docs.items.push(item);
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
