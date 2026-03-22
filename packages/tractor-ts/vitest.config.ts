import { mergeConfig, defineConfig } from "vitest/config";
import { baseConfig, getAliases } from "@refarm.dev/vtconfig";
import path from "node:path";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: getAliases(path.resolve(__dirname, "../../"))
    },
    test: {
      environment: "node",
      include: ["test/**/*.test.ts"],
      server: {
        deps: {
          inline: ["@bytecodealliance/jco", "@noble/ed25519"]
        }
      },
      coverage: {
        exclude: [
          'src/transpiled/**'
        ]
      }
    },
  })
);
