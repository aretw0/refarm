import { describe, expect, it } from "vitest";

import { HUMANIZER_TELLS_PROFILE } from "./humanizer-profile.js";
import { checkText, createTextTellsChecker, runTextTellsRules, scoreTextTells } from "./text-tells.js";
import type { QualityProfile } from "./types.js";

const subject = (text: string) => ({ path: "doc.md", text });

describe("runTextTellsRules — banned words / stock phrases / transitions", () => {
	it("flags AI-canonical vocabulary (whole word, case-insensitive)", () => {
		const f = checkText(subject("We will leverage a robust and comprehensive approach."), HUMANIZER_TELLS_PROFILE);
		const terms = f.filter((x) => x.ruleId === "banned-words").map((x) => x.locus?.term);
		expect(terms).toEqual(expect.arrayContaining(["leverage", "robust", "comprehensive"]));
	});

	it("does NOT flag a banned word inside another word", () => {
		// "delve" must not match "delved"? It should — whole word incl. inflection is out of scope;
		// but "robustness" should NOT match "robust". Assert the substring case stays quiet.
		const f = checkText(subject("The robustness of the system is fine."), HUMANIZER_TELLS_PROFILE);
		expect(f.filter((x) => x.locus?.term === "robust")).toEqual([]);
	});

	it("flags stock hedge phrases", () => {
		const f = checkText(subject("It is worth noting that, generally speaking, this works."), HUMANIZER_TELLS_PROFILE);
		const phrases = f.filter((x) => x.ruleId === "stock-phrase").map((x) => x.locus?.term);
		expect(phrases).toEqual(expect.arrayContaining(["it is worth noting", "generally speaking"]));
	});

	it("flags mechanical AI transitions", () => {
		const f = checkText(subject("Furthermore, the plan is sound. Moreover, it scales."), HUMANIZER_TELLS_PROFILE);
		expect(f.filter((x) => x.ruleId === "ai-transition").length).toBe(2);
	});

	it("stays quiet on clean, human prose", () => {
		const human = "The scraper broke last Tuesday. I traced it to a stale cookie and swapped the driver. Fixed in ten minutes.";
		expect(checkText(subject(human), HUMANIZER_TELLS_PROFILE)).toEqual([]);
	});
});

describe("em-dash-density", () => {
	const emDashProfile: QualityProfile = {
		name: "t",
		rules: [{ id: "em", severity: "warn", description: "d", check: { type: "em-dash-density", words: 300, maxPer: 1 } }],
	};

	it("flags text with too many em dashes for its length", () => {
		// A short text with 3 em dashes → over the 1-per-300-words budget.
		const f = runTextTellsRules(subject("A — b — c — d."), emDashProfile);
		expect(f).toHaveLength(1);
		expect(f[0]!.locus).toMatchObject({ dashes: 3, allowed: 1 });
	});

	it("allows an occasional em dash", () => {
		expect(runTextTellsRules(subject("A single dash — used once — is fine here."), emDashProfile).length).toBe(1);
		expect(runTextTellsRules(subject("One dash — only."), emDashProfile)).toEqual([]);
	});
});

describe("sentence-burstiness", () => {
	const burstProfile: QualityProfile = {
		name: "t",
		rules: [{ id: "burst", severity: "warn", description: "d", check: { type: "sentence-burstiness", minStdev: 4, minSentences: 4 } }],
	};

	it("flags uniform sentence lengths (AI cadence)", () => {
		// Six sentences of ~equal length → low variance.
		const uniform = "The cat sat on the mat today. The dog ran in the park now. The bird flew over the tree here. The fish swam in the pond then. The fox hid behind the bush there. The owl slept up in the oak.";
		const f = runTextTellsRules(subject(uniform), burstProfile);
		expect(f).toHaveLength(1);
		expect(f[0]!.ruleId).toBe("burst");
	});

	it("stays quiet on bursty (varied) sentence lengths", () => {
		const bursty = "It broke. I spent the entire afternoon tracing a single stale cookie through four layers of the driver before it finally clicked. Fixed. Then I wrote the test that would have caught it in the first place, which took longer than the fix.";
		expect(runTextTellsRules(subject(bursty), burstProfile)).toEqual([]);
	});

	it("does not judge a text with too few sentences", () => {
		expect(runTextTellsRules(subject("One. Two. Three."), burstProfile)).toEqual([]);
	});
});

describe("createTextTellsChecker", () => {
	it("is a quality:v1 checker over the prose domain", () => {
		const checker = createTextTellsChecker();
		expect(checker.checkerId).toBe("quality.text-tells");
		expect(checker.domain).toBe("prose");
		const f = checker.check(subject("We leverage robust synergy."), HUMANIZER_TELLS_PROFILE);
		expect(Array.isArray(f)).toBe(true);
	});

	it("skips an unknown check.type (forward-safe)", () => {
		const profile: QualityProfile = {
			name: "t",
			rules: [{ id: "x", severity: "warn", description: "d", check: { type: "not-a-known-matcher" } }],
		};
		expect(runTextTellsRules(subject("anything"), profile)).toEqual([]);
	});
});

describe("scoreTextTells — the verdict tier (anti-regression signal)", () => {
	it("scores clean human prose as human", () => {
		const human = "The scraper broke last Tuesday. I traced it to a stale cookie and swapped the driver. Fixed in ten minutes.";
		const s = scoreTextTells(subject(human), HUMANIZER_TELLS_PROFILE);
		expect(s.verdict).toBe("human");
		expect(s.tells).toBe(0);
	});

	it("scores AI-tell-dense prose as likely-ai or ai", () => {
		const ai = "Furthermore, it is worth noting that we leverage a robust, comprehensive framework. Moreover, this pivotal solution will streamline and facilitate synergy. It is important to note that we utilize seamless integration.";
		const s = scoreTextTells(subject(ai), HUMANIZER_TELLS_PROFILE);
		expect(["likely-ai", "ai"]).toContain(s.verdict);
		expect(s.tells).toBeGreaterThan(3);
	});

	it("normalizes by length (tells per 1000 words) and carries the findings", () => {
		const s = scoreTextTells(subject("We leverage robust tools."), HUMANIZER_TELLS_PROFILE);
		expect(s.tellsPerThousandWords).toBeGreaterThan(0);
		expect(s.findings.length).toBe(s.tells);
	});
});
