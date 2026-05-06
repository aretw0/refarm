import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AA_NORMAL_TEXT = 4.5;

function contrastRatio(foreground: string, background: string): number {
	const foregroundLuminance = relativeLuminance(foreground);
	const backgroundLuminance = relativeLuminance(background);
	const lighter = Math.max(foregroundLuminance, backgroundLuminance);
	const darker = Math.min(foregroundLuminance, backgroundLuminance);
	return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
	const value = Number.parseInt(hex.slice(1), 16);
	const red = (value >> 16) & 255;
	const green = (value >> 8) & 255;
	const blue = value & 255;
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

describe("Refarm DS text contrast", () => {
	it("keeps secondary text accessible on dark DS surfaces", () => {
		for (const background of ["#0d1117", "#161b22", "#21262d"]) {
			expect(contrastRatio("#8b949e", background)).toBeGreaterThanOrEqual(
				AA_NORMAL_TEXT,
			);
		}
	});

	it("keeps workbench backgrounds dark enough for DS text tokens", () => {
		const stylesPath = join(
			dirname(fileURLToPath(import.meta.url)),
			"styles.css",
		);
		const styles = readFileSync(stylesPath, "utf8");
		const workbenchBlock =
			styles.match(/\.refarm-workbench\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

		expect(workbenchBlock).toContain("rgba(22, 27, 34");
		expect(workbenchBlock).toContain("rgba(13, 17, 23");
		expect(workbenchBlock).not.toContain("rgba(255, 255, 255");
	});
});
