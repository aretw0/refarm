export function astroWasiSsrValidationAdapter() {
	return {
		name: "@refarm.dev/astro-wasi-ssr-poc",
		hooks: {
			"astro:config:done": ({ setAdapter }) => {
				setAdapter({
					name: "@refarm.dev/astro-wasi-ssr-poc-adapter",
					serverEntrypoint: new URL("./server-entrypoint.mjs", import.meta.url),
					entrypointResolution: "auto",
					adapterFeatures: {
						buildOutput: "server",
					},
					supportedAstroFeatures: {
						serverOutput: "stable",
						staticOutput: "stable",
						hybridOutput: "stable",
						i18nDomains: "unsupported",
						envGetSecret: "unsupported",
						sharpImageService: "stable",
					},
				});
			},
		},
	};
}
