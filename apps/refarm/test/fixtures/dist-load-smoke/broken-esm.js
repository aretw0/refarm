/**
 * A DELIBERATELY BROKEN ESM MODULE. Not dead code — the proof that
 * `test/architecture/dist-load-smoke.test.ts` goes red.
 *
 * This directory declares `"type": "module"` (see the sibling `package.json`), exactly like
 * `packages/sower` did when `__dirname` — a CommonJS-only free variable that does not exist in ES
 * module scope — was referenced at module scope in `packages/sower/src/core.ts` and broke every
 * `refarm init` (fixed in 7fd576b1). Node's real ESM loader throws the instant this file is
 * loaded, because the reference is evaluated at module scope, not inside a function body waiting
 * to be called.
 *
 * Nothing in this repo imports this file at runtime — `dist-load-smoke.test.ts` loads it as a real
 * Node subprocess, the same way it loads the CLI's own compiled output, to prove the harness can
 * tell a broken module from a healthy one. Compare `ok-esm.js`, its fixed sibling.
 */
import path from "node:path";

export const templatesRoot = path.join(__dirname, "templates");
