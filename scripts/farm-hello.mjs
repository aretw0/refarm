#!/usr/bin/env node
// Compat shim — the real code is the @refarm.dev/farm-client package.
// Kept so `node scripts/farm-hello.mjs` (muscle memory, docs) still works from a git pull.
// Prefer: node packages/farm-client/bin/farm-hello.mjs
import "../packages/farm-client/bin/farm-hello.mjs";
