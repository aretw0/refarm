// Bare-runtime doctor finding — the node is up, healthy by every other measure, and cannot
// reach the provider its own config declares.
//
// See `../utils/runtime-environment.ts` for the incident that produced this: a node restarted by
// hand, without `.refarm/.env` and without the credentials `refarm model env --shell
// --include-secrets` materialises, came up reporting healthy and failed several minutes later with
// a provider-mismatch message that named the symptom and not the cause.
//
// The point of saying it HERE is timing. The runtime already refuses the mismatch loudly at first
// use — that part works. What was missing is a finding an operator sees BEFORE trusting the node
// with work, which is what `refarm doctor` is for, and what a scheduled restart makes urgent: the
// wrong start and the right start look identical until something fails.
//
// A courtesy TELL, like its siblings: it names the start script rather than running it. Starting a
// node is an operator action, and a diagnostic that restarts one on its own would be the same
// overreach `runtime-freshness-doctor.ts` refuses for the same reason.

import type { RuntimeEnvironment } from "../utils/runtime-environment.js";
import type { RefarmDoctorRecommendation } from "./doctor.js";

/**
 * Build the `refarm doctor` finding for a node running without its model environment. Pure — the
 * caller reads the process (see `../utils/runtime-environment.ts`).
 *
 * Silent when `configured`: a node carrying what it needs deserves no line, the same rule every
 * other finding here follows.
 */
export function buildRuntimeEnvironmentDoctorRecommendations(
	environment: RuntimeEnvironment | null,
): RefarmDoctorRecommendation[] {
	if (!environment) return [];
	if (environment.state === "configured") return [];

	if (environment.state === "bare") {
		return [
			{
				diagnostic: "runtime:bare-environment",
				severity: "warning",
				summary:
					`The running node is up and healthy by every other measure, and cannot reach the ` +
					`provider your config declares: ${environment.reason}. Nothing has failed yet — it ` +
					"will, at the first dispatch, with a provider-mismatch message that names the " +
					"symptom rather than this cause.",
				action:
					"Restart it through scripts/tractor-start.sh, which sources .refarm/.env and " +
					"materialises the model credentials out of the sovereign vault. A node started by " +
					"hand with a plain command line looks identical to a correct one until work fails.",
			},
		];
	}

	return [
		{
			diagnostic: "runtime:environment-unknown",
			severity: "warning",
			summary:
				`Whether the running node carries its model environment could not be established: ` +
				`${environment.reason}. It may be correctly started or it may be bare, and this cannot ` +
				"tell you which.",
			action:
				"Treat it as unverified rather than fine. If a dispatch later fails with a " +
				"provider mismatch, this is the check that could not answer it in advance.",
		},
	];
}
