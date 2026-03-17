/**
 * Struct-aware dimensional slot assignments for TEM observation encoding.
 *
 * Slots are derived from the JSON-LD ontology in schemas/sovereign-graph.jsonld.
 * Each slot covers a semantic category of properties:
 *
 *   dims 0–15:   @type category (ontology hierarchy)
 *   dims 16–31:  identity fields (pluginId, owner, @id URN structure)
 *   dims 32–47:  relational fields (provides, requires, capabilities)
 *   dims 48–55:  temporal fields (clock, dates, TTL)
 *   dims 56–63:  payload fingerprint (content hash, upgradeable to embeddings)
 *
 * Inductive bias: nodes sharing the same semantic role encode into the same
 * dimensions. TEM learns cross-type relational patterns because semantically-
 * equivalent fields are aligned across different @type values.
 *
 * @see docs/research/tem-sovereign-graph-design.md (D5)
 */

export interface SlotConfig {
  offset: number;
  width: number;
}

/** Canonical slot layout for 64-dimensional TEM observation vectors. */
export const SLOTS = {
  /** @type — semantic category of the node */
  type: { offset: 0, width: 16 } as SlotConfig,
  /** Identity: pluginId, owner pubkey, @id URN segments */
  identity: { offset: 16, width: 16 } as SlotConfig,
  /** Relational: provides, requires, capabilities, references */
  relational: { offset: 32, width: 16 } as SlotConfig,
  /** Temporal: refarm:clock, createdAt, updatedAt, expiresAt */
  temporal: { offset: 48, width: 8 } as SlotConfig,
  /** Payload: content fingerprint / semantic embedding placeholder */
  payload: { offset: 56, width: 8 } as SlotConfig,
} as const;

export const N_X = 64; // total observation vector dimensions

/**
 * Known @type values from sovereign-graph.jsonld mapped to stable category indices.
 * New types are assigned to the "unknown" bucket (index 0).
 */
export const TYPE_VOCAB: Record<string, number> = {
  // schema.org types
  Person: 1,
  Message: 2,
  Organization: 3,
  Place: 4,
  Event: 5,
  CreativeWork: 6,
  DataCatalog: 7,
  // refarm types
  "refarm:Plugin": 8,
  "refarm:PluginManifest": 9,
  "refarm:PluginTrustGrant": 10,
  "refarm:TemMemory": 11,
  "refarm:NoveltySignal": 12,
  "refarm:Identity": 13,
  "refarm:Command": 14,
  // meta
  unknown: 0,
};

/** Maximum type vocab size (fits in SLOTS.type.width bits via one-hot spread). */
export const TYPE_VOCAB_MAX = 16;
