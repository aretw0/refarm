# content-projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@refarm.dev/content-projection` — the generic MD/MDX → `records:v1` projection block
(parse frontmatter, extract/resolve wikilinks, project to records), reusing `records-contract-v1` and
composing with any `source-*` adapter for acquisition.

**Architecture:** A pure TypeScript block mirroring the `source-web` / `records-contract-v1` package shape.
Four small pure functions — `parseFrontmatter`, `extractWikilinks`, `resolveWikilinks`,
`projectContentToRecords` — plus typed inputs (`ContentItem`, `ProjectionConfig`). Output is stamped and
validated through `records-contract-v1` (no new contract). This is the upstream generalization of
vault-seed's `noteToRecord` / `extractLinks` / `resolveLinks` (the reference implementation).

**Tech Stack:** TypeScript (ESM), vitest, `tsc --project tsconfig.build.json`, pnpm workspace, `gray-matter`
for frontmatter parsing.

## Global Constraints

- Package name `@refarm.dev/content-projection`, version `0.1.0`, `"type": "module"`.
- ESM only: intra-package imports use `.js` extensions (e.g. `from "./types.js"`).
- Test framework is vitest (`vitest run`); build is `tsc --project tsconfig.build.json`.
- Runtime deps: `@refarm.dev/records-contract-v1` (`workspace:*`) and `gray-matter` (`^4.0.3`) only. Node `>=22`.
- Design of record: `docs/superpowers/specs/2026-07-02-content-projection-md-mdx-design.md` (Unit 1).
- Scope: **layer 1 only** (the projection block). `ds-astro` and the MDX authoring wiring are separate plans.
- Body-format agnostic: the block treats `.md` and `.mdx` bodies identically (frontmatter + wikilinks are
  the same; MDX components are a render-time concern owned by the later `ds-astro` plan).

---

## File Structure

- `packages/content-projection/package.json` — package manifest (mirrors `source-web`).
- `packages/content-projection/tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` — TS + test config.
- `packages/content-projection/src/types.ts` — `ContentItem`, `ProjectionConfig`.
- `packages/content-projection/src/frontmatter.ts` — `parseFrontmatter`.
- `packages/content-projection/src/wikilinks.ts` — `extractWikilinks`, `resolveWikilinks`.
- `packages/content-projection/src/project.ts` — `projectContentToRecords` (stamps via records-contract-v1).
- `packages/content-projection/src/*.test.ts` — one test file per module.
- `packages/content-projection/src/index.ts` — public exports.
- `packages/content-projection/README.md` — one-paragraph package readme.

---

### Task 1: Scaffold package + input types

**Files:**
- Create: `packages/content-projection/package.json`
- Create: `packages/content-projection/tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- Create: `packages/content-projection/src/types.ts`

**Interfaces:**
- Produces: `ContentItem`, `ProjectionConfig` (consumed by every later task).

- [ ] **Step 1: Copy config from the sibling package**

Copy `tsconfig.json`, `tsconfig.build.json`, and `vitest.config.ts` verbatim from `packages/source-web/`
into `packages/content-projection/` (same TS + vitest settings — do not diverge).

- [ ] **Step 2: Write `package.json`**

Copy the `license` value and any workspace conventions from `packages/source-web/package.json` (the sibling
this mirrors), then use:

```json
{
  "name": "@refarm.dev/content-projection",
  "version": "0.1.0",
  "private": false,
  "description": "Generic MD/MDX -> records:v1 projection block (frontmatter, wikilinks, projection).",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@refarm.dev/records-contract-v1": "workspace:*",
    "gray-matter": "^4.0.3"
  },
  "devDependencies": {
    "@refarm.dev/tsconfig": "workspace:*",
    "@refarm.dev/vtconfig": "workspace:*"
  },
  "files": ["dist", "!dist/**/*.tsbuildinfo", "README.md"],
  "publishConfig": { "access": "public" },
  "license": "MIT"
}
```

- [ ] **Step 3: Write `src/types.ts`**

```ts
/** A content item to project. Acquisition (source-local/web/git) produces these; projection consumes them. */
export interface ContentItem {
  /** Stable id (already slugified by the acquiring source). */
  id: string;
  title?: string;
  /** Acquisition folder; drives `@type` via ProjectionConfig.typeByFolder. */
  folder?: string;
  status?: string | null;
  tags?: string[];
  /** Raw wikilink targets extracted from the body (unresolved). */
  links?: string[];
  /** Source path, used to resolve wikilinks by path. */
  path?: string;
  /** Explicit extra fields (e.g. a Source item's source:v1 sourceKind/sourceLocation) merged into fields. */
  fields?: Record<string, unknown>;
}

