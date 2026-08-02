import {
	buttonHtml,
	cardHtml,
	escapeHtml,
	feedbackHtml,
	gridHtml,
	sectionHtml,
} from "@refarm.dev/ds/html";
import type { MessageTranslator } from "@refarm.dev/localization-v1";
import type { AdmittedOperation } from "./wire.js";

export function renderOperationSurfaceHtml(input: {
	readonly messages: MessageTranslator;
	readonly operations?: readonly AdmittedOperation[];
	readonly status?: string;
	readonly statusKind?: "error" | "warning" | "success" | "info";
}): string {
	const refresh = buttonHtml({
		label: input.messages.t("refresh"),
		variant: "ghost",
		attrs: { type: "button", "data-operation-refresh": "" },
	});
	const operations = input.operations;
	const status =
		input.status !== undefined || operations === undefined
			? feedbackHtml({
					kind: input.statusKind ?? "info",
					message: input.status ?? input.messages.t("loading"),
				})
			: "";
	const content = operations
		? operations.length === 0
			? feedbackHtml({ kind: "info", message: input.messages.t("empty") })
			: gridHtml(
					operations.map((operation) =>
						cardHtml({
							title: operation.id,
							rows: [
								`<p class="ds-operation-command"><code>${escapeHtml(operation.command)}</code></p>`,
								...(operation.why ? [`<p>${escapeHtml(operation.why)}</p>`] : []),
								`<div class="ds-feedback" role="status" aria-live="polite" data-operation-state></div>`,
							],
							actionsHtml: buttonHtml({
								label: input.messages.t("start"),
								attrs: { type: "button", "data-operation-start": operation.id },
							}),
						}),
					),
				)
		: "";
	return sectionHtml(
		input.messages.t("title"),
		`<div class="ds-operation-toolbar">${refresh}</div><div data-operation-overview>${status}</div><div data-operation-catalog>${content}</div>`,
	);
}
