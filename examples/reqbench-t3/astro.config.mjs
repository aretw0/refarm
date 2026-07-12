import { defineConfig } from "@refarm.dev/config/astro";

// The CLI build (tsc) owns ./dist; the web build gets its own output so the two surfaces
// of this one app don't clobber each other's artifacts.
export default defineConfig({
	outDir: "./dist-web",
});
