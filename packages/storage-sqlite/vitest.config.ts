import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@refarm.dev/storage-contract-v1": fileURLToPath(
        new URL("../storage-contract-v1/src/index.ts", import.meta.url),
      ),
    },
  },
});
