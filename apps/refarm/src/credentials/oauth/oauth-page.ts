function escapeHtml(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function renderPage(title: string, heading: string, message: string, details?: string): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#09090b;color:#fafafa;font-family:system-ui,sans-serif;text-align:center}main{max-width:520px}h1{font-size:26px;margin:0 0 10px}p{color:#a1a1aa;font-size:15px;margin:0}pre{color:#a1a1aa;font-size:13px;white-space:pre-wrap;word-break:break-word}</style>
</head><body><main>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(message)}</p>
${details ? `<pre>${escapeHtml(details)}</pre>` : ""}
</main></body></html>`;
}

export const oauthSuccessHtml = (message: string) =>
	renderPage("Authentication successful", "Authentication successful", message);

export const oauthErrorHtml = (message: string, details?: string) =>
	renderPage("Authentication failed", "Authentication failed", message, details);
