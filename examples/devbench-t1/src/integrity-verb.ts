import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
} from "@refarm.dev/capability-host";
import { verifyBufferIntegrity } from "@refarm.dev/plugin-manifest";
import { createHash } from "node:crypto";

/**
 * `extension-verify` — SIMULATE the integrity gate of promoting an extension. Before an artifact is
 * loaded, the host verifies that its bytes hash to the expected integrity — a tampered or corrupt
 * artifact is REJECTED, never run. This is the writeup's "verificação de integridade reduz risco de
 * artefatos adulterados": the same synthetic artifact promotes cleanly when intact, and is refused
 * when a single byte is flipped, even though the declared integrity is unchanged.
 *
 * The integrity contract is the platform's (@refarm.dev/plugin-manifest verifyBufferIntegrity,
 * sha256); this example only supplies a synthetic artifact + a tampered copy to exercise the gate.
 * A LOCAL, SYNTHETIC proof — no real artifact, no deployment claimed.
 */

/** Compute the canonical `sha256-<base64>` integrity of some bytes (what a publisher records). */
function computeIntegrity(bytes: Uint8Array): string {
	return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

interface IntegrityCase {
	label: string;
	promoted: boolean;
	reason: string;
	expectedIntegrity: string;
}

export function createExtensionVerifyCapability(): CapabilityDescriptor {
	return {
		name: "extension-verify",
		summary: "Simulate the integrity gate: an intact artifact promotes, a tampered one is rejected",
		transports: { http: { path: "/extension/verify" } },
		renderers: { tui: { section: "governance" }, web: { route: "/integrity", icon: "verified" }, ide: { command: "dgk.extension-verify" } },
		async run(): Promise<CapabilityEnvelope> {
			// A synthetic extension artifact + the integrity a publisher would record for it.
			const artifact = new TextEncoder().encode("synthetic-extension-artifact-bytes-v1");
			const declaredIntegrity = computeIntegrity(artifact);

			const cases: IntegrityCase[] = [];

			// 1. The intact artifact — verifies against its declared integrity → promoted.
			try {
				await verifyBufferIntegrity(artifact, declaredIntegrity);
				cases.push({ label: "Artefato íntegro", promoted: true, reason: "hash confere com a integridade declarada", expectedIntegrity: declaredIntegrity });
			} catch (error) {
				cases.push({ label: "Artefato íntegro", promoted: false, reason: error instanceof Error ? error.message : String(error), expectedIntegrity: declaredIntegrity });
			}

			// 2. A TAMPERED copy (one byte flipped) with the SAME declared integrity → rejected.
			const tampered = new Uint8Array(artifact);
			tampered[0] = (tampered[0]! ^ 0x01) & 0xff;
			try {
				await verifyBufferIntegrity(tampered, declaredIntegrity);
				// Reaching here would be a failure of the gate (should have thrown).
				cases.push({ label: "Artefato adulterado", promoted: true, reason: "GATE FALHOU: bytes adulterados passaram", expectedIntegrity: declaredIntegrity });
			} catch {
				cases.push({ label: "Artefato adulterado", promoted: false, reason: "rejeitado: hash não confere com a integridade declarada", expectedIntegrity: declaredIntegrity });
			}

			const intactPromoted = cases.find((c) => c.label === "Artefato íntegro")?.promoted === true;
			const tamperedRejected = cases.find((c) => c.label === "Artefato adulterado")?.promoted === false;

			return buildJsonSuccessEnvelope({
				command: "extension-verify",
				operation: "extension-verify",
				nextCommand: "dgk extension-develop",
				nextCommands: ["dgk extension-develop"],
				extra: {
					declaredIntegrity,
					cases,
					// The invariant the writeup asserts: intact promotes, tampered is refused.
					integrityGateHolds: intactPromoted && tamperedRejected,
					disclaimer: "Verificação de integridade local sobre artefato sintético — o gate rejeita bytes adulterados; sem implantação.",
				},
			});
		},
	};
}
