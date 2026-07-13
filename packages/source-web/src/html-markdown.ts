/**
 * The generic HTML→MARKDOWN block — turn a fetched rich-text HTML body into structured
 * Markdown, preserving the shape a naive tag-strip destroys: headings, lists, links,
 * tables, code, emphasis. This is the piece a scraper needs to render an ALM artifact's
 * rich description (a table of acceptance criteria, links to other requirements) as a
 * legible note instead of a wall of collapsed text.
 *
 * The substrate ships a MINIMAL, DEPS-LIGHT converter (no DOM, a tolerant tokenizer over
 * the tags that carry meaning) AND an injection seam: a consumer that wants full GFM
 * fidelity (nested tables, task lists) can plug Turndown/turndown-plugin-gfm as the
 * `converter` and the rest of the pipeline (script/style removal, whitespace normalization,
 * a main-content selector) is reused. Neither owns the dep the other needs.
 */

/** A pluggable HTML→Markdown converter. The substrate's `minimalHtmlToMarkdown` is the
 * default; a consumer may inject Turndown for richer fidelity. Receives the CLEANED inner
 * HTML (scripts/styles already removed) and returns Markdown. */
export type HtmlToMarkdownConverter = (html: string) => string;

export interface HtmlToMarkdownOptions {
	/** The converter to use. Default: the built-in `minimalHtmlToMarkdown`. */
	converter?: HtmlToMarkdownConverter;
	/** If set, only the FIRST match of this substring-delimited region is converted — a coarse
	 * "main content" selector for pages wrapped in navigation chrome. When the markers are not
	 * found, the whole (cleaned) body is used. Given as `[openTag, closeTag]` literal fragments,
	 * e.g. `['<article', '</article>']`. Injected so no CSS-selector engine is needed. */
	mainRegion?: [open: string, close: string];
}

/** Remove `<script>`/`<style>`/`<!-- comments -->` and their content — never meaningful in a
 * note, and a source of noise/injection. Case-insensitive, tolerant of attributes. */
export function stripNonContentHtml(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "");
}

/** Extract the first `[open…close]` region if both markers are present, else return the input
 * unchanged. A coarse main-content narrowing without a DOM. */
function narrowToRegion(html: string, region: [string, string]): string {
	const [open, close] = region;
	const start = html.indexOf(open);
	if (start < 0) return html;
	const end = html.indexOf(close, start);
	if (end < 0) return html;
	return html.slice(start, end + close.length);
}

const NAMED_ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&apos;": "'",
	"&nbsp;": " ",
};

/** Decode the common named + numeric HTML entities. */
export function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&[a-z]+;|&#39;/gi, (m) => NAMED_ENTITIES[m.toLowerCase()] ?? m);
}

/** Collapse runs of blank lines to at most one, trim trailing spaces, and trim the ends. */
function normalizeMarkdownWhitespace(md: string): string {
	return md
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}

/** Render one `<table>` element (HTML) to a GFM table. Tolerant: cells may lack `<th>`, rows
 * may be ragged (padded to the widest). Returns "" if no rows are found. */
function tableToGfm(tableHtml: string): string {
	const rows: string[][] = [];
	const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
	let rowMatch: RegExpExecArray | null;
	while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
		const cells: string[] = [];
		const cellRe = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
		let cellMatch: RegExpExecArray | null;
		while ((cellMatch = cellRe.exec(rowMatch[1]!)) !== null) {
			cells.push(inlineToText(cellMatch[2]!).replace(/\|/g, "\\|").trim());
		}
		if (cells.length > 0) rows.push(cells);
	}
	if (rows.length === 0) return "";
	const width = Math.max(...rows.map((r) => r.length));
	const pad = (r: string[]): string => `| ${[...r, ...Array(width - r.length).fill("")].join(" | ")} |`;
	const header = rows[0]!;
	const sep = `| ${Array(width).fill("---").join(" | ")} |`;
	const body = rows.slice(1).map(pad);
	return [pad(header), sep, ...body].join("\n");
}

/** Reduce inline markup (`<a>`, `<strong>`, `<em>`, `<code>`, `<br>`) to Markdown, strip any
 * remaining tags, and decode entities. Block structure is handled by the caller. */
function inlineToText(html: string): string {
	return decodeHtmlEntities(
		html
			.replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_, href, label) => {
				const text = inlineToText(label).trim();
				return href ? `[${text || href}](${href})` : text;
			})
			.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_, _tag, inner) => `**${inlineToText(inner).trim()}**`)
			.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_, _tag, inner) => `*${inlineToText(inner).trim()}*`)
			.replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, (_, inner) => `\`${inlineToText(inner).trim()}\``)
			.replace(/<br\s*\/?>/gi, "  \n")
			.replace(/<[^>]+>/g, ""),
	);
}

/** The built-in, deps-light HTML→Markdown converter. Handles the block elements that carry
 * meaning in a rich-text field: headings, paragraphs, unordered/ordered lists, tables, block
 * code, blockquotes. Not a full HTML parser — a tolerant, structure-preserving reducer that
 * beats a flat tag-strip and needs no dependency. Inject Turndown via `converter` for more. */
export function minimalHtmlToMarkdown(html: string): string {
	let md = html;

	// Block code first (its inner content must not be inline-processed).
	md = md.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_, inner) => {
		const code = decodeHtmlEntities(inner.replace(/<[^>]+>/g, ""));
		return `\n\n\`\`\`\n${code.replace(/^\n+|\n+$/g, "")}\n\`\`\`\n\n`;
	});

	// Tables → GFM.
	md = md.replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi, (m) => {
		const gfm = tableToGfm(m);
		return gfm ? `\n\n${gfm}\n\n` : "";
	});

	// Headings.
	md = md.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_, level, inner) => {
		return `\n\n${"#".repeat(Number(level))} ${inlineToText(inner).trim()}\n\n`;
	});

	// List items — unordered and ordered both become "- " here (ordinal reconstruction is not
	// worth a stateful parser for a note; the structure survives, which is the point).
	md = md.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (_, inner) => `\n- ${inlineToText(inner).trim()}`);
	md = md.replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n\n");

	// Blockquotes.
	md = md.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote\s*>/gi, (_, inner) => {
		return `\n\n> ${inlineToText(inner).trim().replace(/\n/g, "\n> ")}\n\n`;
	});

	// Paragraphs and line breaks.
	md = md.replace(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi, (_, inner) => `\n\n${inlineToText(inner).trim()}\n\n`);
	md = md.replace(/<div\b[^>]*>/gi, "\n").replace(/<\/div\s*>/gi, "\n");

	// Whatever inline markup remains outside a block.
	md = inlineToText(md);

	return normalizeMarkdownWhitespace(md);
}

/**
 * Convert a fetched HTML body to Markdown: remove non-content (scripts/styles/comments),
 * optionally narrow to a main region, then run the converter (built-in by default, or an
 * injected Turndown). One call, deps-light, and the converter is swappable for fidelity.
 */
export function htmlToMarkdown(html: string, options: HtmlToMarkdownOptions = {}): string {
	const cleaned = stripNonContentHtml(html);
	const scoped = options.mainRegion ? narrowToRegion(cleaned, options.mainRegion) : cleaned;
	const convert = options.converter ?? minimalHtmlToMarkdown;
	return normalizeMarkdownWhitespace(convert(scoped));
}
