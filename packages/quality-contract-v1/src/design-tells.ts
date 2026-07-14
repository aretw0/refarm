import type { QualityChecker, QualityFinding, QualityProfile } from "./types.js";

/**
 * DESIGN-TELLS — a deterministic design-quality evaluator that flags the "AI slop" tells of
 * generated UI, as a quality:v1 checker over `{path, css}` (a stylesheet, or the `<style>`/style
 * attributes of a page). The prose sibling of text-tells: where an impeccable skill is guidance
 * the LLM is asked to follow, this is DATA + code — the tells run as a gate over the CSS string,
 * so a face's stylesheet can be checked for regressions, not just reminded.
 *
 * No DOM, no render — the matchers are string/regex over the CSS, so this stays pure and runs
 * anywhere (a build gate, a test). Modeled on the impeccable ban list, reduced to the subset a
 * matcher can decide from the stylesheet alone:
 *   side-stripe-border   — a thick colored border-left/right accent (the AI card stripe).
 *   gradient-text        — background-clip:text + a gradient (the AI gradient headline).
 *   glassmorphism        — a decorative backdrop-filter: blur().
 *   bounce-easing        — a bounce/elastic timing function (AI motion tell).
 *   arbitrary-zindex     — a magic z-index (999 / 9999 …) instead of a scale.
 *   uppercase-eyebrow    — a tiny uppercase tracked kicker (the "ABOUT" eyebrow).
 *   missing-reduced-motion — animation/transition present but no prefers-reduced-motion.
 * matcher-is-data: each rule's `check.type` selects a matcher; unknown types are forward-safe.
 */

/** What a design-tells rule inspects: the subject's path (for the locus) + its CSS text. */
export interface DesignQualitySubject {
	path: string;
	/** The CSS to scan — a stylesheet, or the concatenated `<style>` blocks / style attributes. */
	css: string;
}

function num(check: Record<string, unknown>, key: string): number | undefined {
	const v = check[key];
	return typeof v === "number" ? v : undefined;
}

/** Push one finding per regex match in the CSS. */
function flagMatches(
	css: string,
	re: RegExp,
	rule: { id: string; severity: string; description: string },
	path: string,
	findings: QualityFinding[],
): void {
	let m: RegExpExecArray | null;
	const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
	while ((m = g.exec(css)) !== null) {
		findings.push({
			severity: rule.severity,
			ruleId: rule.id,
			message: rule.description,
			locus: { path, index: m.index, match: m[0].slice(0, 80) },
		});
	}
}

/** Run the design-tells rules in `profile` against one subject. PURE. */
export function runDesignTellsRules(subject: DesignQualitySubject, profile: QualityProfile): QualityFinding[] {
	const findings: QualityFinding[] = [];
	const css = subject.css;
	const path = subject.path;
	for (const rule of profile.rules) {
		switch (rule.check.type) {
			case "side-stripe-border": {
				// border-left / border-right with a width > 1px AND a color (the accent stripe).
				const minPx = num(rule.check, "minPx") ?? 2;
				const re = /border-(?:left|right)\s*:\s*([0-9.]+)px\s+\w+\s+(#[0-9a-f]{3,8}|rgb|hsl|var\()/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(css)) !== null) {
					if (Number(m[1]) >= minPx) {
						findings.push({
							severity: rule.severity,
							ruleId: rule.id,
							message: rule.description,
							locus: { path, index: m.index, width: Number(m[1]) },
						});
					}
				}
				break;
			}
			case "gradient-text": {
				// background-clip:text (or -webkit-) near a gradient → the AI gradient headline.
				if (/background-clip\s*:\s*text/i.test(css) && /(linear|radial|conic)-gradient\(/i.test(css)) {
					const idx = css.search(/background-clip\s*:\s*text/i);
					findings.push({ severity: rule.severity, ruleId: rule.id, message: rule.description, locus: { path, index: idx } });
				}
				break;
			}
			case "glassmorphism":
				flagMatches(css, /backdrop-filter\s*:\s*[^;]*blur\(/gi, rule, path, findings);
				break;
			case "bounce-easing": {
				// A bounce is OVERSHOOT: a cubic-bezier whose Y control point (2nd or 4th arg) is
				// < 0 or > 1 — the curve goes past the target and springs back. A normal ease-out
				// (e.g. cubic-bezier(0.16, 1, 0.3, 1)) has Y in [0,1] and is NOT flagged. Also catch a
				// named elastic/bounce timing function.
				const re = /cubic-bezier\(\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*\)/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(css)) !== null) {
					const y1 = Number(m[2]);
					const y2 = Number(m[4]);
					if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) {
						findings.push({ severity: rule.severity, ruleId: rule.id, message: rule.description, locus: { path, index: m.index, y1, y2 } });
					}
				}
				flagMatches(css, /:\s*(?:ease-elastic|bounce)\b/gi, rule, path, findings);
				break;
			}
			case "arbitrary-zindex": {
				const threshold = num(rule.check, "threshold") ?? 999;
				const re = /z-index\s*:\s*([0-9]+)/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(css)) !== null) {
					const z = Number(m[1]);
					// A MAGIC z-index: a run of 9s (999, 9999) or above the threshold — the "just make
					// it top" reflex. A modest scale value (2, 10, 100) is fine and not flagged.
					if (/^9{3,}$/.test(m[1]!) || z >= threshold) {
						findings.push({ severity: rule.severity, ruleId: rule.id, message: rule.description, locus: { path, index: m.index, zIndex: z } });
					}
				}
				break;
			}
			case "uppercase-eyebrow": {
				// text-transform:uppercase + a small font-size + letter-spacing — the tracked kicker.
				const maxPx = num(rule.check, "maxPx") ?? 13;
				const re = /\{[^}]*\}/g;
				let m: RegExpExecArray | null;
				while ((m = re.exec(css)) !== null) {
					const block = m[0];
					if (!/text-transform\s*:\s*uppercase/i.test(block)) continue;
					if (!/letter-spacing\s*:/i.test(block)) continue;
					const size = /font-size\s*:\s*([0-9.]+)px/i.exec(block);
					if (size && Number(size[1]) <= maxPx) {
						findings.push({ severity: rule.severity, ruleId: rule.id, message: rule.description, locus: { path, index: m.index, fontSize: Number(size[1]) } });
					}
				}
				break;
			}
			case "missing-reduced-motion": {
				// If the CSS animates but never guards it with prefers-reduced-motion, flag once.
				const animates = /(?:animation|transition)\s*:/i.test(css) || /@keyframes\b/i.test(css);
				const guards = /prefers-reduced-motion/i.test(css);
				if (animates && !guards) {
					findings.push({ severity: rule.severity, ruleId: rule.id, message: rule.description, locus: { path } });
				}
				break;
			}
			default:
				// Unknown check.type → skip (forward-safe; another checker may handle it).
				break;
		}
	}
	return findings;
}

/** The quality:v1 checker over design (CSS) — the design-tells as a checker the host aggregates
 * like any other. `domain: "design"` so a host tells it apart. */
export function createDesignTellsChecker(): QualityChecker<DesignQualitySubject> {
	return {
		checkerId: "quality.design-tells",
		domain: "design",
		check: (subject, profile) => runDesignTellsRules(subject, profile),
	};
}

/** Run the design-tells profile against a subject in one call. */
export function checkDesign(subject: DesignQualitySubject, profile: QualityProfile): QualityFinding[] {
	return runDesignTellsRules(subject, profile);
}
