/**
 * wa-link — build a WhatsApp click-to-chat (wa.me) deep link and its prefilled
 * message from a number and a template.
 *
 * The primitive a static shop uses to turn a product form into a "buy on
 * WhatsApp" link with the order already written — no backend, no database: the
 * order lands in the seller's WhatsApp. Pure and zero-dependency, so it runs in
 * the browser (where the link is clicked) and in Node (where a site is built).
 */

/** wa.me wants the FULL international number, digits only (no +, spaces, dashes). */
export function normalizePhone(raw) {
	return String(raw ?? "").replace(/\D/g, "");
}

/**
 * A wa.me deep link. `phone` is the recipient's full international number (e.g.
 * "55 11 91234-5678"); `text` (optional) is prefilled into the chat. Throws when
 * the number is empty — a link with no recipient is never useful.
 */
export function buildWaLink({ phone, text = "" } = {}) {
	const number = normalizePhone(phone);
	if (!number) throw new Error("wa-link: a phone number is required");
	const url = `https://wa.me/${number}`;
	return text ? `${url}?text=${encodeURIComponent(text)}` : url;
}

/**
 * Fill a message template's {placeholders} from `values`. An unknown placeholder
 * is left verbatim (a half-filled form is visible, not silently dropped). Pure.
 */
export function fillTemplate(template, values = {}) {
	return String(template ?? "").replace(/\{(\w+)\}/g, (match, key) =>
		Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
	);
}

/**
 * The common case: a wa.me link whose message is assembled from a template plus
 * form values. e.g.
 *   orderLink({ phone: "5511912345678",
 *               template: "Oi! Quero {qty}x {produto} 🍬",
 *               values: { qty: 2, produto: "brigadeiro" } })
 */
export function orderLink({ phone, template, values = {} } = {}) {
	return buildWaLink({ phone, text: fillTemplate(template ?? "", values) });
}
