export const DS_LINT_CAPABILITY = "ds-lint:v1" as const;

const AA_NORMAL_TEXT = 4.5;
const AA_LARGE_TEXT = 3;
const DEFAULT_TOLERANCE_PX = 1;

export type DsLintSeverity = "error" | "warning";

export interface DsLintViewport {
	width: number;
	height: number;
}

export interface DsLintBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface DsLintMetrics {
	clientWidth?: number;
	clientHeight?: number;
	scrollWidth?: number;
	scrollHeight?: number;
	boundingBox?: DsLintBox;
}

export interface DsLintStyle {
	color?: string | null;
	backgroundColor?: string | null;
	fontSizePx?: number | null;
	fontWeight?: string | number | null;
	fontSizeExpression?: string | null;
}

export interface DsLintElement {
	id: string;
	selector?: string;
	tagName?: string;
	role?: string;
	text?: string;
	styles?: DsLintStyle;
	metrics?: DsLintMetrics;
}

export interface DsLintSnapshot {
	viewport: DsLintViewport;
	elements: DsLintElement[];
}

export interface DsLintOptions {
	contrast?: boolean;
	overflow?: boolean;
	fluidType?: boolean;
	headingHierarchy?: boolean;
	tolerancePx?: number;
}

export interface DsLintIssue {
	ruleId: string;
	severity: DsLintSeverity;
	message: string;
	elementId?: string;
	selector?: string;
	details?: Record<string, unknown>;
}

export interface DsLintReport {
	pass: boolean;
	issueCount: number;
	errorCount: number;
	warningCount: number;
	issues: DsLintIssue[];
}

export function runDsLint(snapshot: DsLintSnapshot, options: DsLintOptions = {}): DsLintReport {
	const enabled = {
		contrast: options.contrast ?? true,
		overflow: options.overflow ?? true,
		fluidType: options.fluidType ?? true,
		headingHierarchy: options.headingHierarchy ?? true,
		tolerancePx: options.tolerancePx ?? DEFAULT_TOLERANCE_PX,
	};

	const issues = [
		...(enabled.contrast ? checkContrast(snapshot) : []),
		...(enabled.overflow ? checkOverflow(snapshot, enabled.tolerancePx) : []),
		...(enabled.fluidType ? checkFluidType(snapshot) : []),
		...(enabled.headingHierarchy ? checkHeadingHierarchy(snapshot) : []),
	];
	const errorCount = issues.filter((issue) => issue.severity === "error").length;
	const warningCount = issues.length - errorCount;

	return {
		pass: errorCount === 0,
		issueCount: issues.length,
		errorCount,
		warningCount,
		issues,
	};
}

function checkContrast(snapshot: DsLintSnapshot): DsLintIssue[] {
	const issues: DsLintIssue[] = [];
	for (const element of snapshot.elements) {
		if (!hasText(element)) {
			continue;
		}
		const foreground = parseColor(element.styles?.color);
		const background = parseColor(element.styles?.backgroundColor);
		if (!foreground || !background) {
			issues.push(
				issue(
					"ds-contrast",
					"warning",
					"Text element is missing a concrete foreground/background pair.",
					element,
				),
			);
			continue;
		}

		const ratio = contrastRatio(foreground, background);
		const minRatio = isLargeText(element) ? AA_LARGE_TEXT : AA_NORMAL_TEXT;
		if (ratio < minRatio) {
			issues.push(
				issue(
					"ds-contrast",
					"error",
					"Text contrast is below WCAG AA for its computed size.",
					element,
					{
						ratio: Number(ratio.toFixed(2)),
						minRatio,
					},
				),
			);
		}
	}
	return issues;
}

function checkOverflow(snapshot: DsLintSnapshot, tolerancePx: number): DsLintIssue[] {
	const issues: DsLintIssue[] = [];
	for (const element of snapshot.elements) {
		const metrics = element.metrics;
		if (!metrics) {
			continue;
		}
		if (
			isNumber(metrics.scrollWidth) &&
			isNumber(metrics.clientWidth) &&
			metrics.scrollWidth > metrics.clientWidth + tolerancePx
		) {
			issues.push(
				issue("ds-overflow", "error", "Element scroll width exceeds its client width.", element, {
					scrollWidth: metrics.scrollWidth,
					clientWidth: metrics.clientWidth,
				}),
			);
		}
		if (
			isNumber(metrics.scrollHeight) &&
			isNumber(metrics.clientHeight) &&
			metrics.scrollHeight > metrics.clientHeight + tolerancePx
		) {
			issues.push(
				issue("ds-overflow", "error", "Element scroll height exceeds its client height.", element, {
					scrollHeight: metrics.scrollHeight,
					clientHeight: metrics.clientHeight,
				}),
			);
		}
		const box = metrics.boundingBox;
		if (box && box.x + box.width > snapshot.viewport.width + tolerancePx) {
			issues.push(
				issue(
					"ds-viewport-overflow",
					"error",
					"Element extends beyond the viewport width.",
					element,
					{
						right: box.x + box.width,
						viewportWidth: snapshot.viewport.width,
					},
				),
			);
		}
		if (box && box.y + box.height > snapshot.viewport.height + tolerancePx) {
			issues.push(
				issue(
					"ds-viewport-overflow",
					"error",
					"Element extends beyond the viewport height.",
					element,
					{
						bottom: box.y + box.height,
						viewportHeight: snapshot.viewport.height,
					},
				),
			);
		}
	}
	return issues;
}

