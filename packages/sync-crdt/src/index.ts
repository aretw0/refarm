/**
 * @refarm.dev/sync-crdt
 *
 * CRDT-based sync primitive.
 *
 * Provides conflict-free replicated data types so that data edited offline on
 * multiple devices (or by multiple plugins) can be merged deterministically
 * without a central authority.
 *
 * This module is intentionally back-end agnostic: wire up the `SyncTransport`
 * interface to Nostr relays, libp2p, BroadcastChannel, or any other channel.
 *
 * References:
 *   - Automerge (https://automerge.org)
 *   - Yjs        (https://yjs.dev)
 *   - Martin Kleppmann — "Local-First Software" (2019)
 */

// ─── Vector Clock ────────────────────────────────────────────────────────────

/**
 * A logical clock entry per peer.
 * Key: peer ID (e.g. a Nostr pubkey)
 * Value: monotonically increasing counter
 */
export type VectorClock = Record<string, number>;

/** Merge two vector clocks by taking the max of each component. */
export function mergeClocks(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [peer, counter] of Object.entries(b)) {
    result[peer] = Math.max(result[peer] ?? 0, counter);
  }
  return result;
}

/** Increment the clock for `peerId`. */
export function tickClock(clock: VectorClock, peerId: string): VectorClock {
  return { ...clock, [peerId]: (clock[peerId] ?? 0) + 1 };
}

// ─── CRDT Operation ──────────────────────────────────────────────────────────

/**
 * An atomic, immutable operation that can be applied to the CRDT state.
 * Operations are idempotent when applied multiple times.
 */
export interface CRDTOperation<T = unknown> {
  /** Unique operation ID (e.g. `${peerId}/${clock[peerId]}`). */
  id: string;
  /** Originating peer. */
  peerId: string;
  /** Logical time at origin. */
  clock: VectorClock;
  /** Wall-clock timestamp (for tie-breaking UI display only — not causal). */
  timestamp: number;
  /** Application-level operation payload. */
  op: T;
}

// ─── LWW Register (Last-Write-Wins) ─────────────────────────────────────────

/**
 * A Last-Write-Wins (LWW) register: the value from the operation with the
 * highest logical clock wins.  Ties are broken by peer ID (lexicographic).
 *
 * Suitable for simple scalar fields (strings, numbers, booleans).
 */
export class LWWRegister<T> {
  private _value: T;
  private _clock: VectorClock = {};
  private _peerId: string = "";

  constructor(initialValue: T) {
    this._value = initialValue;
  }

  get value(): T {
    return this._value;
  }

  set(newValue: T, peerId: string, clock: VectorClock): void {
    if (this._dominates(clock, peerId)) return; // our state is newer
    this._value = newValue;
    this._clock = mergeClocks(this._clock, clock);
    this._peerId = peerId;
  }

  /** Returns true if our current clock dominates the incoming one. */
  private _dominates(incoming: VectorClock, incomingPeer: string): boolean {
    const ourTime = this._clock[this._peerId] ?? 0;
    const theirTime = incoming[incomingPeer] ?? 0;
    if (ourTime !== theirTime) return ourTime > theirTime;
    return this._peerId > incomingPeer; // lexicographic tie-break
  }
}

// ─── OR-Set (Observed-Remove Set) ────────────────────────────────────────────

/**
 * An Observed-Remove Set: items can be concurrently added and removed;
 * add always wins over remove for the *same* logical operation.
 *
 * Suitable for tag lists, relation sets, plugin capability lists.
 */
export class ORSet<T extends string | number> {
  /** Maps element → set of unique "add" tokens that haven't been removed. */
  private _entries: Map<T, Set<string>> = new Map();

  add(element: T, token: string): void {
    if (!this._entries.has(element)) {
      this._entries.set(element, new Set());
    }
    this._entries.get(element)!.add(token);
  }

  remove(element: T, tokens: Set<string>): void {
    const existing = this._entries.get(element);
    if (!existing) return;
    for (const t of tokens) existing.delete(t);
    if (existing.size === 0) this._entries.delete(element);
  }

  has(element: T): boolean {
    return (this._entries.get(element)?.size ?? 0) > 0;
  }

  values(): T[] {
    return Array.from(this._entries.keys());
  }

  /** Merge another ORSet into this one (union of add-tokens). */
  merge(other: ORSet<T>): void {
    for (const [el, tokens] of other._entries) {
      for (const t of tokens) this.add(el, t);
    }
  }
}

// ─── Sync Transport Interface ─────────────────────────────────────────────────

/**
 * Minimal transport contract.  Implement this interface to sync CRDT operations
 * over Nostr, BroadcastChannel, WebRTC, etc.
 */
export interface SyncTransport {
  /** Send an outbound operation to remote peers. */
  send(op: CRDTOperation): Promise<void>;

  /** Register a handler invoked whenever a remote operation arrives. */
  onReceive(handler: (op: CRDTOperation) => void): void;

  /** Gracefully disconnect. */
  disconnect(): Promise<void>;
}

// ─── Sync Engine ─────────────────────────────────────────────────────────────

/**
 * Orchestrates operation dispatch and reception across one or more transports.
 *
 * Usage:
 *   const engine = new SyncEngine('my-peer-id');
 *   engine.addTransport(nostrTransport);
 *   engine.onOperation(op => applyToLocalState(op));
 *   await engine.dispatch({ type: 'set', path: 'profile.name', value: 'Alice' });
 */
export class SyncEngine {
  private _clock: VectorClock = {};
  private _transports: SyncTransport[] = [];
  private _handlers: Array<(op: CRDTOperation) => void> = [];

  constructor(public readonly peerId: string) {}

  addTransport(transport: SyncTransport): void {
    this._transports.push(transport);
    transport.onReceive((op) => this._applyRemote(op));
  }

  onOperation(handler: (op: CRDTOperation) => void): void {
    this._handlers.push(handler);
  }

  async dispatch(opPayload: unknown): Promise<void> {
    this._clock = tickClock(this._clock, this.peerId);
    const op: CRDTOperation = {
      id: `${this.peerId}/${this._clock[this.peerId]}`,
      peerId: this.peerId,
      clock: { ...this._clock },
      timestamp: Date.now(),
      op: opPayload,
    };
    this._notify(op);
    await Promise.all(this._transports.map((t) => t.send(op)));
  }

  private _applyRemote(op: CRDTOperation): void {
    this._clock = mergeClocks(this._clock, op.clock);
    this._notify(op);
  }

  private _notify(op: CRDTOperation): void {
    for (const h of this._handlers) h(op);
  }
}

export default SyncEngine;
