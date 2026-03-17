import type { LoroDoc, LoroEventBatch } from "loro-crdt";
import type { StorageAdapter } from "@refarm.dev/storage-contract-v1";

/**
 * Projector — LoroDoc → StorageAdapter read model.
 *
 * Listens to LoroDoc change events and writes affected nodes to the read model
 * (SQLite or in-memory store). This is the CQRS projection step described in ADR-045.
 *
 * The read model is always 100% derivable from the LoroDoc snapshot — it can be
 * rebuilt at any time by calling `rebuildAll()`.
 */
export class Projector {
  constructor(
    private readonly doc: LoroDoc,
    private readonly readModel: StorageAdapter,
  ) {
    this.doc.subscribe((batch: LoroEventBatch) => {
      void this._project(batch);
    });
  }

  private async _project(batch: LoroEventBatch): Promise<void> {
    const nodeMap = this.doc.getMap("nodes");

    // Collect IDs that changed in this batch.
    // Loro fires one batch per commit; each event targets a container.
    const changedIds = new Set<string>();

    for (const event of batch.events) {
      if (
        event.diff.type === "map" &&
        (event.path.length === 0 || event.path[0] === "nodes")
      ) {
        // Top-level map diff — keys are node IDs
        for (const key of Object.keys(event.diff.updated)) {
          changedIds.add(key);
        }
      }
    }

    // Project each changed node to the read model
    for (const id of changedIds) {
      const raw = nodeMap.get(id) as string | undefined;
      if (!raw) continue; // deleted node — future: handle deletions

      let node: {
        id: string;
        type: string;
        context: string;
        payload: string;
        sourcePlugin: string | null;
      };

      try {
        node = JSON.parse(raw) as typeof node;
      } catch {
        console.error(`[sync-loro] Projector: invalid JSON for node ${id}`);
        continue;
      }

      try {
        await this.readModel.storeNode(
          node.id,
          node.type,
          node.context ?? "",
          node.payload ?? "",
          node.sourcePlugin ?? null,
        );
      } catch (e) {
        // Projector must never crash the CRDT engine
        console.error(`[sync-loro] Projector: failed to project node ${id}:`, e);
      }
    }
  }

  /**
   * Rebuild the entire read model from the current LoroDoc state.
   * Use after importing a snapshot to ensure read model consistency.
   */
  async rebuildAll(): Promise<void> {
    const nodeMap = this.doc.getMap("nodes");
    const keys = nodeMap.keys();

    for (const id of keys) {
      const raw = nodeMap.get(id) as string | undefined;
      if (!raw) continue;

      let node: {
        id: string;
        type: string;
        context: string;
        payload: string;
        sourcePlugin: string | null;
      };

      try {
        node = JSON.parse(raw) as typeof node;
      } catch {
        continue;
      }

      await this.readModel.storeNode(
        node.id,
        node.type,
        node.context ?? "",
        node.payload ?? "",
        node.sourcePlugin ?? null,
      );
    }
  }
}
