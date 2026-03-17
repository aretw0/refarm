/**
 * @refarm.dev/storage-rest
 *
 * REST StorageAdapter for Refarm — implements StorageAdapter by proxying to any HTTP API.
 *
 * Part of the Refarm Composition Model (ADR-046): this block enables @refarm.dev/tractor
 * to be used with traditional centralized backends, without any CRDT or local-first machinery.
 *
 * Usage:
 *   import { RestStorageAdapter } from "@refarm.dev/storage-rest";
 *
 *   const storage = new RestStorageAdapter({
 *     baseUrl: "https://api.myapp.com",
 *     headers: { Authorization: `Bearer ${token}` },
 *   });
 *
 *   const tractor = await Tractor.boot({ storage, identity, namespace: "myapp" });
 *   // No sync: centralized, no CRDT, no OPFS
 */

export { RestStorageAdapter } from "./rest-storage-adapter.js";
export type { RestStorageOptions } from "./rest-storage-adapter.js";
