#!/usr/bin/env node
// Compat shim — the real code is the @refarm.dev/farm-client package.
// Kept so `node scripts/farm-ask.mjs` (muscle memory, docs) still works from a git pull.
// Prefer: node packages/farm-client/bin/farm-ask.mjs
import "../packages/farm-client/bin/farm-ask.mjs";
