import { createHash } from "node:crypto";

import type { WebFetchRequest, WebSourceSessionEvidence } from "./types.js";

/**
 * The generic ATTACHMENT block — download a binary asset from an authenticated source under a
 * SIZE + TYPE policy, and describe what to do with it (materialize the bytes, or record a
 * placeholder with a reason). This is the piece a scraper needs beyond text bodies: an ALM
 * artifact, a wiki page, a ticket all carry attachments the text fetch can't retrieve.
 *
 * The substrate ships the POLICY (pure: extension deny-set + size cap) and the download
 * orchestration (content-length pre-check → fetch bytes → actual-size check → hash); the
 * consumer brings the binary fetch driver (a browser-cookie download, an OSLC binary GET) and
 * decides WHERE to persist the bytes (this block stays filesystem-agnostic — it returns the
 * bytes + a fingerprint; the caller writes them).
 */

/** Why an attachment was not materialized. */
export type AttachmentSkipReason = "size_limit" | "unsupported_type";

/** The policy decision for one attachment: its canonical extension + whether to download. */
export interface AttachmentPolicyDecision {
	extension: string;
	allowed: boolean;
	skipReason?: AttachmentSkipReason;
}

/** Default cap: 5 MiB — the same the operational scraper uses; a big binary is a placeholder. */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Extensions never worth materializing (pure binary / DB / executables) — a placeholder note
 * is kept instead. Office/PDF are NOT here: they're size-gated only (a renderer may process
 * them). Mirrors the operational scraper's NON_RENDERABLE set. */
const NON_RENDERABLE_EXTENSIONS = new Set([
	".zip",
	".exe",
	".dll",
	".so",
	".dylib",
	".bin",
	".jar",
	".class",
	".pyc",
	".o",
	".mdb",
	".accdb",
	".sqlite",
	".sqlite3",
	".db",
	".xlsx",
	".xls",
	".xlsm",
	".xlsb",
	".ods",
]);

const MIME_EXTENSION: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/gif": ".gif",
	"image/svg+xml": ".svg",
	"image/webp": ".webp",
	"application/pdf": ".pdf",
	"application/zip": ".zip",
	"text/plain": ".txt",
	"text/markdown": ".md",
	"text/html": ".html",
	"application/json": ".json",
	"application/octet-stream": ".bin",
};

/** Infer a canonical file extension from the MIME type, else from the title/filename, else
 * `.bin`. Lowercased, dot-prefixed. PURE. */
export function extensionFromMimeOrTitle(mimeType: string | undefined, title: string): string {
	const mime = (mimeType ?? "").split(";")[0]?.trim().toLowerCase();
	if (mime && MIME_EXTENSION[mime]) return MIME_EXTENSION[mime];
	const dot = title.lastIndexOf(".");
	if (dot >= 0 && dot < title.length - 1) {
		const ext = title.slice(dot).toLowerCase();
		if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
	}
	return ".bin";
}

/** Decide whether to materialize an attachment: unsupported type → skip; over the size cap →
 * skip; else allow. PURE — no I/O, so a caller can decide before downloading (from a
 * content-length header) and again after (from the actual byte count). */
export function resolveAttachmentPolicy(args: {
	mimeType?: string;
	title: string;
	sizeBytes?: number;
	maxBytes?: number;
}): AttachmentPolicyDecision {
	const extension = extensionFromMimeOrTitle(args.mimeType, args.title);
	const maxBytes = args.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
	if (NON_RENDERABLE_EXTENSIONS.has(extension)) {
		return { extension, allowed: false, skipReason: "unsupported_type" };
	}
	if (typeof args.sizeBytes === "number" && Number.isFinite(args.sizeBytes) && args.sizeBytes > maxBytes) {
		return { extension, allowed: false, skipReason: "size_limit" };
	}
	return { extension, allowed: true };
}

/** What a binary fetch driver returns: the bytes + media type + an optional pre-known size
 * (from a HEAD/content-length), so the policy can reject a huge asset before buffering it. */
export interface BinaryFetchResult {
	bytes: Uint8Array;
	mediaType: string;
	/** The declared size (content-length), if the driver knows it up front. */
	declaredSize?: number;
}