/** Config that declares how a source's items project into records:v1 (the source's own declaration). */
export interface ProjectionConfig {
  /** folder -> @type (specific type appended after "KnowledgeRecord"). */
  typeByFolder?: Record<string, string>;
  /** @type when no folder match. Default "Note". */
  defaultType?: string;
  /** @context: refarm base, optionally extended by a source-owned vocab. */
  context?: { base?: string; vocab?: string | Record<string, unknown> };
  serialization?: {
    /** which frontmatter keys become record fields. Default ["title", "status", "tags"]. */
    fieldsFromFrontmatter?: string[];
    /** preserve the raw folder under this field key (e.g. "folder"). */
    preserveFolderAs?: string;
  };
  /** sourceRefs prefix; each record gets `${sourceRefPrefix}:${id}`. Default "content". */
  sourceRefPrefix?: string;
}

/** records:v1 base JSON-LD context, owned by the records contract. */
export const RECORDS_BASE_CONTEXT = "https://refarm.dev/contexts/records/v1";
```

- [ ] **Step 4: Install + verify types compile**

Run: `pnpm install --filter @refarm.dev/content-projection` then `pnpm --filter @refarm.dev/content-projection type-check`
Expected: install links the workspace dep; type-check reports no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/content-projection
git commit -m "feat(content-projection): scaffold package + input types"
```

---

### Task 2: `parseFrontmatter`

**Files:**
- Create: `packages/content-projection/src/frontmatter.ts`
- Test: `packages/content-projection/src/frontmatter.test.ts`

**Interfaces:**
- Produces: `parseFrontmatter(text: string) => { data: Record<string, unknown>; body: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/frontmatter.test.ts
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("splits YAML frontmatter from the body", () => {
    const text = "---\ntitle: Hello\ntags: [a, b]\n---\nBody text [[Other]].";
    const { data, body } = parseFrontmatter(text);
    expect(data).toMatchObject({ title: "Hello", tags: ["a", "b"] });
    expect(body.trim()).toBe("Body text [[Other]].");
  });

  it("returns empty data and the whole text when there is no frontmatter", () => {
    const { data, body } = parseFrontmatter("Just body.");
    expect(data).toEqual({});
    expect(body.trim()).toBe("Just body.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @refarm.dev/content-projection test`
Expected: FAIL — `parseFrontmatter` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/frontmatter.ts
import matter from "gray-matter";

/** Split YAML frontmatter from the body. Wraps gray-matter into a records-neutral shape. */
export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const parsed = matter(text);
  return { data: (parsed.data ?? {}) as Record<string, unknown>, body: parsed.content };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @refarm.dev/content-projection test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/content-projection/src/frontmatter.ts packages/content-projection/src/frontmatter.test.ts
git commit -m "feat(content-projection): parseFrontmatter (gray-matter wrapper)"
```

---

### Task 3: `extractWikilinks` + `resolveWikilinks`

**Files:**
- Create: `packages/content-projection/src/wikilinks.ts`
- Test: `packages/content-projection/src/wikilinks.test.ts`

**Interfaces:**
- Consumes: `ContentItem` from `./types.js`.
- Produces: `extractWikilinks(body: string) => string[]`; `resolveWikilinks(items: ContentItem[]) => ContentItem[]`
  (each item's `links` replaced by resolved ids — dangling and self dropped, sorted).

- [ ] **Step 1: Write the failing test**

```ts
// src/wikilinks.test.ts
import { describe, expect, it } from "vitest";
import { extractWikilinks, resolveWikilinks } from "./wikilinks.js";
import type { ContentItem } from "./types.js";

describe("extractWikilinks", () => {
  it("extracts targets, ignoring the display alias", () => {
    expect(extractWikilinks("see [[Alpha]] and [[Beta|the beta]]")).toEqual(["Alpha", "Beta"]);
  });
  it("returns [] when there are no links", () => {
    expect(extractWikilinks("no links here")).toEqual([]);
  });
});

