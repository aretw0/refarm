#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const wantsJson = args.has('--json') || args.has('--json=true');
if (!wantsJson) {
	console.warn(
		'[legacy] `session:heavy:pi` is a compatibility alias for legacy .pi logs.',
	);
	console.warn(
		'Use `pnpm run session:heavy:legacy-pi` for explicit legacy inspection, or `pnpm run session:heavy:refarm` for default refarm sessions.',
	);
}
import './session-heavy.mjs';
