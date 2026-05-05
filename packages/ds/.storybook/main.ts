import type { StorybookConfig } from "@storybook/html-vite";

const config: StorybookConfig = {
	stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	addons: [
		"@storybook/addon-links",
		"@storybook/addon-a11y",
		"storybook-addon-figma",
	],
	framework: {
		name: "@storybook/html-vite",
		options: {},
	},
};
export default config;
