// The readiness probe/poll logic moved to @refarm.dev/runtime-operator (storage-free,
// URL injected). This file keeps the refarm app's original signatures — which resolve
// the sidecar URL from the sovereign config — by wiring that resolver into the shared
// operator. Existing call-sites keep working unchanged.
import {
	probeRuntimeLiveness as probeLivenessWith,
	probeRuntimeReadiness as probeReadinessWith,
	probeRuntimeReady as probeReadyWith,
	waitForRuntimeReady as waitForReadyWith,
	type RuntimeReadinessProbe,
	type RuntimeReadinessWaitOptions,
} from "@refarm.dev/runtime-operator";

import { resolveSidecarUrl } from "./sidecar-url.js";

export type { RuntimeReadinessProbe, RuntimeReadinessWaitOptions };

/** The refarm app's sidecar URL, resolved from env → fs (the SYNC resolver — matches
 * the pre-extraction behaviour, which did not touch the tractor db on the probe path).
 * Passed to the operator as its injected URL source so this package stays the only one
 * that knows how the refarm app locates its sidecar. */
const refarmSidecar = () => resolveSidecarUrl();

export async function probeRuntimeReadiness(
	probeTimeoutMs?: number,
): Promise<RuntimeReadinessProbe> {
	return probeReadinessWith(refarmSidecar, probeTimeoutMs);
}

export async function probeRuntimeLiveness(
	probeTimeoutMs?: number,
): Promise<RuntimeReadinessProbe> {
	return probeLivenessWith(refarmSidecar, probeTimeoutMs);
}

export async function probeRuntimeReady(probeTimeoutMs?: number): Promise<boolean> {
	return probeReadyWith(refarmSidecar, probeTimeoutMs);
}

export async function waitForRuntimeReady(
	options: RuntimeReadinessWaitOptions = {},
): Promise<boolean> {
	return waitForReadyWith(refarmSidecar, options);
}
