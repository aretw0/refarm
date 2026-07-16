import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Governance ENFORCED on the Rust runtime: governance-enforce boots the SAME agent under strict
 * mode with fs:read dropped from its manifest, scripts a read, and shows the host REFUSED the
 * effect (no host-effect:fs:read line) — contrasted with a granted baseline that does produce one.
 * The third face of the quartet (decide → record → enforce).
 *
 * Gated on RUN_RUNTIME_EXECUTION=1 + built artifacts (agent.wasm, source_provider.wasm, tractor).
 *
 * To run it:
 *   pnpm --filter @refarm.dev/source-provider-ref run build:plugin
 *   pnpm --filter @refarm.dev/agent run build:wasm
 *   (cd packages/tractor && node ../../scripts/ci/cargo-run.mjs build --release)
 *   RUN_RUNTIME_EXECUTION=1 pnpm --filter devbench-t1 exec vitest run enforce.execution
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const BINARY = resolve(REPO_ROOT, ".cache/cargo-target/release/tractor");
const AGENT_WASM = resolve(REPO_ROOT, "packages/agent/dist/agent.wasm");
const SOURCE_WASM = resolve(REPO_ROOT, "packages/source-provider-ref/dist/source_provider.wasm");

const enabled =
	process.env.RUN_RUNTIME_EXECUTION === "1" &&
	existsSync(BINARY) &&
	existsSync(AGENT_WASM) &&
	existsSync(SOURCE_WASM);

describe.skipIf(!enabled)("T1 governance-enforce, executed on the Rust runtime", () => {
	it("REFUSES an undeclared fs:read under strict, but allows it when granted — and stamps the evidence", async () => {
		const { createGovernanceEnforceCapability } = await import("./live-enforce.js");
		const { createHash } = await import("node:crypto");
		// Drive with --apply + an in-memory writer so the REAL runtime evidence is persisted.
		const written = new Map<string, string>();
		const env = (await createGovernanceEnforceCapability({
			writeEvidence: (path, content) => {
				written.set(path, content);
			},
		}).run({
			args: {},
			options: { apply: true },
			json: true,
		})) as unknown as {
			ok: boolean;
			enforced: boolean;
			denied: { producedFsReadEffect: boolean };
			baseline: { producedFsReadEffect: boolean };
			evidence?: string;
			evidenceFiles: Array<{ path: string; sha256: string }>;
		};
		expect(env.ok).toBe(true);
		// The DENIED run (strict, no fs:read grant) produced NO effect — the host refused it.
		expect(env.denied.producedFsReadEffect).toBe(false);
		// The BASELINE run (fs:read granted) DID produce the effect — proving the read is real.
		expect(env.baseline.producedFsReadEffect).toBe(true);
		// Enforcement holds: refused when undeclared, allowed when granted.
		expect(env.enforced).toBe(true);

		// The REAL runtime evidence was persisted + stamped (not the synthetic governance-poc's).
		expect(env.evidence).toBe(".dgk/enforce/evidence.json");
		const evidenceContent = written.get(".dgk/enforce/enforce-evidence.json");
		expect(evidenceContent).toBeTruthy();
		expect(JSON.parse(evidenceContent!)).toMatchObject({ verb: "governance-enforce", enforced: true });
		// The stamp binds the file to the SHA-256 of its exact bytes.
		expect(env.evidenceFiles[0]?.sha256).toBe(createHash("sha256").update(evidenceContent!, "utf8").digest("hex"));
		// The manifest sidecar landed too.
		expect(written.has(".dgk/enforce/evidence.json")).toBe(true);
	}, 180_000);
});
