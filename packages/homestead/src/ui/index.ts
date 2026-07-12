// The runtime export is the compiled Astro component (the consumer's Astro build handles
// the .astro). We RE-DECLARE its type here as a plain component signature and re-export
// under that type, so `dist/ui/index.d.ts` is self-contained — no dangling `./Layout.astro`
// reference — and `@refarm.dev/homestead/ui` type-checks from dist. That means a consumer
// (apps/me, apps/dev, the examples) no longer needs a tsconfig `paths` mapping to source.
// @ts-expect-error — Astro resolves the .astro import; tsc doesn't, which is the point.
import LayoutComponent from "./Layout.astro";

/** An Astro layout component — a factory the Astro renderer invokes with props. */
export type AstroLayoutComponent = (props: Record<string, unknown>) => unknown;

export const Layout: AstroLayoutComponent = LayoutComponent as AstroLayoutComponent;
