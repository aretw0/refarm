declare module "@refarm.dev/heartwood" {
	export interface HeartwoodModule {
		verify(
			manifestData: Uint8Array,
			signature: Uint8Array,
			publicKey: Uint8Array,
		): Promise<boolean> | boolean;
	}

	const heartwood: HeartwoodModule;
	export default heartwood;
}
