import type { ServiceManifest } from "../../types.js";

export const turboCacheManifest: ServiceManifest = {
  id: "turbo-cache",
  displayName: "Turborepo Remote Cache",
  description: "Cloudflare Worker + R2 implementing Turborepo Remote Cache API v8",
  ciSecrets: ["TURBO_CACHE_API_URL", "TURBO_CACHE_TOKEN"],
};
