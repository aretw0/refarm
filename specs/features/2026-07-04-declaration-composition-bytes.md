All confirmed. `recordToNode` does **zero hash verification** — it JSON.parses the payload and trusts it verbatim. So the node-ledger's inline `instructions` are trusted with no content-hash gate today. This validates both designs' shared claim that 8bb00fa9's inline bytes have no hash gate, and confirms the asset-resolver adds a real security property. pi's `applyPatterns` (line 706-716) is the `!`/`+`/`-` enabled-bit suppression grammar, confirming the composition model.

I now have everything source-verified. Here is my judgment.

---

# Verdict: HYBRID (Option A on the bytes+declaration axes, deferring pure-A's list migration) — with a staged re-alignment of 8bb00fa9

## Source-verified findings (what's true regardless of which design wins)

Every load-bearing factual claim in BOTH designs checks out at the source:

1. **8bb00fa9 mixes list+bytes with a truncated id.** `importedSkillNode` (skill-capability.ts:199-209) inlines `instructions` (the SKILL.md body) into the same node whose `@id` is `urn:refarm:skill:v1:<name>:<hash.slice(0,12)>` — a 48-bit prefix (manifest.ts:1310-1311). Confirmed.

2. **The full 64-hex hash is computed then dropped end-to-end.** `parseSkillMarkdown` builds `manifest.source = createSkillSourceRef(...)` with `sha256: sha256(source)` (full 64-hex) + `bytes` length (manifest.ts:72, 126-136). Both loaders have `m.source` in scope and discard it: index.ts:137-144 (`loaded.push`) and node.ts:281-293 (`skills.push`). `LoadedSkill`/`ImportedAgentSkill` have no `source` field. Confirmed — this is the single enabling change both designs converge on.

3. **The node-ledger trusts inline bytes verbatim — no hash gate.** `recordToNode` (record-node.ts:72-100) JSON.parses `payload` and returns it; there is no `verifyContentHash` anywhere in the ledger path. So today's inline `instructions` are unverified. Confirmed.

4. **The asset-resolver is real, uncommitted, and does what's claimed.** `createFsAssetResolver` reads `<root>/<hash>`, runs `verifyContentHash` with a constant-time compare, rejects `hash-mismatch`, demands full 64-hex (`isSha256Hex`); `layeredAssetResolver` is the org→workspace→user byte-fallback = the p2p seam (node.ts:28-71, index.ts:55-80). One detail both designs gloss: the ref field is `AssetRef.hash`, **not** `sha256` — the join must map `SkillSourceRef.sha256` → `AssetRef.hash`.

5. **Config genuinely lacks the composition layer.** `ConfigKey` is a closed 5-member union, `CONFIG_KEYS` fixed, `RefarmCliConfig` has no plugins/skills key, scope is binary `"home"|"local"`, `configPaths` is hard 2-tier `[home, cwd]` (config.ts:22-96,120-130; runtime-config.ts:35-43). `resolveOrgRoot` exists (refarm-home.ts:23-26) but is wired ONLY into the skills ledger, never into config. Confirmed.

6. **pi's model is exactly A's split, and pi has NO content-store.** DECLARATION = `package.json` `pi:{extensions,skills,...}` + `keywords:["pi-package"]` (verified in real agents-lab root package.json). COMPOSITION = `.pi/settings.json` `packages: PackageSource[]` where `PackageSource = string | {source, extensions?, skills?, prompts?, themes?}` with `!x` suppression (settings-manager.ts:70-78; verified 20 real `!extensions/*.ts` entries in agents-lab settings.json; `applyPatterns` enabled-bit at package-manager.ts:706-760). BYTES = fs files, path+name-addressed. The lone `createHash("sha256")` in the loaders (package-manager.ts:2007) hashes a `prefix-suffix` string to name a **temp dir** — NOT content-addressing. Confirmed: pi has zero hash-as-identity seam; refarm's content-store is a deliberate superset.

## Adversarial scoring

**`reAlignsCommit` honesty:**
- **Option A's claim is honest but its own "staged A" note quietly concedes the point.** Pure-A (move the imported-skill LIST out of the node into `config.json plugins[]`, rewrite the fold to read config, widen the closed `CONFIG_KEYS` union into a `PackageSource[]`, teach `configPaths` the org tier) is genuinely **L-sized** and touches the working `import→list→--write` loop. A itself recommends NOT doing that in slice-1. So "Option A" as scored (effort `l`) overstates what you should actually build first; the *defensible* first move is smaller than pure-A.
- **Option B's claim is honest AND minimal.** B's rework is genuinely `S`: thread one `source` field through 2 loaders + 1 node builder, land the asset-resolver, optionally add one scalar config key. It does not fight the commit. This is accurate.

**`ecosystemFit`:** A's is real and verified 1:1 against pi. B's self-assessment as "WEAKER, and this is B's honest liability" is also correct and admirably candid — B can ingest pi's DECLARATION but not pi's COMPOSITION (settings.json `packages[]` with `!surface`) in readable form; it would need a compiler replaying each entry as ledger nodes/tombstones. A wins this axis cleanly.

