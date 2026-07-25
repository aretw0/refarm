import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWaLink, fillTemplate, normalizePhone, orderLink } from "../src/index.mjs";

test("normalizePhone keeps only digits (wa.me wants the bare international number)", () => {
	assert.equal(normalizePhone("+55 (11) 91234-5678"), "5511912345678");
	assert.equal(normalizePhone("5511912345678"), "5511912345678");
	assert.equal(normalizePhone(""), "");
	assert.equal(normalizePhone(undefined), "");
});

test("buildWaLink builds the wa.me URL, encoding the message", () => {
	assert.equal(buildWaLink({ phone: "5511912345678" }), "https://wa.me/5511912345678");
	assert.equal(
		buildWaLink({ phone: "+55 11 91234-5678", text: "Oi! Tudo bem?" }),
		"https://wa.me/5511912345678?text=Oi!%20Tudo%20bem%3F",
	);
});

test("buildWaLink requires a number", () => {
	assert.throws(() => buildWaLink({ phone: "" }), /phone number is required/);
	assert.throws(() => buildWaLink({}), /phone number is required/);
});

test("fillTemplate fills placeholders and leaves unknown ones verbatim", () => {
	assert.equal(fillTemplate("Quero {qty}x {produto}", { qty: 2, produto: "brigadeiro" }), "Quero 2x brigadeiro");
	// unknown placeholder is visible, not dropped
	assert.equal(fillTemplate("Total: {total}", {}), "Total: {total}");
});

test("orderLink assembles the message and the link together (the shop case)", () => {
	const link = orderLink({
		phone: "55 11 91234-5678",
		template: "Oi! Quero {qty}x {produto} 🍬",
		values: { qty: 2, produto: "brigadeiro" },
	});
	assert.match(link, /^https:\/\/wa\.me\/5511912345678\?text=/);
	// decode round-trips the assembled message
	const text = decodeURIComponent(link.split("text=")[1]);
	assert.equal(text, "Oi! Quero 2x brigadeiro 🍬");
});
