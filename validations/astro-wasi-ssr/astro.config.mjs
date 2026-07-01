import { defineConfig } from "astro/config";
import { astroWasiSsrValidationAdapter } from "./src/adapter.mjs";

export default defineConfig({
	output: "server",
	adapter: astroWasiSsrValidationAdapter(),
	build: {
		server: "./server/",
		client: "./client/",
	},
	vite: {
		environments: {
			ssr: {
				build: {
					rollupOptions: {
						input: {
							index: new URL("./src/server-entrypoint.mjs", import.meta.url).pathname,
						},
					},
				},
			},
		},
	},
});
