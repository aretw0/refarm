#!/usr/bin/env node
/**
 * gen-loro-fixture.mjs
 *
 * Generates a binary Loro update fixture using loro-crdt (JS) with the exact
 * same schema that LoroCRDTStorage and NativeSync use:
 *
 *   doc.getMap("nodes").set(id, JSON.stringify({ id, type, context, payload, sourcePlugin, updatedAt }))
 *
 * Output: packages/tractor/tests/fixtures/loro-js-update.bin
 *
 * Used by the Rust conformance test `loro_binary_js_interop` (criterion #2)
 * to prove binary format compatibility between loro-crdt JS and loro Rust.
 */

import { LoroDoc } from 'loro-crdt';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '../../tractor/tests/fixtures/loro-js-update.bin');

const doc = new LoroDoc();
// Use a fixed peer ID for deterministic output
doc.setPeerId(1n);

const nodesMap = doc.getMap('nodes');

// Mirror exactly what LoroCRDTStorage.storeNode() does:
//   nodeMap.set(id, JSON.stringify({ id, type, context, payload, sourcePlugin, updatedAt }))
nodesMap.set(
  'urn:interop:1',
  JSON.stringify({
    id: 'urn:interop:1',
    type: 'Message',
    context: 'global',
    payload: JSON.stringify({ '@type': 'Message', text: 'hello from loro-crdt JS' }),
    sourcePlugin: 'test',
    updatedAt: '2026-03-19T00:00:00.000Z',
  })
);
doc.commit();

const bytes = doc.export({ mode: 'update' });

mkdirSync(resolve(__dirname, '../../tractor/tests/fixtures'), { recursive: true });
writeFileSync(OUTPUT, Buffer.from(bytes));

console.log(`Written ${bytes.length} bytes → ${OUTPUT}`);
