import { defineConfig } from "@refarm.dev/config/astro";

// ADR-088: proxy the runtime effort + activity endpoints to the sidecar during dev, so
// the browser chat face talks same-origin (the same posture `refarm serve` gives in
// production). Points at the sidecar's default 127.0.0.1:42001.
const SIDECAR = process.env.REFARM_SIDECAR_URL ?? "http://127.0.0.1:42001";

export default defineConfig({
  // Refarm defaults are automatically injected via the central config package.
  vite: {
    server: {
      proxy: {
        "/efforts": SIDECAR,
        "/stream": SIDECAR,
      },
    },
  },
});
