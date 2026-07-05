// The reference vault:v1 surface, as the JS entry that `jco componentize` compiles
// into a `vault-surface` WASM component. It must be SELF-CONTAINED — it runs inside
// StarlingMonkey (no node imports, no filesystem, no clock). The world imports
// NOTHING, so this is pure compute over the (verb, note, profile) the host hands it;
// that absence IS the sandbox.
//
// The logic mirrors packages/vault-contract-v1/src/reference.ts (runReferenceVault),
// ported here so the component is dependency-free. The contract's conformance suite
// pins the behavior the two must share (native ↔ WASM parity).
//
// WIT ⇄ JS mapping (jco): interface `surface` → `export const surface`; func `run`
// → `run(verb, note, profile)`; kebab fields camelCased (rule-id → ruleId); the
// `record-json` extract output carries the KnowledgeRecord as a JSON string.

/** Parse a rule's opaque `match` JSON; a malformed matcher fires nothing. */
function parseMatch(raw) {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") return parsed;
	} catch {
		// forward-safe: never throws
	}
	return undefined;
}

function str(match, key) {
	const value = match[key];
	return typeof value === "string" ? value : undefined;
}

// ── search: "contains" ──
function searchNote(note, ruleId, match) {
	if (match.type !== "contains") return undefined;
	const value = str(match, "value");
	if (!value) return undefined;
	const index = note.text.indexOf(value);
	if (index < 0) return undefined;
	return {
		path: note.path,
		ruleId,
		locus: JSON.stringify({ index, match: value }),
		score: 1,
	};
}

// ── extract: "frontmatter" → KnowledgeRecord (as a JSON string) ──
function parseFrontmatter(text) {
	const fields = {};
	if (!text.startsWith("---")) return fields;
	const end = text.indexOf("\n---", 3);
	if (end < 0) return fields;
	const block = text.slice(3, end);
	for (const line of block.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colon = trimmed.indexOf(":");
		if (colon < 0) continue;
		const key = trimmed.slice(0, colon).trim();
		const value = trimmed.slice(colon + 1).trim();
		if (key) fields[key] = value;
	}
	return fields;
}

// FNV-1a 32-bit — the same content hash records-contract-v1 stamps (fnv1a32:…),
// ported here so the component's records carry a valid contentHash without a dep.
function fnv1a32(input) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
	}
	return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

/** Stable stringify (sorted keys) — matches records-contract-v1's hash input. */
function stableStringify(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const keys = Object.keys(value).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function extractRecord(note, ruleId, match) {
	if (match.type !== "frontmatter") return undefined;
	const fields = parseFrontmatter(note.text);
	if (Object.keys(fields).length === 0) return undefined;
	const type = str(match, "recordType") ?? "refarm:VaultRecord";
	const record = {
		id: note.path,
		schemaVersion: 1,
		"@type": type,
		fields,
		sourceRefs: [note.path],
		contentHash: "",
		"refarm:ruleId": ruleId,
	};
	// contentHash excludes itself (records-contract-v1 convention).
	const { contentHash: _c, ...rest } = record;
	record.contentHash = fnv1a32(stableStringify(rest));
	return { ruleId, json: JSON.stringify(record) };
}

// ── organize: "prefix-route" ──
function organizeNote(note, ruleId, match) {
	if (match.type !== "prefix-route") return undefined;
	const marker = str(match, "marker");
	const destination = str(match, "destination");
	if (!marker || !destination) return undefined;
	if (!note.text.includes(marker)) return undefined;
	const parts = note.path.split("/");
	const base = parts[parts.length - 1] ?? note.path;
	const prefix = str(match, "prefix");
	const fileName = prefix ? `${prefix}${base}` : base;
	return { path: note.path, ruleId, destination, fileName };
}

// ── profile: "requires" ──
function profileNote(note, ruleId, severity, match) {
	if (match.type !== "requires") return undefined;
	const value = str(match, "value");
	if (!value) return undefined;
	if (note.text.includes(value)) return undefined;
	return {
		severity: severity ?? "warn",
		ruleId,
		message: `note is missing required content: ${value}`,
		locus: JSON.stringify({ path: note.path }),
	};
}

export const surface = {
	/** Dispatch one verb against one note under a verb-scoped profile. Pure compute,
	 * deterministic — the same (verb, note, profile) always yields the same result. */
	run(verb, note, profile) {
		const result = { verb, records: [], hits: [], plans: [], findings: [] };
		for (const rule of profile.rules) {
			if (rule.verb !== verb) continue;
			const match = parseMatch(rule.match);
			if (!match) continue;
			if (verb === "search") {
				const hit = searchNote(note, rule.id, match);
				if (hit) result.hits.push(hit);
			} else if (verb === "extract") {
				const record = extractRecord(note, rule.id, match);
				if (record) result.records.push(record);
			} else if (verb === "organize") {
				const plan = organizeNote(note, rule.id, match);
				if (plan) result.plans.push(plan);
			} else if (verb === "profile") {
				const finding = profileNote(note, rule.id, rule.severity, match);
				if (finding) result.findings.push(finding);
			}
		}
		return result;
	},
};