describe("resolveWikilinks", () => {
  it("resolves targets to ids by title, drops dangling and self", () => {
    const items: ContentItem[] = [
      { id: "a", title: "Alpha", links: ["Beta", "Ghost", "Alpha"] },
      { id: "b", title: "Beta", links: [] },
    ];
    const resolved = resolveWikilinks(items);
    expect(resolved.find((i) => i.id === "a")?.links).toEqual(["b"]);
    expect(resolved.find((i) => i.id === "b")?.links).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @refarm.dev/content-projection test`
Expected: FAIL — `extractWikilinks`/`resolveWikilinks` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/wikilinks.ts
import type { ContentItem } from "./types.js";

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;

/** Slugify a wikilink target/title into a comparable key (matches the vault-seed reference). */
function slugify(value: string): string {
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Extract wikilink targets from a body, ignoring the `|display` alias. */
export function extractWikilinks(body: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, "g");
  while ((match = re.exec(body)) !== null) links.push(match[1].trim());
  return links;
}

/** Resolve each item's raw wikilink targets to ids (by title/id/path), dropping dangling and self. */
export function resolveWikilinks(items: ContentItem[]): ContentItem[] {
  const lookup = new Map<string, string>();
  const add = (key: string | undefined, id: string): void => {
    if (!key) return;
    const k = String(key).toLowerCase();
    if (!lookup.has(k)) lookup.set(k, id);
    const s = slugify(String(key)).toLowerCase();
    if (!lookup.has(s)) lookup.set(s, id);
  };
  for (const item of items) {
    add(item.title, item.id);
    add(item.id, item.id);
    if (item.path) add(item.path.replace(/\.mdx?$/, ""), item.id);
  }
  return items.map((item) => {
    const resolved = new Set<string>();
    for (const target of item.links ?? []) {
      const t = String(target).replace(/\.mdx?$/, "").trim();
      const id = lookup.get(t.toLowerCase()) ?? lookup.get(slugify(t).toLowerCase());
      if (id && id !== item.id) resolved.add(id);
    }
    return { ...item, links: [...resolved].sort((a, b) => a.localeCompare(b, "pt")) };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @refarm.dev/content-projection test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/content-projection/src/wikilinks.ts packages/content-projection/src/wikilinks.test.ts
git commit -m "feat(content-projection): extract + resolve wikilinks"
```

---

### Task 4: `projectContentToRecords`

**Files:**
- Create: `packages/content-projection/src/project.ts`
- Test: `packages/content-projection/src/project.test.ts`

**Interfaces:**
- Consumes: `ContentItem`, `ProjectionConfig`, `RECORDS_BASE_CONTEXT` from `./types.js`; `KnowledgeRecord`,
  `CURRENT_RECORD_SCHEMA_VERSION`, `computeRecordContentHash` from `@refarm.dev/records-contract-v1`.
- Produces: `projectContentToRecords(items: ContentItem[], config?: ProjectionConfig) => KnowledgeRecord[]`
  (fully stamped: `schemaVersion` + `contentHash`).

- [ ] **Step 1: Write the failing test**

```ts
// src/project.test.ts
import { describe, expect, it } from "vitest";
import { projectContentToRecords } from "./project.js";
import type { ContentItem, ProjectionConfig } from "./types.js";

const config: ProjectionConfig = {
  typeByFolder: { "20 - Projetos": "Project", fontes: "Source" },
  defaultType: "Note",
  serialization: { fieldsFromFrontmatter: ["title", "status", "tags"], preserveFolderAs: "folder" },
};

describe("projectContentToRecords", () => {
  it("maps folder->@type, frontmatter->fields, links->relations, and stamps the record", () => {
    const items: ContentItem[] = [
      { id: "p1", title: "Proj", folder: "20 - Projetos", status: "active", tags: ["x"], links: ["n1"] },
      { id: "n1", title: "Note one", folder: "40 - Recursos" },
    ];
    const [rec] = projectContentToRecords(items, config);
    expect(rec["@type"]).toEqual(["KnowledgeRecord", "Project"]);
    expect(rec.fields).toMatchObject({ title: "Proj", status: "active", tags: ["x"], folder: "20 - Projetos" });
    expect(rec.relations).toEqual([{ type: "links", target: "n1" }]);
    expect(rec.schemaVersion).toBe(1);
    expect(typeof rec.contentHash).toBe("string");
    expect(rec.contentHash.length).toBeGreaterThan(0);
  });

  it("merges an item's explicit fields (non-note vocab) into fields", () => {
    const items: ContentItem[] = [
      { id: "f1", title: "Feed", folder: "fontes", fields: { sourceKind: "feed", sourceLocation: "http://x/rss" } },
    ];
    const [rec] = projectContentToRecords(items, config);
    expect(rec["@type"]).toEqual(["KnowledgeRecord", "Source"]);
    expect(rec.fields).toMatchObject({ sourceKind: "feed", sourceLocation: "http://x/rss" });
  });

  it("falls back to defaultType and a title from id", () => {
    const [rec] = projectContentToRecords([{ id: "loose" }], config);
    expect(rec["@type"]).toEqual(["KnowledgeRecord", "Note"]);
    expect(rec.fields.title).toBe("loose");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @refarm.dev/content-projection test`
Expected: FAIL — `projectContentToRecords` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/project.ts
import {
  CURRENT_RECORD_SCHEMA_VERSION,
  computeRecordContentHash,
  type KnowledgeRecord,
} from "@refarm.dev/records-contract-v1";
import { RECORDS_BASE_CONTEXT, type ContentItem, type ProjectionConfig } from "./types.js";

/** Project a single item into a structural records:v1 record (unstamped). */
function itemToStructuralRecord(item: ContentItem, config: ProjectionConfig): Omit<KnowledgeRecord, "schemaVersion" | "contentHash"> {
  const type = (config.typeByFolder ?? {})[item.folder ?? ""] ?? config.defaultType ?? "Note";

  const ctx = config.context ?? {};
  const base = ctx.base ?? RECORDS_BASE_CONTEXT;
  const context = ctx.vocab ? [base, ctx.vocab] : base;

  const ser = config.serialization ?? {};
  const fieldKeys = ser.fieldsFromFrontmatter ?? ["title", "status", "tags"];
  const fields: Record<string, unknown> = {};
  for (const key of fieldKeys) fields[key] = (item as Record<string, unknown>)[key] ?? null;
  if (fields.title == null) fields.title = item.title ?? item.id;
  if (ser.preserveFolderAs) fields[ser.preserveFolderAs] = item.folder ?? null;
  if (item.fields && typeof item.fields === "object") Object.assign(fields, item.fields);

  const prefix = config.sourceRefPrefix ?? "content";
  return {
    id: item.id,
    "@type": ["KnowledgeRecord", type],
    "@context": context as KnowledgeRecord["@context"],
    fields,
    sections: [],
    relations: (item.links ?? []).map((target) => ({ type: "links", target })),
    sourceRefs: [`${prefix}:${item.id}`],
    review: { state: item.status ?? "draft" },
  };
}

/** Project content items into stamped, records:v1-shaped records (config-driven). */
export function projectContentToRecords(items: ContentItem[], config: ProjectionConfig = {}): KnowledgeRecord[] {
  return items.map((item) => {
    const record = {
      ...itemToStructuralRecord(item, config),
      schemaVersion: CURRENT_RECORD_SCHEMA_VERSION,
      contentHash: "",
    } as KnowledgeRecord;
    record.contentHash = computeRecordContentHash(record);
    return record;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @refarm.dev/content-projection test`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add packages/content-projection/src/project.ts packages/content-projection/src/project.test.ts
git commit -m "feat(content-projection): projectContentToRecords (folder->type, fields, relations, stamped)"
```

---

### Task 5: Output-validates-`records-contract-v1` + exports + README + build

**Files:**
- Create: `packages/content-projection/src/conformance.test.ts`
- Create: `packages/content-projection/src/index.ts`
- Create: `packages/content-projection/README.md`

**Interfaces:**
- Consumes: `projectContentToRecords` from `./project.js`; `RECORDS_MANIFEST_VERSION`,
  `createReferenceRecordsProvider` from `@refarm.dev/records-contract-v1`.
- Produces: the package public surface (re-exports of types + the four functions).

- [ ] **Step 1: Write the conformance test (the pipeline output validates the contract)**

```ts
// src/conformance.test.ts
import { describe, expect, it } from "vitest";
import { RECORDS_MANIFEST_VERSION, createReferenceRecordsProvider } from "@refarm.dev/records-contract-v1";
import { parseFrontmatter } from "./frontmatter.js";
import { extractWikilinks, resolveWikilinks } from "./wikilinks.js";
import { projectContentToRecords } from "./project.js";
import type { ContentItem, ProjectionConfig } from "./types.js";

const config: ProjectionConfig = {
  typeByFolder: { notes: "Note" },
  serialization: { fieldsFromFrontmatter: ["title", "status", "tags"], preserveFolderAs: "folder" },
};

describe("content-projection pipeline conforms to records:v1", () => {
  it("frontmatter -> wikilinks -> projection produces a manifest the reference provider validates", () => {
    const files: Record<string, string> = {
      alpha: "---\ntitle: Alpha\nstatus: active\n---\nLinks to [[Beta]].",
      beta: "---\ntitle: Beta\n---\nNo links.",
    };
    const items: ContentItem[] = Object.entries(files).map(([id, text]) => {
      const { data, body } = parseFrontmatter(text);
      return {
        id,
        title: (data.title as string) ?? id,
        folder: "notes",
        status: (data.status as string) ?? null,
        links: extractWikilinks(body),
      };
    });
    const records = projectContentToRecords(resolveWikilinks(items), config);

    const manifest = { manifestVersion: RECORDS_MANIFEST_VERSION, records };
    const result = createReferenceRecordsProvider().validate(manifest);
    expect(result.ok, JSON.stringify(result.failures)).toBe(true);
    expect(records.find((r) => r.id === "alpha")?.relations).toEqual([{ type: "links", target: "beta" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `pnpm --filter @refarm.dev/content-projection test`
Expected: PASS once `src/index.js` resolves the imports (the functions already exist from Tasks 2–4). If the
manifest fails validation, fix the projection to satisfy `records-contract-v1` before proceeding — do not
weaken the assertion.

- [ ] **Step 3: Write `src/index.ts`**

```ts
export * from "./types.js";
export { parseFrontmatter } from "./frontmatter.js";
export { extractWikilinks, resolveWikilinks } from "./wikilinks.js";
export { projectContentToRecords } from "./project.js";
```

- [ ] **Step 4: Write `README.md`**

```markdown
# @refarm.dev/content-projection

Generic MD/MDX -> `records:v1` projection: `parseFrontmatter`, `extractWikilinks`, `resolveWikilinks`, and
`projectContentToRecords` (config-driven folder->@type, frontmatter->fields, wikilinks->relations). Reuses
`@refarm.dev/records-contract-v1` (no new contract); composes with any `source-*` adapter for acquisition.
See `docs/superpowers/specs/2026-07-02-content-projection-md-mdx-design.md`.
```

- [ ] **Step 5: Build + full test + package validation**

Run: `pnpm --filter @refarm.dev/content-projection build && pnpm --filter @refarm.dev/content-projection test`
Expected: build emits `dist/`; all tests PASS.

Run: `node scripts/validate-packages.mjs`
Expected: the new package conforms (buildable); EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add packages/content-projection/src/conformance.test.ts packages/content-projection/src/index.ts packages/content-projection/README.md
git commit -m "feat(content-projection): pipeline conforms to records:v1 + public exports; package buildable"
```

---

## Self-Review

- **Spec coverage (Unit 1):** `parseFrontmatter` → Task 2; `extractWikilinks`/`resolveWikilinks` → Task 3;
  `projectContentToRecords` (folder→type, frontmatter→fields, links→relations, config-driven, explicit-fields
  merge) → Task 4; output-validates-`records-contract-v1` → Task 5. Contract reuse (no new contract) is
  honored — the package depends on `records-contract-v1` and validates through its reference provider.
- **Out of scope (correctly deferred):** the `ds-astro` embed set and the `@astrojs/mdx` wiring + `apps/site`
  proof page are Units 2–3 in the design, planned separately. The vault-seed convergence onto this block (the
  second-consumer proof) is a downstream follow-on, not part of this package plan.
- **Placeholder scan:** none — every code step has full code; every run step has an exact command + expected
  result. The one instruction-by-reference (Task 1 Step 2, `license`/workspace conventions from `source-web`)
  points to an exact source file, not a vague "configure appropriately".
- **Type consistency:** `ContentItem`/`ProjectionConfig` (Task 1) are consumed unchanged in Tasks 3–5;
  `projectContentToRecords(items, config) => KnowledgeRecord[]` is stable across Tasks 4–5; `KnowledgeRecord`,
  `CURRENT_RECORD_SCHEMA_VERSION`, `computeRecordContentHash`, `RECORDS_MANIFEST_VERSION`,
  `createReferenceRecordsProvider` are the real `records-contract-v1` exports (verified against its `index.ts`).
