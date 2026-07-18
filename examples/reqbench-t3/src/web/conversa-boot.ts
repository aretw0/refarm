import { renderCapabilityFormMessage } from "@refarm.dev/capability-homestead-surface";
import { mountCapabilityWebView, wireCapabilityFormDispatch } from "@refarm.dev/capability-homestead-surface/boot";
import {
	conversationTranscriptStyles,
	renderConversationTranscript,
	type ConversationMessage,
	type ConversationSender,
} from "@refarm.dev/homestead/sdk";

import { createSearchWebRegistry } from "./search-app.js";

/**
 * The CONVERSA web face — pattern B live: an assistant offers a capability as an INLINE FORM inside a
 * conversation. The transcript is the shared messenger substrate (day separators + timestamps + sender
 * identity, @refarm.dev/homestead/sdk); the form is the real `requirements-search` verb rendered by
 * renderCapabilityFormMessage (its typed inputs — a <select> of tipos, a text query). The user fills
 * and submits IN the conversation; wireCapabilityFormDispatch runs the verb and the assistant replies
 * with the result as the next message. The example writes no chat/search code — both are substrate; the
 * registry is browser-safe (search-app.ts), so this boots in a real browser with no node/WASM.
 */
const ASSISTANT: ConversationSender = { id: "assistant", name: "Assistente", kind: "agent" };
const ME: ConversationSender = { id: "me", name: "Você", kind: "operator" };

export async function bootConversa(): Promise<void> {
	await mountCapabilityWebView({
		namespace: "reqbench-t3",
		registry: createSearchWebRegistry(),
		errorLabel: "Falha ao abrir a conversa",
		view: {
			mount: "convo-mount",
			render: ({ mount, registry }) => {
				if (!document.getElementById("refarm-convo-styles")) {
					const style = document.createElement("style");
					style.id = "refarm-convo-styles";
					style.textContent = conversationTranscriptStyles();
					document.head.appendChild(style);
				}
				const now = Date.now();
				const messages: ConversationMessage[] = [
					{ sender: ASSISTANT, at: now, text: "Posso buscar requisitos por você — preencha e envie:" },
					{
						sender: ASSISTANT,
						at: now,
						text: "Formulário de busca de requisitos",
						html: renderCapabilityFormMessage(registry, "requirements-search", { submitLabel: "Buscar" }),
					},
				];
				const rerender = (): void => {
					mount.innerHTML = renderConversationTranscript(messages, { now: Date.now(), selfId: ME.id });
					mount.scrollTop = mount.scrollHeight;
				};
				rerender();
				// The user submits the inline form → the search runs → the assistant replies with the result.
				wireCapabilityFormDispatch(mount, registry, (_verb, result) => {
					messages.push({ sender: ME, at: Date.now(), text: "Busquei." });
					messages.push({ sender: ASSISTANT, at: Date.now(), text: result.message ?? "Resultado:", ...(result.html ? { html: result.html } : {}) });
					rerender();
				});
			},
		},
	});
}
