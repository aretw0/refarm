import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@refarm/storage-contract-v1": fileURLToPath(
        new URL("../storage-contract-v1/dist/index.js", import.meta.url),
      ),
    },
  },
});
