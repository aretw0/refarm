// @ts-check
import { withNode } from "@refarm.dev/eslint-config/node";

/**
 * THE KIT IS PLAIN JAVASCRIPT THAT SHIPS TO A PHONE.
 *
 * Every other package here is TypeScript, where the compiler already refuses an undefined
 * reference — which is why the shared preset leaves `no-undef` off, as typescript-eslint
 * recommends. This package has no compiler: `bin/*.mjs` and `src/*.mjs` are the artifact,
 * copied verbatim into `.refarm/dist/farm-client` and pulled down by `farm-update`.
 *
 * So nothing static looked at them at all. On 2026-08-02 an extraction removed two `const`
 * declarations and left two references behind; `node --check` passed (it only parses), the
 * 200-test suite passed (it covers `src/`, and a bin is not importable), and the operator
 * found it on the first real run — a `ReferenceError` on their phone, from a kit the node
 * had already published.
 *
 * `no-undef` is the rule that names that exact failure, and it costs nothing: the package
 * is clean under it today. The vendored capsules are excluded — they are copies, emitted
 * from their origin package, and are linted there.
 */
export default withNode(
	{
		ignores: ["vendor/**", "bootstrap/**"],
	},
	{
		files: ["bin/**/*.mjs", "src/**/*.mjs", "scripts/**/*.mjs", "test/**/*.mjs"],
		rules: {
			"no-undef": "error",
		},
	},
);
