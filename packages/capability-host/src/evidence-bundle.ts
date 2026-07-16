import { createHash } from "node:crypto";

import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
} from "./index.js";

/**
 * EVIDENCE BUNDLE — the shared shape behind every example's `report` verb: build a set of files
 * (the record material a writeup embeds), optionally write them under `--apply`, and return an
 * envelope. Each example hand-rolled this identically (a `ReportFile`, a `writeReport` injector,
 * the same `--apply`/`written`/`files` envelope); this is the one implementation they all consume.
 *
 * It also adds what a hand-rolled report lacked: an EXECUTION STAMP. Every produced file is bound
 * to the SHA-256 of its exact bytes, with a timestamp and an environment label, and (under
 * `--apply`) a sidecar `evidence.json` manifest records all of them. That turns "here is a file I
 * wrote" into "here is a file, and here is the fingerprint proving these are the bytes the run
 * produced" — real evidence, not a claim.
 */

/** One produced file: a relative path + its content (markdown, svg, or json). PURE. */
export interface EvidenceFile {
	path: string;
	content: string;
}

/** One file's execution stamp: its path, byte length, and the SHA-256 of its content. */
export interface EvidenceStamp {
	path: string;
	bytes: number;
	sha256: string;
}

export interface EvidenceBundleCapabilityOptions {
	/** The verb name (e.g. "report", "requirements-report"). */
	name: string;
	summary: string;
	/** The host command, for the nextCommand hints (e.g. "dgk"). */
	command: string;
	/** The verb's HTTP route path. */
	httpPath: string;
	/** Surface renderers (tui section, ide command, …) — passed through unchanged. */
	renderers?: CapabilityDescriptor["renderers"];
	/** Produce the evidence files (the example's domain content). May be async. */
	build: () => EvidenceFile[] | Promise<EvidenceFile[]>;
	/** Persist a file (injected node fs writer). Absent → report-only, nothing written. */
	writeFile?: (relativePath: string, content: string) => void | Promise<void>;
	/** The verb to suggest after a successful `--apply` (e.g. "extension-graph"). */
	nextVerb?: string;
	/** Where the `evidence.json` stamp manifest is written (relative). Default: alongside the files. */
	stampPath?: string;
	/** Injected clock for the stamp (ISO). Default: Date.now-based. */
	now?: () => string;
	/** Environment label recorded in the stamp. Default: "local". */
	environment?: string;
}

function sha256(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Derive the stamp manifest path from the files' common directory (`.dgk/report/evidence.json`). */
function defaultStampPath(files: readonly EvidenceFile[]): string | undefined {
	const first = files[0]?.path;
	if (!first) return undefined;
	const slash = first.lastIndexOf("/");
	const dir = slash >= 0 ? first.slice(0, slash) : "";
	return dir ? `${dir}/evidence.json` : "evidence.json";
}

/**
 * Build the shared `report`-style verb: files + `--apply` + an execution-stamped envelope. The
 * three examples pass their own `build`, name, and renderers; everything else is one implementation.
 */
export function createEvidenceBundleCapability(
	options: EvidenceBundleCapabilityOptions,
): CapabilityDescriptor {
	const now = options.now ?? (() => new Date().toISOString());
	const environment = options.environment ?? "local";
	return {
		name: options.name,
		summary: options.summary,
		options: [{ name: "apply", kind: "boolean", summary: "Write the evidence files to disk (else report only)" }],
		transports: { http: { path: options.httpPath } },
		...(options.renderers ? { renderers: options.renderers } : {}),
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const files = await options.build();
			const apply = input.options?.apply === true;
			const stampedAt = now();
			const stamps: EvidenceStamp[] = files.map((f) => ({
				path: f.path,
				bytes: f.content.length,
				sha256: sha256(f.content),
			}));

			let written = 0;
			let stampFile: string | undefined;
			if (apply && options.writeFile) {
				for (const f of files) {
					await options.writeFile(f.path, f.content);
					written += 1;
				}
				// The execution stamp: a manifest binding each produced file to the SHA-256 of its
				// bytes, plus when + where — the runtime-evidence record, made real.
				stampFile = options.stampPath ?? defaultStampPath(files);
				if (stampFile) {
					await options.writeFile(stampFile, JSON.stringify({ stampedAt, environment, files: stamps }, null, 2));
					written += 1;
				}
			}

			const markdown = files.find((f) => f.path.endsWith(".md"))?.content;
			return buildJsonSuccessEnvelope({
				command: options.name,
				operation: "report",
				nextCommand: apply
					? options.nextVerb
						? `${options.command} ${options.nextVerb}`
						: undefined
					: `${options.command} ${options.name} --apply`,
				nextCommands: apply ? [] : [`${options.command} ${options.name} --apply`],
				extra: {
					applied: apply,
					written,
					stampedAt,
					environment,
					files: stamps,
					...(stampFile ? { evidence: stampFile } : {}),
					...(apply ? {} : markdown ? { markdown } : {}),
				},
			});
		},
	};
}
