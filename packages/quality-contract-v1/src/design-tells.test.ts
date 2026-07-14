import { describe, expect, it } from "vitest";

import { checkDesign, createDesignTellsChecker, runDesignTellsRules } from "./design-tells.js";
import { IMPECCABLE_TELLS_PROFILE } from "./impeccable-profile.js";
import type { QualityProfile } from "./types.js";

const subject = (css: string) => ({ path: "styles.css", css });

describe("design-tells — AI-slop bans", () => {
	it("flags a thick colored side-stripe border", () => {
		const f = checkDesign(subject(".card { border-left: 4px solid #4f9d69; }"), IMPECCABLE_TELLS_PROFILE);
		expect(f.some((x) => x.ruleId === "side-stripe-border")).toBe(true);
	});

	it("does NOT flag a 1px hairline border", () => {
		const f = checkDesign(subject(".card { border-left: 1px solid #ccc; }"), IMPECCABLE_TELLS_PROFILE);
		expect(f.some((x) => x.ruleId === "side-stripe-border")).toBe(false);
	});

	it("flags gradient text (background-clip:text + gradient)", () => {
		const css = ".h { background: linear-gradient(90deg, #a, #b); background-clip: text; color: transparent; }";
		expect(checkDesign(subject(css), IMPECCABLE_TELLS_PROFILE).some((x) => x.ruleId === "gradient-text")).toBe(true);
	});

	it("flags glassmorphism (backdrop-filter: blur)", () => {
		expect(
			checkDesign(subject(".panel { backdrop-filter: blur(12px); }"), IMPECCABLE_TELLS_PROFILE).some(
				(x) => x.ruleId === "glassmorphism",
			),
		).toBe(true);
	});

	it("flags a magic z-index but not a small one", () => {
		expect(checkDesign(subject(".x { z-index: 9999; }"), IMPECCABLE_TELLS_PROFILE).some((x) => x.ruleId === "arbitrary-zindex")).toBe(true);
		expect(checkDesign(subject(".x { z-index: 5; }"), IMPECCABLE_TELLS_PROFILE).some((x) => x.ruleId === "arbitrary-zindex")).toBe(false);
	});

	it("flags a tiny uppercase tracked eyebrow", () => {
		const css = ".eyebrow { text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }";
		expect(checkDesign(subject(css), IMPECCABLE_TELLS_PROFILE).some((x) => x.ruleId === "uppercase-eyebrow")).toBe(true);
	});

	it("does NOT flag a large uppercase heading (not an eyebrow)", () => {
		const css = ".hero { text-transform: uppercase; font-size: 48px; letter-spacing: 0.02em; }";
		expect(checkDesign(subject(css), IMPECCABLE_TELLS_PROFILE).some((x) => x.ruleId === "uppercase-eyebrow")).toBe(false);
	});
});

describe("design-tells — motion", () => {
	it("flags a bounce easing", () => {
		expect(
			checkDesign(subject(".x { transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55); }"), IMPECCABLE_TELLS_PROFILE).some(
				(x) => x.ruleId === "bounce-easing",
			),
		).toBe(true);
	});

	it("flags animation with no prefers-reduced-motion guard", () => {
		expect(
			checkDesign(subject("@keyframes spin { to { transform: rotate(360deg); } } .x { animation: spin 1s; }"), IMPECCABLE_TELLS_PROFILE).some(
				(x) => x.ruleId === "missing-reduced-motion",
			),
		).toBe(true);
	});

	it("stays quiet when reduced-motion is guarded", () => {
		const css = ".x { animation: spin 1s; } @media (prefers-reduced-motion: reduce) { .x { animation: none; } }";
		expect(checkDesign(subject(css), IMPECCABLE_TELLS_PROFILE).some((x) => x.ruleId === "missing-reduced-motion")).toBe(false);
	});
});

describe("design-tells — a clean stylesheet is quiet", () => {
	it("flags nothing on a disciplined stylesheet", () => {
		const clean = `.card { border: 1px solid var(--hairline); border-radius: 8px; }
			.title { color: var(--fg); font-size: 1.2rem; text-wrap: balance; }
			.x { transition: opacity 0.15s ease-out; z-index: 2; }
			@media (prefers-reduced-motion: reduce) { .x { transition: none; } }`;
		expect(checkDesign(subject(clean), IMPECCABLE_TELLS_PROFILE)).toEqual([]);
	});
});

describe("createDesignTellsChecker", () => {
	it("is a quality:v1 checker over the design domain", () => {
		const checker = createDesignTellsChecker();
		expect(checker.checkerId).toBe("quality.design-tells");
		expect(checker.domain).toBe("design");
	});

	it("skips an unknown check.type (forward-safe)", () => {
		const profile: QualityProfile = {
			name: "t",
			rules: [{ id: "x", severity: "warn", description: "d", check: { type: "not-a-known-matcher" } }],
		};
		expect(runDesignTellsRules(subject(".a { color: red; }"), profile)).toEqual([]);
	});
});
