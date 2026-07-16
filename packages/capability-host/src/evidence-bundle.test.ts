import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createEvidenceBundleCapability, type EvidenceFile } from "./evidence-bundle.js";

const files: EvidenceFile[] = [
	{ path: ".dgk/report/thing.svg", content: "<svg>…</svg>" },
	{ path: ".dgk/report/thing.md", content: "# Title\nreal numbers" },
];

function verb(writeFile?: (p: string, c: string) => void) {
	return createEvidenceBundleCapability({
		name: "report",
		summary: "test",
		command: "dgk",
		httpPath: "/report",
		renderers: { ide: { command: "dgk.report" } },
		build: () => files,
		...(writeFile ? { writeFile } : {}),
		nextVerb: "next",
		now: () => "2026-07-16T00:00:00.000Z",
	});
}

describe("createEvidenceBundleCapability", () => {
	it("report-only mode stamps each file with sha256 and returns the markdown, writing nothing", async () => {
		let writes = 0;
		const env = (await verb(() => {
			writes += 1;
		}).run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			applied: boolean;
			files: Array<{ path: string; bytes: number; sha256: string }>;
			markdown?: string;
			stampedAt: string;
		};
		expect(env.ok).toBe(true);
		expect(env.applied).toBe(false);
		expect(writes).toBe(0); // report-only never writes
		expect(env.markdown).toContain("real numbers");
		// Each file carries the SHA-256 of its exact bytes.
		const md = env.files.find((f) => f.path.endsWith(".md"))!;
		expect(md.sha256).toBe(createHash("sha256").update("# Title\nreal numbers", "utf8").digest("hex"));
		expect(env.stampedAt).toBe("2026-07-16T00:00:00.000Z");
		// `bytes` is the UTF-8 BYTE length, not string.length: the svg fixture's "…" is 3 bytes / 1
		// UTF-16 unit, so the two differ — a real report (accented pt-BR, SVG) would be undercounted.
		const svg = env.files.find((f) => f.path.endsWith(".svg"))!;
		expect(svg.bytes).toBe(Buffer.byteLength("<svg>…</svg>", "utf8"));
		expect(svg.bytes).toBeGreaterThan("<svg>…</svg>".length);
	});

	it("--apply writes each file AND an evidence.json stamp manifest alongside", async () => {
		const written = new Map<string, string>();
		const env = (await verb((p, c) => written.set(p, c)).run({
			args: {},
			options: { apply: true },
			json: true,
		})) as unknown as { applied: boolean; written: number; evidence?: string };
		expect(env.applied).toBe(true);
		// 2 files + the evidence manifest.
		expect(env.written).toBe(3);
		expect(env.evidence).toBe(".dgk/report/evidence.json");
		expect(written.has(".dgk/report/thing.svg")).toBe(true);
		// The manifest binds every file to its fingerprint.
		const manifest = JSON.parse(written.get(".dgk/report/evidence.json")!) as {
			environment: string;
			files: Array<{ path: string; sha256: string }>;
		};
		expect(manifest.environment).toBe("local");
		expect(manifest.files).toHaveLength(2);
		expect(manifest.files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it("report-only mode omits the markdown when no .md file is produced", async () => {
		const env = (await createEvidenceBundleCapability({
			name: "report",
			summary: "test",
			command: "dgk",
			httpPath: "/report",
			build: () => [{ path: ".dgk/report/data.json", content: "{}" }],
		}).run({ args: {}, options: {}, json: true })) as unknown as { markdown?: string };
		expect(env.markdown).toBeUndefined();
	});
});
