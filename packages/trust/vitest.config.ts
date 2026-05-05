import { mergeConfig, defineConfig } from "vitest/config";
import { baseConfig, getAliases } from "@refarm.dev/vtconfig";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: getAliases(path.resolve(__dirname, "../../")),
    },
    test: {
      environment: "node",
      include: ["test/**/*.test.ts"],
    },
  })
);
