#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const wantsJson = args.has('--json') || args.has('--json=true');
if (!wantsJson) {
	console.info(
		'[legacy] scripts/pi-session-heavy.mjs is a compatibility alias. Use `session:heavy:refarm` for current refarm sessions, or `session:heavy:legacy-pi` when you explicitly need historical .pi session logs.',
	);
}
import './session-heavy.mjs';
