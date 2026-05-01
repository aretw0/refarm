import { createHomesteadHostRendererDescriptor } from "@refarm.dev/homestead/sdk/host-renderer";

export const REFARM_HEADLESS_RENDERER = createHomesteadHostRendererDescriptor(
  "refarm-headless",
  "headless",
);
