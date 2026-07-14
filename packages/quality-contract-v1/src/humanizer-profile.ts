import type { QualityProfile } from "./types.js";

/**
 * The HUMANIZER text-tells profile — the deterministic AI-writing tells, as DATA. Assembled from
 * the humanizer "nine levers" (the mechanical subset a matcher can decide) so a corpus can be
 * gated against regression, not just reminded. Every term/threshold here is a rule value, so a
 * consumer edits the DATA (adds a banned word, loosens the em-dash budget) — not the checker code.
 *
 * `warn` severity throughout: text-tells are advice, not a hard fail — the point is to surface the
 * tell, not to block. A consumer can raise a rule to `fail` in its own profile.
 */
export const HUMANIZER_TELLS_PROFILE: QualityProfile = {
	name: "humanizer-text-tells",
	rules: [
		{
			id: "banned-words",
			severity: "warn",
			category: "vocabulary",
			description: "AI-canonical vocabulary — a real writer would pick a plainer word",
			check: {
				type: "banned-words",
				terms: [
					"delve",
					"leverage",
					"robust",
					"streamline",
					"comprehensive",
					"notably",
					"significant",
					"pivotal",
					"foster",
					"facilitate",
					"utilize",
					"seamless",
					"myriad",
					"realm",
					"underscore",
					"tapestry",
				],
			},
		},
		{
			id: "stock-phrase",
			severity: "warn",
			category: "hedging",
			description: "A hedge/filler phrase — delete it unless it carries real meaning",
			check: {
				type: "stock-phrase",
				terms: [
					"it is worth noting",
					"it is important to note that",
					"it is important to note",
					"it is worth mentioning",
					"generally speaking",
					"in many cases",
					"needless to say",
					"at the end of the day",
					"when it comes to",
					"in today's world",
					"in the world of",
				],
			},
		},
		{
			id: "ai-transition",
			severity: "warn",
			category: "discourse",
			description: "A mechanical AI connective — cut it or use a plain transition",
			check: {
				type: "ai-transition",
				terms: [
					"Furthermore",
					"Moreover",
					"In addition to the above",
					"It is clear that",
					"This highlights the importance of",
					"In conclusion",
					"That being said",
					"As previously mentioned",
				],
			},
		},
		{
			id: "em-dash-density",
			severity: "warn",
			category: "punctuation",
			description: "Em dashes above the human baseline (AI runs 3–5×) — replace most with periods",
			// Budget: ~1 prose em dash per 150 words (dense technical writing runs higher than casual
			// prose). Structural/list dashes aren't counted, and short docs (<200 words) aren't judged,
			// so this fires only on genuine mid-sentence-aside overuse, not a considered style.
			check: { type: "em-dash-density", words: 150, maxPer: 1, minWords: 200, minDashes: 3 },
		},
		{
			id: "sentence-burstiness",
			severity: "warn",
			category: "cadence",
			description: "Sentence lengths too uniform — human writing varies (short then long)",
			check: { type: "sentence-burstiness", minStdev: 4, minSentences: 5, minWords: 120 },
		},
	],
};
