import { defineConfig } from 'vitest/config';

const ciVitestOverrides = process.env.GITHUB_ACTIONS === 'true'
	? {
		reporters: [
			['github-actions', { jobSummary: { enabled: false } }],
			'default',
			'json',
		],
		outputFile: {
			json: `.artifacts/vitest/report-${(process.env.npm_lifecycle_event || 'run').replace(/[^a-zA-Z0-9_-]/g, '-')}.json`,
		},
	}
	: {};

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
		...ciVitestOverrides,
  },
});
