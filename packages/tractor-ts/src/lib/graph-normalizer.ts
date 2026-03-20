/**
 * Sovereign Graph Normaliser
 *
 * Normalise raw data from a plugin into a sovereign JSON-LD node before
 * writing it to the local SQLite graph.
 *
 * See /schemas/sovereign-graph.jsonld for the full schema example.
 */

export interface SovereignNode {
  "@context": string | Record<string, string>;
  "@type": string;
  "@id": string;
  "refarm:signature"?: SovereignSignature;
  "refarm:signatures"?: SovereignSignature[];
  [key: string]: unknown;
}

export interface SovereignSignature {
  pubkey: string;
  sig: string;
  alg: string;
}

export function normaliseToSovereignGraph(
  raw: Record<string, unknown>,
  pluginId: string,
  type: string,
): SovereignNode {
  const id =
    (raw["@id"] as string | undefined) ??
    `urn:refarm:${pluginId}:${crypto.randomUUID()}`;

  const now = new Date().toISOString();

  return {
    ...raw,
    "@context": "https://schema.org/",
    "@type": type,
    "@id": id,
    "refarm:sourcePlugin": pluginId,
    "refarm:ingestedAt": now,
    "refarm:createdAt": (raw["refarm:createdAt"] as string) || now,
    "refarm:updatedAt": now,
    "refarm:clock": (raw["refarm:clock"] as number) || 0,
  };
}
