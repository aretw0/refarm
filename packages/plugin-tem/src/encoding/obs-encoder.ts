/**
 * Struct-aware observation encoder for TEM.
 *
 * Converts a SovereignNode + TelemetryEvent into a 64-dimensional Float32Array
 * using stable dimensional slots derived from the JSON-LD ontology.
 *
 * The encoder is designed to be injectable (see ObsEncoder interface) so that
 * the payload slot (dims 56–63) can be upgraded to a Transformers.js semantic
 * embedding in v2 without changing TEM core code.
 *
 * @see schema-slots.ts for slot layout
 * @see docs/research/tem-sovereign-graph-design.md (D5)
 */

import {
  SLOTS,
  TYPE_VOCAB,
  TYPE_VOCAB_MAX,
  N_X,
} from "./schema-slots";

/** Any JSON-LD-like node shape accepted by the encoder. */
export interface SovereignNodeLike {
  "@type"?: string | string[];
  "@id"?: string;
  "@context"?: unknown;
  "refarm:sourcePlugin"?: string;
  "refarm:owner"?: string;
  "refarm:clock"?: number;
  "refarm:createdAt"?: string;
  "refarm:updatedAt"?: string;
  "refarm:ingestedAt"?: string;
  provides?: string[];
  requires?: string[];
  capabilities?: {
    provides?: string[];
    requires?: string[];
    providesApi?: string[];
    requiresApi?: string[];
  };
  [key: string]: unknown;
}

export interface TelemetryEventLike {
  event: string;
  pluginId?: string;
  durationMs?: number;
  payload?: unknown;
}

/**
 * Injectable encoder interface.
 * Default implementation: StructAwareEncoder (hash-based).
 * v2 implementation: TransformersJsEncoder (semantic embedding via findByApi).
 */
export interface ObsEncoder {
  encode(node: SovereignNodeLike | null, event: TelemetryEventLike): Float32Array;
}

/**
 * Default struct-aware encoder using deterministic hash-based encoding.
 * Fast, zero-dependency, and ontologically consistent across node types.
 */
export class StructAwareEncoder implements ObsEncoder {
  encode(
    node: SovereignNodeLike | null,
    event: TelemetryEventLike,
  ): Float32Array {
    const vec = new Float32Array(N_X);

    // Slot 0: @type — stable category embedding
    this.encodeType(vec, node?.["@type"]);

    // Slot 1: identity — pluginId, owner, @id URN structure
    this.encodeIdentity(vec, node, event.pluginId);

    // Slot 2: relational — provides/requires/capabilities
    this.encodeRelational(vec, node);

    // Slot 3: temporal — clock, dates
    this.encodeTemporal(vec, node, event.durationMs);

    // Slot 4: payload fingerprint — fast hash of node content
    this.encodePayload(vec, node, event);

    return vec;
  }

  // ─── Slot Encoders ───────────────────────────────────────────────────────

  private encodeType(vec: Float32Array, type?: string | string[]): void {
    const { offset, width } = SLOTS.type;
    const typeName = Array.isArray(type) ? type[0] : type;
    const idx = typeName ? (TYPE_VOCAB[typeName] ?? TYPE_VOCAB["unknown"]) : 0;
    // Spread type index across width dims as fractional one-hot
    const normalised = idx / TYPE_VOCAB_MAX;
    for (let i = 0; i < width; i++) {
      vec[offset + i] = i === idx % width ? normalised : 0;
    }
  }

  private encodeIdentity(
    vec: Float32Array,
    node: SovereignNodeLike | null | undefined,
    pluginId?: string,
  ): void {
    const { offset, width } = SLOTS.identity;
    const id = node?.["@id"] ?? "";
    const owner = (node?.["refarm:owner"] as string) ?? "";
    const pid = (node?.["refarm:sourcePlugin"] as string) ?? pluginId ?? "";

    // Hash the three identity fields into the slot
    hashIntoSlot(vec, offset, width, `${id}|${owner}|${pid}`);
  }

  private encodeRelational(
    vec: Float32Array,
    node: SovereignNodeLike | null | undefined,
  ): void {
    const { offset, width } = SLOTS.relational;
    if (!node) return;

    // Flatten capability fields into a single string for hashing
    const caps = node.capabilities;
    const provides = (node.provides ?? caps?.provides ?? []).join(",");
    const requires = (node.requires ?? caps?.requires ?? []).join(",");
    const apis = [...(caps?.providesApi ?? []), ...(caps?.requiresApi ?? [])].join(",");

    hashIntoSlot(vec, offset, width, `${provides}|${requires}|${apis}`);
  }

  private encodeTemporal(
    vec: Float32Array,
    node: SovereignNodeLike | null | undefined,
    durationMs?: number,
  ): void {
    const { offset, width } = SLOTS.temporal;
    const clock = (node?.["refarm:clock"] as number) ?? 0;
    const ts = node?.["refarm:ingestedAt"] ?? node?.["refarm:createdAt"] ?? node?.["refarm:updatedAt"];
    const tsMs = ts ? new Date(ts as string).getTime() : 0;

    // Encode clock as normalised value, timestamp as recency fraction
    const clockNorm = Math.tanh(clock / 1000); // soft normalisation
    const recency = tsMs > 0 ? Math.exp(-(Date.now() - tsMs) / 86_400_000) : 0; // decay over 1 day
    const durationNorm = durationMs ? Math.tanh(durationMs / 1000) : 0;

    vec[offset] = clockNorm;
    vec[offset + 1] = recency;
    vec[offset + 2] = durationNorm;
    // remaining dims 3–7 left as 0 (reserved for future temporal features)
    if (width > 3) {
      // no-op — reserved
    }
  }

  private encodePayload(
    vec: Float32Array,
    node: SovereignNodeLike | null | undefined,
    event: TelemetryEventLike,
  ): void {
    const { offset, width } = SLOTS.payload;
    // Fast hash of event type + node keys (not values — stable across updates)
    const keys = node ? Object.keys(node).sort().join(",") : "";
    hashIntoSlot(vec, offset, width, `${event.event}|${keys}`);
  }
}

// ─── Hash Utility ─────────────────────────────────────────────────────────

/**
 * Deterministic FNV-1a hash spread across a vector slot.
 * Each character updates the hash; the resulting bytes are normalised to [-1, 1].
 */
function hashIntoSlot(
  vec: Float32Array,
  offset: number,
  width: number,
  input: string,
): void {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // unsigned 32-bit
  }

  // Spread the 32-bit hash across `width` dimensions
  for (let i = 0; i < width; i++) {
    const byte = (hash >>> (i % 32)) & 0xff;
    vec[offset + i] = (byte / 127.5) - 1; // normalise to [-1, 1]
    // rotate hash for next dimension
    hash = ((hash << 1) | (hash >>> 31)) >>> 0;
  }
}
