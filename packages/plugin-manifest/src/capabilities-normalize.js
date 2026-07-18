// The capabilities NORMALIZER — the one place the ergonomic `verbs` authoring block
// expands into the neutral raw vocabulary (`provides` / `subscribes` / `verbDocs` /
// `verbSchemas`) every host consumer already reads.
//
// WHY. Declaring a dispatchable plugin's verbs used to name the same thing 2–3×:
// `vault:dispatch` in BOTH provides and subscribes; a verb `vault:search` again in
// provides, verbDocs, and verbSchemas; the `vault:` prefix on every entry. The `verbs`
// block collapses all of it — the key once, each short verb once carrying its own
// doc/schema, and the `<key>:dispatch` routing channel derived IMPLICITLY (dispatch is
// INFRA, not a user verb; a non-empty block always surfaces, so no flag is needed —
// the author never spells `dispatch`).
//
// COEXISTENCE (the boundary that keeps this safe). `subscribes`/`provides` also carry
// NON-verb entries a verb-keyed map cannot hold — host events (`user:prompt`), sugar
// strings (`integration:respond`, `observe-host-effects`), and SPI apis (`api:<name>`
// via providesApi). So `verbs` never REPLACES the raw lists: it expands INTO them and
// MERGES with whatever is declared raw. A plugin uses `verbs` for its dispatchable verbs
// and keeps raw `subscribes: ["user:prompt"]` for the rest.
//
// PURITY. This is a pure (capabilities) → capabilities transform, mirrored byte-for-byte
// by the Rust host (env_and_runtime) and asserted by the shared plugin-surface-verbs
// conformance fixture, so the two hosts can never expand `verbs` differently.

/** Qualify a short verb with the block key: `("vault","search") → "vault:search"`. */
function qualify(key, verb) {
	return `${key}:${verb}`;
}

/**
 * Derive a verb's JSON-Schema from its typed `args` — the ergonomic alternative to a hand-authored
 * `schema`. Each arg becomes a property (`type`, `items` for arrays, `description`, `enum`); a
 * `required: true` arg lands in the schema's `required`, in DECLARATION order. Skips a malformed arg
 * (no string `name`). Mirrored byte-for-byte by the Rust host (`derive_verb_schema_from_args`) and
 * asserted by the shared plugin-surface-verbs conformance fixture, so the two hosts can never derive
 * a different schema. (Property order is irrelevant — both sides compare parsed JSON, not text — but
 * `required` is an array, so its order must match: declaration order on both sides.)
 */
function deriveVerbSchemaFromArgs(args) {
	const properties = {};
	const required = [];
	for (const arg of args) {
		if (!arg || typeof arg.name !== "string" || arg.name.length === 0) continue;
		const type = typeof arg.type === "string" ? arg.type : "string";
		const property =
			type === "array"
				? { type: "array", items: { type: typeof arg.items === "string" ? arg.items : "string" } }
				: { type };
		if (typeof arg.description === "string") property.description = arg.description;
		if (Array.isArray(arg.enum) && arg.enum.length > 0) property.enum = [...arg.enum];
		properties[arg.name] = property;
		if (arg.required === true) required.push(arg.name);
	}
	const schema = { type: "object", properties };
	if (required.length > 0) schema.required = required;
	return schema;
}

/**
 * The routing key inferred from a plugin id: the LAST path segment, scope-stripped —
 * `@scope/vault → vault`, `plain-id → plain-id`. This is the canonical key convention
 * the hosts already use (plugin_registry: "the last path segment"). Used as the DEFAULT
 * verbs-block key so the common plugin (`@scope/vault` serving `vault:*`) names nothing;
 * a plugin whose key diverges from its id segment (`@devbench/coding-agent` → `agent`)
 * overrides with an explicit `verbs.key`.
 */
export function pluginKeyFromId(id) {
	if (typeof id !== "string" || id.length === 0) return "";
	const lastSegment = id.slice(id.lastIndexOf("/") + 1);
	return lastSegment;
}

