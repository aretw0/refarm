/**
 * @refarm.dev/farm-client — reach, discover, and drive a Refarm farm from any
 * device, over its wire contract alone.
 *
 * The library half (import these): a farm is coordinated WORKLOADS — AI agents
 * are one kind — and this client speaks only the neutral wire surface (sidecar
 * HTTP efforts/plugins, CRDT WS sync), never the app. Zero runtime dependency
 * (Node ≥22 built-ins), so a consumer can import it OR a device can run the
 * bins straight from `git pull`.
 *
 * The executables (git-pull distribution) live in ./bin: farm-hello (reach),
 * farm-announce (announce), farm-ask (drive a workload).
 */
export {
	createFarmAnnouncer,
	decodeFarmAnnounce,
	decodeFarmProbe,
	defaultProbeTargets,
	discoverFarms,
	encodeFarmAnnounce,
	encodeFarmProbe,
	FARM_BEACON_MULTICAST_GROUP,
	FARM_BEACON_PORT,
	subnetSweepTargets,
} from "./beacon.mjs";
export { parseTailnetPeers, tailnetPeers, tailnetShortName } from "./tailnet.mjs";
export { extractAnswer, isSuccessEffort, isTerminalEffort } from "./effort-result.mjs";