/** The injected BINARY fetch driver — how an authenticated binary GET is performed (a browser
 * cookie download, an OSLC binary fetch). Parallel to WebFetchDriver (which returns a string
 * body), so text and binary retrieval stay separate and neither breaks the other. */
export type BinaryFetchDriver = (request: WebFetchRequest) => Promise<BinaryFetchResult>;

/** The outcome of a download: materialized (bytes to persist + fingerprint) or a placeholder
 * (skipped, with the reason). Mirrors the operational scraper's AttachmentAsset shape. */
export interface AttachmentResult {
	kind: "materialized" | "placeholder";
	sourceUri: string;
	mimeType: string;
	extension: string;
	/** The bytes to persist — present only when materialized. The caller writes them. */
	bytes?: Uint8Array;
	/** SHA-256 hex of the bytes — present only when materialized. */
	hash?: string;
	sizeBytes?: number;
	skipReason?: AttachmentSkipReason;
	/** The size cap applied at decision time (for the audit trail). */
	sizeLimitBytes?: number;
}

export interface DownloadAttachmentOptions {
	/** The authenticated session to download under. */
	session: WebSourceSessionEvidence;
	/** A human title / filename, used for extension inference and the placeholder note. */
	title: string;
	/** The binary fetch driver (injected). */
	fetcher: BinaryFetchDriver;
	/** Max bytes to materialize (default 5 MiB). */
	maxBytes?: number;
	headers?: Record<string, string>;
	attributes?: Record<string, string>;
}

/**
 * Download one attachment under the size + type policy, in ONE call. Applies the policy TWICE:
 * once on the driver's declared size (skip a huge asset without buffering), and again on the
 * ACTUAL byte count (the declared size may be absent or wrong). Materialized results carry the
 * bytes + a SHA-256 fingerprint; the caller persists them. A skipped asset is a placeholder
 * with a reason — never an error. Filesystem-agnostic by construction.
 */
export async function downloadAttachment(
	url: string,
	options: DownloadAttachmentOptions,
): Promise<AttachmentResult> {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;

	// A pre-fetch policy check needs the extension; we don't know the mime until we fetch, so
	// use the title for the type decision here and refine with the response mime after.
	const preExtension = extensionFromMimeOrTitle(undefined, options.title);
	if (NON_RENDERABLE_EXTENSIONS.has(preExtension)) {
		return {
			kind: "placeholder",
			sourceUri: url,
			mimeType: "application/octet-stream",
			extension: preExtension,
			skipReason: "unsupported_type",
			sizeLimitBytes: maxBytes,
		};
	}

	const request: WebFetchRequest = {
		url,
		session: options.session,
		...(options.headers ? { headers: options.headers } : {}),
		...(options.attributes ? { attributes: options.attributes } : {}),
	};
	const fetched = await options.fetcher(request);

	// Policy on the DECLARED size first (skip a known-huge asset — still had to open the request,
	// but a driver may stream and abort; here we already have bytes, so this is belt-and-braces).
	const declaredDecision = resolveAttachmentPolicy({
		mimeType: fetched.mediaType,
		title: options.title,
		sizeBytes: fetched.declaredSize,
		maxBytes,
	});
	const actualSize = fetched.bytes.byteLength;
	const decision = declaredDecision.allowed
		? resolveAttachmentPolicy({ mimeType: fetched.mediaType, title: options.title, sizeBytes: actualSize, maxBytes })
		: declaredDecision;

	if (!decision.allowed) {
		return {
			kind: "placeholder",
			sourceUri: url,
			mimeType: fetched.mediaType,
			extension: decision.extension,
			skipReason: decision.skipReason,
			sizeBytes: actualSize,
			sizeLimitBytes: maxBytes,
		};
	}

	const hash = createHash("sha256").update(fetched.bytes).digest("hex");
	return {
		kind: "materialized",
		sourceUri: url,
		mimeType: fetched.mediaType,
		extension: decision.extension,
		bytes: fetched.bytes,
		hash,
		sizeBytes: actualSize,
		sizeLimitBytes: maxBytes,
	};
}
