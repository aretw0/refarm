#!/usr/bin/env node
// The impure half of the source-stamp mechanism: run as the LAST step of `pnpm build`, after
// `tsc` has produced `dist/`. It digests `src/` by content and writes that digest into
// `dist/.source-digest`, so a later install can tell whether the `dist/` it is about to ship
// still carries the source it claims to (see `src/commands/node-install-freshness.ts`).
//
// A build that does not run this step leaves no stamp, `measureWorkspaceFreshness` reads that
// as `distDigest: null`, and the install's freshness check reads THAT as `unknown` — which
// REFUSES. Fails closed by construction: no stamp is not a fresh tree.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = fileURLToPath(new URL(".", import.meta.url));
const pkgDir = path.join(scriptsDir, "..");
const distDir = path.join(pkgDir, "dist");
const srcDir = path.join(pkgDir, "src");

// Imported from the just-built `dist/`, not reimplemented: the digest the install recomputes
// must be produced by the SAME function that stamps it, or the two could silently drift. The
// stamp's FILENAME rides the same import for the same reason — two literals for one filename,
// inside the mechanism whose entire purpose is that two things cannot drift, was the bug.
const { digestTree, SOURCE_STAMP } = await import(
	path.join(distDir, "commands", "node-install-freshness.js")
);

const digest = digestTree(srcDir);
if (!digest) {
	console.error(`stamp-source-digest: no source tree found at ${srcDir} — refusing to stamp.`);
	process.exit(1);
}

writeFileSync(path.join(distDir, SOURCE_STAMP), digest);
console.log(`stamp-source-digest: wrote ${digest.slice(0, 12)}… for ${srcDir}`);
