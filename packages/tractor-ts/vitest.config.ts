import { mergeConfig, defineConfig } from "vitest/config";
import { baseConfig } from "@refarm.dev/vtconfig";

export default mergeConfig(
  baseConfig,
  defineConfig({
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
