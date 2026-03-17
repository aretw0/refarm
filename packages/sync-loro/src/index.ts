/**
 * @refarm.dev/sync-loro
 *
 * Loro CRDT engine for Refarm — ADR-045.
 *
 * Implements the CQRS pattern from ADR-028:
 *   - Write model: LoroDoc (conflict-free merge, binary delta sync)
 *   - Read model:  StorageAdapter (SQLite / memory, SQL-queryable)
 *   - Projector:   LoroDoc.subscribe → StorageAdapter.storeNode
 *
 * Usage:
 *   import { LoroCRDTStorage, BrowserSyncClient } from '@refarm.dev/sync-loro'
 *
 *   // Daemon (farmhand):
 *   const storage = new LoroCRDTStorage(sqliteAdapter, peerId)
 *   const tractor = await Tractor.boot({ storage, sync: storage, ... })
 *   transport.onMessage(bytes => storage.applyUpdate(bytes))
 *   storage.onUpdate(bytes => transport.broadcast(bytes))
 *
 *   // Browser:
 *   const storage = new LoroCRDTStorage(memoryAdapter, crypto.randomUUID())
 *   const syncClient = new BrowserSyncClient(storage)
 *   syncClient.connect()
 *   const tractor = await Tractor.boot({ storage, sync: storage, ... })
 *
 * References:
 *   - https://loro.dev
 *   - https://github.com/loro-dev/loro
 *   - specs/ADRs/ADR-045-loro-crdt-adoption.md
 */

export { LoroCRDTStorage } from "./loro-crdt-storage.js";
export { Projector } from "./projector.js";
export { BrowserSyncClient } from "./browser-sync-client.js";
export { peerIdFromString, randomPeerId } from "./peer-id.js";
