import { readProvenance, stampProvenance, verifyProvenance, type FieldsBag } from "./provenance.js";
import type { NoteProvenance, ProvenanceVerificationResult } from "./types.js";

/**
 * The reference carrier for provenance:v1 — an in-memory note store that stamps provenance on
 * write and reads it back on load, using ONLY the contract's pure functions. It is the minimal
 * implementation that proves the contract is satisfiable end to end: a real store (a vault, a
 * frontmatter file, a KnowledgeRecord's `fields`) carries provenance the same way, just with a
 * durable backend instead of a Map.
 *
 * A conformance harness for provenance runs against these pure functions directly (they take no
 * port), so this carrier is the worked example a producer/consumer can read to see the intended
 * round-trip — not a swappable adapter behind an interface.
 */
export interface InMemoryProvenanceCarrier {
	/** Store a note's fields, stamping the provenance under the reserved key. Returns the id. */
	put(id: string, fields: FieldsBag, provenance: NoteProvenance): string;
	/** Read the stored fields bag (with the provenance stamped in), or `null` when absent. */
	get(id: string): FieldsBag | null;
	/** Read the provenance back off a stored note, or `null` when absent/malformed. */
	provenanceOf(id: string): NoteProvenance | null;
	/** Verify the stored note's provenance against the contract. */
	verify(id: string): ProvenanceVerificationResult;
	/** The ids currently held. */
	ids(): string[];
}

export function createInMemoryProvenanceCarrier(): InMemoryProvenanceCarrier {
	const notes = new Map<string, FieldsBag>();

	return {
		put(id, fields, provenance) {
			notes.set(id, stampProvenance(fields, provenance));
			return id;
		},
		get(id) {
			return notes.get(id) ?? null;
		},
		provenanceOf(id) {
			return readProvenance(notes.get(id));
		},
		verify(id) {
			return verifyProvenance(readProvenance(notes.get(id)));
		},
		ids() {
			return [...notes.keys()];
		},
	};
}
