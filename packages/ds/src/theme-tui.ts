import { BUILTIN_THEMES } from "./builtin-themes.generated.js";
import { REQUIRED_TOKENS, type DsTheme, type DsToken } from "./contract.js";

/**
 * The color tokens — the subset of the ds-tokens:v1 contract that has a terminal
 * analogue. The non-color tokens (radius-*, shadow-*, font-*) have no meaning in
 * a TUI and are intentionally omitted from the terminal projection.
 */
export const TUI_COLOR_TOKENS = REQUIRED_TOKENS.filter(
	(token) =>
		!token.startsWith("radius") && !token.startsWith("shadow") && !token.startsWith("font"),
) as readonly DsToken[];

export type TuiColorToken = (typeof TUI_COLOR_TOKENS)[number];

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

/** One color token projected to terminal representations. */
export interface TuiColor {
	/** The source value from the theme (usually a hex string). */
	source: string;
	rgb: Rgb;
	/** 24-bit hex (#rrggbb) — for truecolor terminals. */
	hex: string;
	/** 256-color palette index — for xterm-256color terminals. */
	ansi256: number;
	/** 16-color index (0-15) — for basic terminals. */
	ansi16: number;
}

/** A theme projected for the terminal: color tokens only, host formats escapes. */
export type TuiTheme = Partial<Record<TuiColorToken, TuiColor>>;

const SHORT_HEX = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const LONG_HEX = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FUNC = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i;

/**
 * Parse a color value to RGB. Handles #rgb, #rrggbb, and rgb()/rgba() — the
 * forms a theme token realistically carries. Returns null for anything else
 * (e.g. hsl/oklch/color-mix), so the caller can skip a token it cannot project
 * rather than emit a wrong color.
 */
export function parseColorToRgb(value: string): Rgb | null {
	const trimmed = value.trim();
	const long = LONG_HEX.exec(trimmed);
	if (long) {
		return {
			r: Number.parseInt(long[1]!, 16),
			g: Number.parseInt(long[2]!, 16),
			b: Number.parseInt(long[3]!, 16),
		};
	}
	const short = SHORT_HEX.exec(trimmed);
	if (short) {
		return {
			r: Number.parseInt(short[1]! + short[1]!, 16),
			g: Number.parseInt(short[2]! + short[2]!, 16),
			b: Number.parseInt(short[3]! + short[3]!, 16),
		};
	}
	const rgb = RGB_FUNC.exec(trimmed);
	if (rgb) {
		const r = Number(rgb[1]);
		const g = Number(rgb[2]);
		const b = Number(rgb[3]);
		if ([r, g, b].every((c) => c >= 0 && c <= 255)) return { r, g, b };
	}
	return null;
}

function toHex({ r, g, b }: Rgb): string {
	const h = (c: number) => c.toString(16).padStart(2, "0");
	return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Map RGB to the xterm 256-color palette. Uses the 6x6x6 color cube (indices
 * 16-231) or the grayscale ramp (232-255) when the color is near-gray — the
 * standard downsample every terminal library uses.
 */
/** The six intensity levels of the xterm 6x6x6 color cube. */
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

function cubeIndex(c: number): number {
	let best = 0;
	let bestDist = Infinity;
	CUBE_LEVELS.forEach((level, i) => {
		const d = Math.abs(level - c);
		if (d < bestDist) {
			bestDist = d;
			best = i;
		}
	});
	return best;
}

export function rgbToAnsi256({ r, g, b }: Rgb): number {
	if (r === g && g === b) {
		if (r < 8) return 16;
		if (r > 248) return 231;
		return Math.round(((r - 8) / 247) * 24) + 232;
	}
	return 16 + 36 * cubeIndex(r) + 6 * cubeIndex(g) + cubeIndex(b);
}

const ANSI16: readonly Rgb[] = [
	{ r: 0, g: 0, b: 0 },
	{ r: 128, g: 0, b: 0 },
	{ r: 0, g: 128, b: 0 },
	{ r: 128, g: 128, b: 0 },
	{ r: 0, g: 0, b: 128 },
	{ r: 128, g: 0, b: 128 },
	{ r: 0, g: 128, b: 128 },
	{ r: 192, g: 192, b: 192 },
	{ r: 128, g: 128, b: 128 },
	{ r: 255, g: 0, b: 0 },
	{ r: 0, g: 255, b: 0 },
	{ r: 255, g: 255, b: 0 },
	{ r: 0, g: 0, b: 255 },
	{ r: 255, g: 0, b: 255 },
	{ r: 0, g: 255, b: 255 },
	{ r: 255, g: 255, b: 255 },
];

/** Nearest basic-16 color by squared Euclidean distance — for basic terminals. */
export function rgbToAnsi16(rgb: Rgb): number {
	let best = 0;
	let bestDist = Infinity;
	ANSI16.forEach((c, i) => {
		const d = (c.r - rgb.r) ** 2 + (c.g - rgb.g) ** 2 + (c.b - rgb.b) ** 2;
		if (d < bestDist) {
			bestDist = d;
			best = i;
		}
	});
	return best;
}

/**
 * Project a surface-neutral theme to its terminal representation: each color
 * token becomes truecolor + 256 + 16 downsamples, so a TUI renderer can color
 * with the same semantic theme the web renderer uses. This is the terminal
 * analogue of tokens.css (the web projection). Non-color tokens and
 * unparseable color values are omitted. The renderer owns the ANSI escape
 * formatting; ds only supplies the values, so ds gains no terminal dependency.
 */
export function projectThemeToTui(theme: Partial<DsTheme>): TuiTheme {
	const projected: TuiTheme = {};
	for (const token of TUI_COLOR_TOKENS) {
		const value = theme[token];
		if (typeof value !== "string") continue;
		const rgb = parseColorToRgb(value);
		if (!rgb) continue;
		projected[token] = {
			source: value,
			rgb,
			hex: toHex(rgb),
			ansi256: rgbToAnsi256(rgb),
			ansi16: rgbToAnsi16(rgb),
		};
	}
	return projected;
}

/**
 * Resolve a BUILT-IN theme name to a projected TUI theme — the shape a TUI face's `*ColorsFromTuiTheme`
 * reads. An unknown `name` falls back to `fallback`; an unknown `fallback` yields an empty theme (the
 * neutral face colours). The shared helper so every app themes its TUI faces from ONE declaration
 * (`tuiTheme: resolveBuiltinTuiTheme(env.X_TUI_THEME, "tractor-green")`) instead of re-deriving the pipeline.
 */
export function resolveBuiltinTuiTheme(name: string | undefined, fallback: string): TuiTheme {
	const theme = BUILTIN_THEMES[name ?? fallback] ?? BUILTIN_THEMES[fallback] ?? {};
	return projectThemeToTui(theme);
}
