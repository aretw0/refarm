import { buttonHtml, cardHtml, escapeHtml, feedbackHtml } from "@refarm.dev/ds/html";

import type { AttendPromptView } from "./view.js";

function renderControl(view: AttendPromptView): string {
	const control = view.control;
	if (control.control === "confirm") {
		return [
			buttonHtml({
				label: control.affirm,
				attrs: {
					type: "button",
					"data-attend-answer": "true",
					...(control.default ? { "data-default": "1" } : {}),
				},
			}),
			buttonHtml({
				label: control.deny,
				variant: "ghost",
				attrs: {
					type: "button",
					"data-attend-answer": "false",
					...(!control.default ? { "data-default": "1" } : {}),
				},
			}),
		].join("");
	}
	if (control.control === "select") {
		const name = `opt-${view.id}`;
		const choices = control.choices
			.map((choice) => {
				const description = choice.description
					? `<small>${escapeHtml(choice.description)}</small>`
					: "";
				return `<label class="ds-choice"><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(choice.value)}"${choice.selected ? " checked" : ""}> <span>${escapeHtml(choice.label)}</span>${description}</label>`;
			})
			.join("");
		return `${choices}${buttonHtml({ label: "Answer", attrs: { type: "button", "data-attend-submit-select": name } })}`;
	}
	if (control.control === "text" || control.control === "secret") {
		const type = control.control === "secret" ? "password" : "text";
		const value = control.control === "text" && control.default !== null ? ` value="${escapeHtml(control.default)}"` : "";
		const placeholder =
			control.control === "text" && control.placeholder !== null
				? ` placeholder="${escapeHtml(control.placeholder)}"`
				: "";
		return `<div class="ds-field"><input data-attend-input aria-label="${escapeHtml(view.question)}" type="${type}" autocomplete="off" spellcheck="false"${value}${placeholder}></div>${buttonHtml({ label: "Answer", attrs: { type: "button", "data-attend-submit-input": "" } })}`;
	}
	return feedbackHtml({
		kind: "warning",
		message: `This node asked a kind of question this page does not know how to draw (${control.type}). Answer it at the terminal that asked.`,
	});
}

/** Project a prompt view through the shared DS; browser code only binds behaviour. */
export function renderAttendPromptHtml(view: AttendPromptView): string {
	const metadata = view.deadline ? `${view.asker} · ${view.deadline}` : view.asker;
	return cardHtml({
		title: view.question,
		attrs: { "data-attend-prompt": view.id },
		rows: [
			`<p class="ds-attend-meta">${escapeHtml(metadata)}</p>`,
			...(view.travelNotice
				? [feedbackHtml({ kind: "warning", message: `🔐 ${view.travelNotice}` })]
				: []),
			`<div class="ds-control-group" role="group" aria-label="${escapeHtml(view.question)}" data-attend-control>${renderControl(view)}</div>`,
			`<div class="ds-feedback" role="status" aria-live="polite" data-attend-verdict></div>`,
		],
	});
}
