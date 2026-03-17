import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";
import type { SyncAdapter } from "@refarm.dev/sync-contract-v1";
import { LoroDoc } from "loro-crdt";
import { Projector } from "./projector.js";

/**
 * LoroCRDTStorage — CQRS bridge implementing both StorageAdapter and SyncAdapter.
 *
 * Write model: LoroDoc (CRDT, conflict-free merge, binary delta sync)
 * Read model:  Delegated StorageAdapter (SQLite / memory, SQL-queryable)
 *
 * Architecture (ADR-045):
 *   storeNode → LoroDoc (write model)
 *   Projector.onChange → readModel.storeNode (read model, ~synchronous)
 *   queryNodes / execute / query → readModel (unchanged for all consumers)
 *
 * Usage:
 *   const storage = new LoroCRDTStorage(sqliteAdapter, peerId)
 *   const tractor = await Tractor.boot({ storage, sync: storage, ... })
 *   transport.onMessage(bytes => storage.applyUpdate(bytes))
 *   storage.onUpdate(bytes => transport.broadcast(bytes))
 */
export class LoroCRDTStorage implements StorageAdapter, SyncAdapter {
  private readonly doc: LoroDoc;
  private readonly projector: Projector;

  constructor(
    private readonly readModel: StorageAdapter,
    /**
     * Peer ID — must be a uint64-compatible value: number, BigInt, or decimal string.
     * Loro uses this to identify the originating peer in the CRDT oplog.
     * Use `peerIdFromString()` to derive a stable uint64 from a hostname or UUID.
     */
    peerId: number | bigint
  ) {
    this.doc = new LoroDoc();
    this.doc.setPeerId(peerId);
    this.projector = new Projector(this.doc, this.readModel);
  }

  // ── StorageAdapter — write model ─────────────────────────────────────────

  async storeNode(
    id: string,
    type: string,
    context: string,
    payload: string,
    sourcePlugin: string | null,
  ): Promise<void> {
    const nodeMap = this.doc.getMap("nodes");
    nodeMap.set(
      id,
      JSON.stringify({
        id,
        type,
        context,
        payload,
        sourcePlugin,
        updatedAt: new Date().toISOString(),
      }),
    );
    this.doc.commit();
    // Projector listens via doc.subscribe and writes to readModel
  }

  // ── StorageAdapter — read model (delegates) ──────────────────────────────

  async ensureSchema(): Promise<void> {
    return this.readModel.ensureSchema();
  }

  async queryNodes(type: string): Promise<unknown[]> {
    return this.readModel.queryNodes(type);
  }

  async execute(sql: string, args?: unknown): Promise<unknown> {
    return this.readModel.execute(sql, args);
  }

  async query<T = unknown>(sql: string, args?: unknown): Promise<T[]> {
    return this.readModel.query<T>(sql, args);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.readModel.transaction(fn);
  }

  async close(): Promise<void> {
    return this.readModel.close();
  }

  // ── SyncAdapter ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    // no-op: LoroDoc is always ready
  }

  async stop(): Promise<void> {
    await this.close();
  }

  /**
   * Apply a binary Loro update received from a remote peer.
   * The Projector will automatically write any changed nodes to the read model.
   */
  async applyUpdate(update: Uint8Array): Promise<void> {
    this.doc.import(update);
  }

  /**
   * Export all local updates as a binary delta.
   * Pass an optional `from` version to get only the delta since that version.
   */
  async getUpdate(): Promise<Uint8Array> {
    return this.doc.export({ mode: "update" }) as Uint8Array;
  }

  /**
   * Subscribe to local CRDT updates that should be broadcast to remote peers.
   * Returns an unsubscribe function.
   */
  onUpdate(callback: (update: Uint8Array) => void): () => void {
    return this.doc.subscribeLocalUpdates(callback);
  }

  // ── Snapshot helpers (for persistence, RPi, time travel) ─────────────────

  /**
   * Export a full snapshot. Suitable for cold-boot persistence (e.g. SQLite blob on farmhand).
   * After importing a snapshot on a fresh boot, call `rebuildReadModel()` to re-project.
   */
  exportSnapshot(): Uint8Array {
    return this.doc.export({ mode: "snapshot" }) as Uint8Array;
  }

  /**
   * Export a shallow snapshot (history stripped, like git clone --depth=1).
   * Significantly smaller than a full snapshot — suitable for RPi/IoT storage.
   */
  exportShallowSnapshot(): Uint8Array {
    return this.doc.export({
      mode: "shallow-snapshot",
      frontiers: this.doc.frontiers(),
    }) as Uint8Array;
  }

  /**
   * Import a previously exported snapshot (full or shallow).
   * After calling this, invoke rebuildReadModel() to sync the SQLite read model.
   */
  importSnapshot(snapshot: Uint8Array): void {
    this.doc.import(snapshot);
  }

  /**
   * Rebuild the SQLite read model from the current LoroDoc state.
   * Use after importing a snapshot on a fresh boot.
   */
  async rebuildReadModel(): Promise<void> {
    await this.projector.rebuildAll();
  }
}
