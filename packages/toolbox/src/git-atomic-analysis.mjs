#!/usr/bin/env node
import { execSync } from "node:child_process";
import { statSync, existsSync } from "node:fs";

/**
 * Refarm Git Atomic Architect v6.1 (Correct Hierarchy & Stable)
 */

export function getDiffContext(path) {
  try {
    if (!existsSync(path)) return "Deleted File";
    const isDir = statSync(path).isDirectory();
    if (isDir) return "New Module/Directory";

    const isNew = execSync(`git status --porcelain ${path}`, { encoding: "utf-8" }).startsWith("??");
    const diff = isNew 
      ? execSync(`cat ${path} | head -n 50`, { encoding: "utf-8" })
      : execSync(`git diff HEAD -- ${path}`, { encoding: "utf-8" });
    
    const keywords = [];
    if (diff.includes("heartwood") || diff.includes("generateKeypair")) keywords.push("Heartwood/WASM");
    if (diff.includes("vitest") || diff.includes("vi.mock") || diff.includes("pool: 'forks'")) keywords.push("Vitest/Testing");
    if (diff.includes("astro") || diff.includes("vite") || diff.includes("noExternal")) keywords.push("Astro/Vite");
    if (diff.includes("overrides") || diff.includes("flatted")) keywords.push("Security/Audit");
    if (diff.includes("Barn") || diff.includes("SCHEMA") || diff.includes("STORAGE_LAYOUT")) keywords.push("Barn/Specs");
    if (diff.includes("reso") || diff.includes("sync-tsconfig") || diff.includes("reso.mjs")) keywords.push("Reso/Infra");
    if (diff.includes("git-atomic")) keywords.push("Toolbox/Atomic");
    
    return keywords.length > 0 ? keywords.join(", ") : null;
  } catch {
    return null;
  }
}

export function groupChanges(changes, getContextFn = getDiffContext) {
  const groups = {
    security: { id: "security", title: "🔒 Security: Audit & Overrides", items: [], msg: "chore: resolve security vulnerabilities via npm overrides" },
    config_refactor: { id: "config_refactor", title: "⚙️ Infra: Config Refactor (MJS to TS)", items: [], msg: "refactor(config): migrate config files to TypeScript and align with reso" },
    astro_fix: { id: "astro_fix", title: "🚀 Infra: Astro/Vite Resolution", items: [], msg: "fix(config): implement noExternal and alias resolution for Astro" },
    wasm_core: { id: "wasm_core", title: "🌲 Core: Heartwood WASM Loading", items: [], msg: "fix(heartwood): implement robust path-based WASM loading for Node.js" },
    wasm_lazy: { id: "wasm_lazy", title: "🌲 Core: Lazy-Loading Crypto", items: [], msg: "perf(core): implement lazy-loading for Heartwood to stabilize tests" },
    test_infra: { id: "test_infra", title: "🧪 Test: Vitest 4 Stability", items: [], msg: "chore(test): migrate to pool:forks to prevent WASM segmentation faults" },
    test_mocks: { id: "test_mocks", title: "🧪 Test: Mocks & Suites", items: [], msg: "test: stabilize mocks and suites for CLI, Tractor and Registry" },
    barn_specs: { id: "barn_specs", title: "🧺 Specs: Barn & Lifecycle", items: [], msg: "docs(barn): evolve core specifications and plugin branching" },
    proposals: { id: "proposals", title: "💡 Proposals: Future Architectures", items: [], msg: "docs(proposals): add architectural proposals for monorepo evolution" },
    core_docs: { id: "core_docs", title: "📚 Docs: Troubleshooting & Guides", items: [], msg: "docs: document build stabilization and WASM testing lessons" },
    toolbox_tools: { id: "toolbox_tools", title: "🧰 Tools: Atomic Commits Utility", items: [], msg: "feat(toolbox): add git-atomic-analysis tool for sovereign commits" },
    pkg_updates: { id: "pkg_updates", title: "📦 Packages: Modular Updates", items: [], msg: "chore: update internal package configurations and scripts" },
    other: { id: "other", title: "📦 Misc: General Updates", items: [], msg: "chore: update miscellaneous files and root configuration" }
  };

  for (const change of changes) {
    const status = change.slice(0, 2).trim();
    const path = change.slice(3);
    const context = getContextFn(path);
    const changeObj = { status, path, context };

    // HIERARQUIA REFINADA: Do mais específico/urgente para o mais genérico/estrutural
    if (context?.includes("Security")) groups.security.items.push(changeObj);
    else if (path.includes("git-atomic")) groups.toolbox_tools.items.push(changeObj);
    else if (context?.includes("Barn") || path.includes("surveyor") || path.includes("creek") || path.includes("packages/barn")) groups.barn_specs.items.push(changeObj);
    else if (path.includes("docs/proposals/")) groups.proposals.items.push(changeObj);
    else if (path.includes("config") && (status === "D" || path.includes("src/"))) groups.config_refactor.items.push(changeObj);
    else if (path.includes("config") && context?.includes("Astro")) groups.astro_fix.items.push(changeObj);
    else if (path.includes("heartwood/pkg") || (path.includes("key-manager") && context?.includes("Heartwood"))) groups.wasm_core.items.push(changeObj);
    else if (path.includes("registry") && context?.includes("Heartwood")) groups.wasm_lazy.items.push(changeObj);
    else if (path.includes("vitest.config") || context?.includes("pool: 'forks'")) groups.test_infra.items.push(changeObj);
    else if (path.includes(".test.") || (path.includes("cli") && context?.includes("Testing"))) groups.test_mocks.items.push(changeObj);
    // Mudanças em pacotes agora vêm ANTES de documentos genéricos para capturar package.json etc
    else if (path.includes("packages/") || path.includes("apps/") || path.includes("scripts/")) groups.pkg_updates.items.push(changeObj);
    else if (path.startsWith("docs/") || path.endsWith(".md")) groups.core_docs.items.push(changeObj);
    else groups.other.items.push(changeObj);
  }

  return groups;
}

export function runCLI() {
  const isJsonMode = process.argv.includes("--json");
  const changes = [];
  try {
    const statusOutput = execSync("git status --porcelain", { encoding: "utf-8" });
    statusOutput.split("\n").filter(line => line.trim() !== "").forEach(line => changes.push(line));
  } catch (err) {}

  if (changes.length === 0) {
    if (isJsonMode) console.log(JSON.stringify({ groups: [] }));
    else console.log("✅ Solo limpo! Nenhuma mudança pendente no git.");
  } else {
    const groups = groupChanges(changes);
    const activeGroups = Object.values(groups).filter(g => g.items.length > 0);

    if (isJsonMode) {
      console.log(JSON.stringify({ groups: activeGroups }, null, 2));
    } else {
      console.log("\n🚜 # Refarm Git Atomic Architect v6.1 (Priority-Aware)\n");
      for (const group of activeGroups) {
        console.log(`## ${group.title}`);
        group.items.forEach(c => console.log(`  [${c.status}] ${c.path} ${c.context ? `-> ${c.context}` : ""}`));
        const paths = group.items.map(c => c.path).join(" ");
        console.log(`\n  Suggested Command:`);
        console.log(`  git add ${paths} && git commit -m "${group.msg}"\n`);
      }
    }
  }
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCLI();
}
