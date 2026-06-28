import { escapeHtml } from "./render.js";

export interface ShellOptions {
	title: string;
	lang?: string;
	theme?: string;
	assetBase?: string;
	bodyHtml: string;
}

export function shellHtml(opts: ShellOptions): string {
	const lang = escapeHtml(opts.lang ?? "en");
	const theme = escapeHtml(opts.theme ?? "tractor-green");
	const base = escapeHtml(opts.assetBase ?? "/_ds");

	return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<link rel="stylesheet" href="${base}/tokens.css">
<link rel="stylesheet" href="${base}/themes/${theme}.css">
<link rel="stylesheet" href="${base}/components.css">
</head>
<body data-ds-theme="${theme}">
${opts.bodyHtml}
</body>
</html>`;
}