/**
 * Expand a manifest's `capabilities.verbs` authoring block into the raw capability
 * vocabulary, MERGED with any raw `provides`/`subscribes`/`verbDocs`/`verbSchemas`
 * already present. Returns a NEW capabilities object (the input is not mutated); when
 * there is no `verbs` block it returns the capabilities unchanged in shape (raw only).
 *
 * The `verbs` block:
 *   { key?: "vault", list: { <verb>: { provides?, subscribes?, doc?, schema? } } }
 * expands, for each `<verb>` in `list`, to:
 *   - `<key>:<verb>` in provides (when `provides !== false`; provides defaults TRUE — a
 *     listed verb is offered unless it opts out), and in subscribes when `subscribes: true`;
 *   - verbDocs[`<key>:<verb>`] = doc, verbSchemas[`<key>:<verb>`] = schema (when present);
 * and, whenever the block declares any verbs, `<key>:dispatch` into BOTH provides and
 * subscribes — the routing channel EVERY dispatchable verb needs to surface.
 *
 * DISPATCH IS IMPLICIT (no flag). A `verbs` block IS the declaration "these are my
 * tool actions", and a tool action only surfaces via the `<key>:dispatch` guard — so
 * declaring verbs necessarily means being dispatchable; a flag would only let an author
 * declare verbs that can never surface (a dead state). To declare something that is NOT
 * a surfacing tool (the agent's `integration:respond` sugar, a raw event), keep it in raw
 * `provides`/`subscribes` OUTSIDE this block — that IS the "does not surface" statement.
 *
 * `key` is OPTIONAL: absent, it is inferred from `id` (the last path segment,
 * `@scope/vault → vault`) so the common plugin names nothing. An explicit `key`
 * overrides for a plugin whose key diverges from its id segment (`@devbench/coding-agent`
 * → `agent`). `id` is the manifest id, needed only for this inference.
 *
 * De-dupes so a raw entry + an expanded entry naming the same string appears once, and
 * preserves order: raw entries first (as declared), then expanded ones.
 */
export function normalizeCapabilities(capabilities, id) {
	if (!capabilities || typeof capabilities !== "object") return capabilities;
	const verbs = capabilities.verbs;
	if (!verbs || typeof verbs !== "object") return capabilities;

	// Explicit key wins; else infer from the plugin id (last path segment).
	const key =
		typeof verbs.key === "string" && verbs.key.length > 0 ? verbs.key : pluginKeyFromId(id);
	const list = verbs.list && typeof verbs.list === "object" ? verbs.list : {};

	// Start from the raw lists (they carry the non-verb entries) and append expansions.
	const provides = [...(capabilities.provides ?? [])];
	const subscribes = [...(capabilities.subscribes ?? [])];
	const verbDocs = { ...(capabilities.verbDocs ?? {}) };
	const verbSchemas = { ...(capabilities.verbSchemas ?? {}) };

	const pushUnique = (arr, value) => {
		if (!arr.includes(value)) arr.push(value);
	};

	// Sorted verb order — deterministic and independent of authoring order, so the two
	// hosts (this JS + the Rust `capability_profile_from_manifest`) expand identically
	// (the shared conformance fixture asserts the exact sequence).
	for (const verb of Object.keys(list).sort()) {
		const target = qualify(key, verb);
		const spec = list[verb];
		const s = spec && typeof spec === "object" ? spec : {};
		// A listed verb is provided by default (that's why it's listed); opt out with
		// `provides: false` for a verb the plugin only subscribes to.
		if (s.provides !== false) pushUnique(provides, target);
		if (s.subscribes === true) pushUnique(subscribes, target);
		if (typeof s.doc === "string") verbDocs[target] = s.doc;
		// An explicit hand-authored `schema` WINS (the escape hatch); else derive it from typed `args`.
		if (s.schema && typeof s.schema === "object") {
			verbSchemas[target] = s.schema;
		} else if (Array.isArray(s.args) && s.args.length > 0) {
			verbSchemas[target] = deriveVerbSchemaFromArgs(s.args);
		}
	}

	// A non-empty verbs block IS a dispatchable surface — derive the `<key>:dispatch`
	// routing channel on BOTH sides (offered AND listened on), the guard every verb needs
	// to surface. Implicit, never a flag: declaring verbs means wanting them to surface.
	if (key && Object.keys(list).length > 0) {
		const channel = qualify(key, "dispatch");
		pushUnique(provides, channel);
		pushUnique(subscribes, channel);
	}

	// Return capabilities with the raw fields REPLACED by the merged result and the
	// `verbs` block dropped (it has been lowered; consumers read only the raw vocab).
	const { verbs: _dropped, ...rest } = capabilities;
	const normalized = { ...rest, provides, subscribes };
	if (Object.keys(verbDocs).length > 0) normalized.verbDocs = verbDocs;
	if (Object.keys(verbSchemas).length > 0) normalized.verbSchemas = verbSchemas;
	return normalized;
}

/**
 * Manifest-level convenience: lower a whole manifest's `capabilities.verbs` block,
 * inferring the key from the manifest's own `id`. Returns a NEW manifest with normalized
 * capabilities (input unmutated); a manifest with no `verbs` block is returned unchanged.
 * The host load paths call this so a manifest authored with `verbs` reaches every raw
 * consumer already expanded.
 */
export function normalizeManifest(manifest) {
	if (!manifest || typeof manifest !== "object" || !manifest.capabilities) return manifest;
	const normalized = normalizeCapabilities(manifest.capabilities, manifest.id);
	if (normalized === manifest.capabilities) return manifest;
	return { ...manifest, capabilities: normalized };
}
