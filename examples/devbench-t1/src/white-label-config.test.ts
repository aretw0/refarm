import { loadConfig, resolveEnvPrefix } from "@refarm.dev/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DGK_COMMAND } from "./cli.js";

/**
 * The constructive half of C (ADR-087): a genuine WHITE-LABEL consumer drives the
 * SHARED `@refarm.dev/config` under ITS OWN brand prefix, with zero "refarm" leak.
 *
 * devbench already white-labels its command (`dgk` → DGK_COMMAND) and its sidecar
 * (DGK_DEVBENCH_SIDECAR_URL). This proves the SAME brand reaches config: the
 * env-prefix seam (config phase 4a) resolves `DGK_SITE_URL` / `DGK_SCOPE_*` /
 * `DGK_PROVIDER_*` into the brand/providers tree, and a stray `REFARM_*` from the
 * upstream substrate does NOT leak in. This is the seam exercised end-to-end from
 * the consumer side — not the config package testing itself.
 */
describe("white-label config: devbench drives @refarm.dev/config under its own prefix", () => {
	// devbench's env-var namespace, derived from its own command — no "REFARM".
	const DGK_ENV_PREFIX = DGK_COMMAND.toUpperCase(); // "DGK"

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses its own brand prefix, never the upstream REFARM prefix", () => {
		expect(DGK_ENV_PREFIX).toBe("DGK");
		expect(resolveEnvPrefix(DGK_ENV_PREFIX, {})).toBe("DGK");
	});

	it("resolves DGK_-prefixed env into the brand/providers tree and ignores REFARM_", () => {
		vi.stubEnv("DGK_SITE_URL", "https://devbench.example/site");
		vi.stubEnv("DGK_GIT_HOST", "gitlab");
		vi.stubEnv("DGK_SCOPE_DEV", "@devbench-dev");
		vi.stubEnv("DGK_PROVIDER_GITHUB_CLIENT_ID", "devbench-client-123");
		// The upstream substrate's own env must NOT leak into a white-label consumer.
		vi.stubEnv("REFARM_SITE_URL", "https://refarm.example/should-not-leak");

		const config = loadConfig(undefined, { envPrefix: DGK_ENV_PREFIX });

		expect(config.brand.urls?.site).toBe("https://devbench.example/site");
		expect(config.infrastructure.gitHost).toBe("gitlab");
		expect(config.brand.scopes?.dev).toBe("@devbench-dev");
		expect(config.providers?.github?.clientId).toBe("devbench-client-123");
	});

	it("selects the prefix from the neutral bootstrap env (no explicit option)", () => {
		// A white-label deployment can pick its prefix once via the neutral selector,
		// exactly as it sets DGK_COMMAND for the command — no code change.
		vi.stubEnv("SOVEREIGN_ENV_PREFIX", DGK_ENV_PREFIX);
		vi.stubEnv("DGK_GIT_HOST", "gitea");

		const config = loadConfig();

		expect(config.infrastructure.gitHost).toBe("gitea");
	});
});