**Content-addressing / p2p seam:** BOTH preserve it — because both land the *same* asset-resolver and both thread the *same* full-64-hex `source`. Neither loses hash-as-identity. In fact both correctly note the resolver *strengthens* it (real gate vs. today's truncated, unverified id). This axis does **not** discriminate between A and B. That's the key insight the framing obscures: **the byte-tier fix is identical in both designs.** The only real disagreement is *where the LIST lives* (config vs. ledger) and *whether suppression is a config filter vs. a ledger tombstone*.

**Effort honesty:** B's `s` is honest. A's `l` is honest for *pure*-A but misleading as a "do this" recommendation, because A's own body tells you to do the `s`-sized de-mix first.

## Why a hybrid, and precisely which one

The two designs are **not** as opposed as they present. Strip the rhetoric and the decision reduces to two independent axes:

- **Byte axis** (bytes-inline-in-node vs. bytes-behind-resolver): A and B **agree** — move bytes behind the resolver by full hash (B even says so for `.wasm`, and "canonical + dedup + untrusted-source tier" for skills). No real disagreement.
- **List axis** (imported-skill list in config vs. in node-ledger) + **suppression axis** (config `!` filter vs. ledger tombstone): here they diverge.

The honest resolution:

- **Adopt the byte axis now (both agree): de-mix 8bb00fa9's inline bytes into the asset-resolver, keyed by the full `SkillSourceRef.sha256`.** This is the actual defect and it's `S`.
- **Adopt A's config-composition for the layer refarm *entirely lacks* — plugin/package ACTIVATION + `!surface` suppression** — because that layer has no incumbent to fight, is pi-isomorphic, and is where "refarm IS the user's package.json" genuinely belongs. This is purely additive (`S`–`M`).
- **Keep the node-ledger as the imported-skill registry (the LIST) for now — as a cache/index over content-addressed nodes, NOT as the byte store.** Do NOT do pure-A's risky same-era migration of the imported-skill list into config. That migration is the only `L` part of A and it buys little today: the ledger's org→workspace→user fold with highest-id-wins (skill-capability.ts:279-314) is *working, tested, and correct*, and once bytes move out, the node is already just list+metadata+pointer — exactly the "cache" role the hybrid wants.

So: **A's target architecture, reached B's low-risk way.** Arthur's leaning ("config declares, resolver fetches bytes") is the right *destination*; B is right that you get there without reverting 8bb00fa9.

## RECOMMENDATION

**Option:** Hybrid — **Option A's target split** (DECLARATION in the package's own manifest / `pi` key; COMPOSITION list + `!`-suppression in `config.json` per scope; BYTES content-addressed in the asset-resolver) — reached via **Option B's additive, non-reverting path**. The node-ledger survives as the imported-skill registry/cache holding *list + metadata + a full-hash pointer*, never inline bytes.

**FIRST SLICE (the `S`-sized defect fix both designs share, and the only one that touches 8bb00fa9):**

1. Add `source: SkillSourceRef` to `LoadedSkill` (index.ts:62-78) and stop dropping it (index.ts:137-144). Thread it through `ImportedAgentSkill` (node.ts:206) and `skills.push` (node.ts:281-293).
2. Commit `packages/asset-resolver-contract-v1/` as-is and add it to the workspace so `apps/refarm` can depend on it.
3. In `importedSkillNode` (skill-capability.ts:199-209): **drop the inline `instructions`**; add `sha256` (full 64-hex from `source`) + `bytes`. In `persistImportedSkillsToLedger` (skill-capability.ts:211-223): write the SKILL.md bytes to `<scope>/.refarm/assets/<64hex>` via `createFsAssetResolver`, then store the pointer-only node.
4. In `persistedSkillFromNode` / `loadPersistedImportedSkills` (skill-capability.ts:231-314): resolve `instructions` **lazily** via a `layeredAssetResolver([org, workspace, user])` keyed on `{hash: node.sha256}`. Keep `skill list`/`skill show` resolving instructions before output so **no public-JSON contract breaks**.
5. Add an `assetsBaseDir(scope)` helper in refarm-home.ts reusing `resolveRefarmHome`/`resolveOrgRoot`, so config and content-store share one scope seam.

This fixes the real defect (unverified inline bytes + truncated id + dropped hash), adds a genuine security property (the hash gate `recordToNode` lacks), preserves the 3-tier fold and all tests verbatim, and doesn't touch §8 (`plugin-manifest`) or the working import loop.

**SECOND SLICE (additive, no incumbent to fight):** Add `plugins?: PackageSource[]` to `RefarmCliConfig` — the `string | {source, skills?:['!x'], surfaces?:[...]}` shape copied from pi — as the COMPOSITION/activation/suppression layer refarm lacks entirely. Widen the closed `CONFIG_KEYS` union with a dedicated plugins read/modify/write path; prepend org to `configPaths` (→ `[org, home, cwd]` last-wins) reusing `resolveOrgRoot`. This is where "refarm IS the user's package.json" actually lands. Model `refarm plugin add/remove <source> [--local|--org]` on `persistConfigValue`'s read-modify-write, exactly as pi's `addSourceToSettings`.

**THIRD SLICE (optional, deferrable indefinitely):** If/when you want pure-A, migrate the imported-skill LIST from the node-ledger into config too, and mirror the workspace list into `package.json refarm.*`. Not needed for correctness — once bytes are out, the ledger node is already just a content-addressed list entry.

**Re-align 8bb00fa9: YES — as a refinement, NOT a revert.** Keep everything the commit got right: `resolveOrgRoot`, `--scope user|workspace|org` routing, the org→workspace→user fold with highest-precedence-content-addressed-id-wins, injectable `SkillLedgerRoots`. Re-align exactly ONE thing: `importedSkillNode` welds the BYTES (`instructions`) into the same node as the list/metadata under a truncated 48-bit `@id` that the resolver can't use. The fix = (a) move `instructions` out to the asset-store at the full 64-hex `sha256`; (b) add the full `SkillSourceRef` pointer to the node (currently dropped). Rework is `S` (~4 edit sites + committing the resolver). Do NOT re-align by moving the list into config in the same slice — that's the `L`-sized part of pure-A and there's no defect forcing it now.

One correction to both design docs to carry into implementation: the resolver's ref field is `AssetRef.hash`, not `sha256`; the join is `{ hash: node.sha256 }` — trivial, but neither design named it.