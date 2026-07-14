import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
} from "@refarm.dev/capability-host";

/**
 * The EASTER EGG — `xyzzy`, the classic magic word from Colossal Cave Adventure (1976), fitting for
 * a sandbox: a plugin runs in its own little cave, isolated from the rest. Typing it reveals the
 * hidden continuity the three example tracks share, and a wink at the sandbox metaphor. It is a
 * real (playful) capability, not a stub — a plugin like any other, which is itself the point:
 * even a whimsical extension goes through the same governed surface.
 *
 * The hidden continuity it discloses: the source provider the T1 recursion boots is the SAME WASM
 * plugin the T3 example later loads and consumes. T1 creates what T3 uses. Nobody states the link;
 * a viewer of all three notices. `xyzzy` is where the example finally says it out loud, quietly.
 */
export function createXyzzyCapability(): CapabilityDescriptor {
	return {
		name: "xyzzy",
		// A terse, unassuming summary — the reward is running it.
		summary: "A hollow voice says 'Fool.'",
		transports: { http: { path: "/xyzzy" } },
		renderers: { tui: { section: "hidden" } },
		async run(): Promise<CapabilityEnvelope> {
			return buildJsonSuccessEnvelope({
				command: "xyzzy",
				operation: "xyzzy",
				extra: {
					message: "Nothing happens. …or does it?",
					// The wink: a plugin in a sandbox is a thing in its own little cave.
					sandbox: "Every plugin runs in its own cave — isolated by design, like an adventurer XYZZY'd into a hollow.",
					// The silent continuity, finally said out loud (quietly).
					continuity:
						"The source provider this bench boots for the live recursion is the same WASM plugin the requirements bench (another track) later loads. One example creates what another consumes — no one told you.",
					signature: "— A hollow voice, echoing from the plugin cave.",
				},
			});
		},
	};
}
