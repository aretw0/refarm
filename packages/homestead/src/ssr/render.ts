export function escapeHtml(value: unknown): string {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;");
}

export function sectionHtml(title: string, innerHtml: string): string {
	return `<section class="ds-section"><h2>${escapeHtml(title)}</h2>${innerHtml}</section>`;
}

export function gridHtml(cardsHtml: string[]): string {
	return `<div class="ds-grid">${cardsHtml.join("")}</div>`;
}

export function cardHtml(opts: {
	title: string;
	rows: string[];
	active?: boolean;
	actionsHtml?: string;
}): string {
	const active = opts.active ? ` data-active="1"` : "";
	const actions = opts.actionsHtml
		? `<div class="ds-card__actions">${opts.actionsHtml}</div>`
		: "";

	return `<div class="ds-card"${active}><div class="ds-card__title">${escapeHtml(opts.title)}</div>${opts.rows.join("")}${actions}</div>`;
}

export function tableHtml(opts: {
	headers: string[];
	rows: string[][];
}): string {
	const head = opts.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
	const body = opts.rows
		.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
		.join("");

	return `<table class="ds-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function fieldHtml(opts: {
	label: string;
	name: string;
	value?: string;
	type?: string;
}): string {
	const name = escapeHtml(opts.name);
	const type = escapeHtml(opts.type ?? "text");
	const value =
		opts.value === undefined ? "" : ` value="${escapeHtml(opts.value)}"`;

	return `<div class="ds-field"><label for="${name}">${escapeHtml(opts.label)}</label><input id="${name}" name="${name}" type="${type}"${value}></div>`;
}

export function buttonHtml(opts: {
	label: string;
	variant?: "primary" | "danger" | "ghost";
	attrs?: Record<string, string>;
}): string {
	const variant = opts.variant ?? "primary";
	const attrs = Object.entries(opts.attrs ?? {})
		.map(([key, value]) => ` ${escapeHtml(key)}="${escapeHtml(value)}"`)
		.join("");

	return `<button class="ds-btn" data-variant="${variant}"${attrs}>${escapeHtml(opts.label)}</button>`;
}

export function feedbackHtml(opts: {
	kind: "error" | "warning" | "success" | "info";
	message: string;
}): string {
	return `<div class="ds-feedback" data-kind="${opts.kind}" role="status">${escapeHtml(opts.message)}</div>`;
}

export function footerHtml(text: string): string {
	return `<footer class="ds-footer">${escapeHtml(text)}</footer>`;
}