function checkFluidType(snapshot: DsLintSnapshot): DsLintIssue[] {
	return snapshot.elements
		.filter(isHeading)
		.filter((element) => !String(element.styles?.fontSizeExpression || "").includes("clamp("))
		.map((element) =>
			issue(
				"ds-fluid-type",
				"error",
				"Heading font size must be authored as a clamp() expression.",
				element,
				{
					fontSizeExpression: element.styles?.fontSizeExpression || null,
				},
			),
		);
}

function checkHeadingHierarchy(snapshot: DsLintSnapshot): DsLintIssue[] {
	const headings = snapshot.elements.filter(isHeading);
	const issues: DsLintIssue[] = [];
	const h1s = headings.filter((heading) => headingLevel(heading) === 1);
	if (h1s.length !== 1) {
		issues.push({
			ruleId: "ds-heading-hierarchy",
			severity: "error",
			message: "Rendered surface must contain exactly one h1.",
			details: { h1Count: h1s.length },
		});
	}

	let previousLevel = 0;
	for (const heading of headings) {
		const level = headingLevel(heading);
		if (level > previousLevel + 1 && previousLevel !== 0) {
			issues.push(
				issue("ds-heading-hierarchy", "error", "Heading hierarchy skips a level.", heading, {
					previousLevel,
					level,
				}),
			);
		}
		previousLevel = level;
	}
	return issues;
}

function issue(
	ruleId: string,
	severity: DsLintSeverity,
	message: string,
	element: DsLintElement,
	details?: Record<string, unknown>,
): DsLintIssue {
	return {
		ruleId,
		severity,
		message,
		elementId: element.id,
		selector: element.selector,
		details,
	};
}

function hasText(element: DsLintElement): boolean {
	return Boolean(element.text?.trim());
}

function isHeading(element: DsLintElement): boolean {
	return headingLevel(element) > 0;
}

function headingLevel(element: DsLintElement): number {
	const tag = element.tagName?.toLowerCase();
	if (!tag || !/^h[1-6]$/.test(tag)) {
		return 0;
	}
	return Number(tag.slice(1));
}

function isLargeText(element: DsLintElement): boolean {
	const fontSize = element.styles?.fontSizePx ?? 0;
	const weight = Number(element.styles?.fontWeight ?? 400);
	return fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

interface Rgb {
	red: number;
	green: number;
	blue: number;
}

function parseColor(value: string | null | undefined): Rgb | null {
	if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") {
		return null;
	}
	const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
	if (hex) {
		const captured = hex[1];
		if (!captured) {
			return null;
		}
		const digits =
			captured.length === 3 ? [...captured].map((digit) => `${digit}${digit}`).join("") : captured;
		const numeric = Number.parseInt(digits, 16);
		return {
			red: (numeric >> 16) & 255,
			green: (numeric >> 8) & 255,
			blue: numeric & 255,
		};
	}
	const rgb = value
		.trim()
		.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
	if (!rgb) {
		return null;
	}
	return {
		red: Number(rgb[1]),
		green: Number(rgb[2]),
		blue: Number(rgb[3]),
	};
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
	const foregroundLuminance = relativeLuminance(foreground);
	const backgroundLuminance = relativeLuminance(background);
	const lighter = Math.max(foregroundLuminance, backgroundLuminance);
	const darker = Math.min(foregroundLuminance, backgroundLuminance);
	return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance({ red, green, blue }: Rgb): number {
	return (
		0.2126 * channelLuminance(red) +
		0.7152 * channelLuminance(green) +
		0.0722 * channelLuminance(blue)
	);
}

function channelLuminance(channel: number): number {
	const srgb = channel / 255;
	return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}
