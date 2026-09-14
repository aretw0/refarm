/**
 * `broken-esm.js`'s fixed sibling — the same shape `packages/sower/src/core.ts` uses today.
 * Kept beside the broken fixture so the harness is proven to pass on a healthy module, not just
 * to fail on a broken one: a check that only ever goes red is as useless as one that only ever
 * goes green.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const templatesRoot = path.join(MODULE_DIR, "templates");
