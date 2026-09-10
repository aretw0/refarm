import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { baseConfig, getAliases } from '@refarm.dev/vtconfig'

/**
 * Directories that own a vitest config are EXCLUDED from the root run.
 *
 * A package's own config is where its containment lives. `apps/refarm/vitest.config.ts` loads
 * `vitest.setup.ts`, which redirects HOME/REFARM_HOME/XDG_* into a throwaway tree and wraps
 * every mutating `fs` entry point in a write guard — because the suite was once measured
 * rewriting the operator's real `~/.refarm/session.lock`.
 *
 * Run those same tests from the REPO ROOT and vitest resolves THIS config instead, whose glob
 * matches every `*.test.ts` in the monorepo and which knows nothing about any package's setup
 * file. The tests then run against the operator's actual home with no write guard at all.
 *
 * That is not hypothetical. On 2026-08-11 a full `pnpm --filter refarm exec vitest run` — which,
 * unlike `--filter … run test`, executes from the REPO ROOT — deleted `spawnEnv` from the
 * operator's live `~/.refarm/config.json`, added a fixture plugin id to `trusted_plugins`, wrote
 * four `revokedPlugins*` keys, and dropped `escape.txt`,
 * `refarm-guard-fixture-escape.txt` (contents: "this must never land on disk") and
 * `refarm-support.json` into the repo root. The config was repaired from a backup; the guard is
 * this.
 *
 * Computed rather than hardcoded so a package that GAINS a config is covered the day it does,
 * and one that loses it is not excluded forever by a stale list.
 */
function directoriesWithOwnVitestConfig(repoRoot) {
	const CONFIG_NAMES = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vitest.config.mjs']
	const excluded = []
	for (const workspaceRoot of ['apps', 'packages']) {
		const base = path.join(repoRoot, workspaceRoot)
		if (!fs.existsSync(base)) continue
		for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue
			const owns = CONFIG_NAMES.some((name) => fs.existsSync(path.join(base, entry.name, name)))
			if (owns) excluded.push(`${workspaceRoot}/${entry.name}/**`)
		}
	}
	return excluded
}

const repoRoot = path.resolve(__dirname)

// Root-level config adds pool options on top of the shared base.
export default defineConfig({
  ...baseConfig,
  resolve: {
    ...baseConfig.resolve,
    alias: {
      ...baseConfig.resolve?.alias,
      ...getAliases(repoRoot)
    }
  },
  test: {
    ...(baseConfig.test || {}),
    exclude: [...(baseConfig.test?.exclude ?? []), ...directoriesWithOwnVitestConfig(repoRoot)],
    // Vitest 4 Pool Options (Reworked)
    pool: 'forks',
    forks: {
      singleFork: true,
    },
  },
});
