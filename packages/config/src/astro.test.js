import { describe, expect, it } from "vitest";

import { coreAstroAliases } from "./astro.js";

describe("astro config aliases", () => {
    it("keeps tractor browser subpath from being captured by the tractor root alias", () => {
        const aliases = coreAstroAliases("/workspaces/refarm");
        const aliasEntries = Object.entries(aliases);

        expect(aliases["@refarm.dev/tractor/browser"]).toBe(
            "/workspaces/refarm/packages/tractor-ts/src/index.browser.ts",
        );
        expect(aliases["@refarm.dev/tractor"]).toBe(
            "/workspaces/refarm/packages/tractor-ts/src/index.browser.ts",
        );
        expect(aliasEntries.findIndex(([id]) => id === "@refarm.dev/tractor/browser")).toBeLessThan(
            aliasEntries.findIndex(([id]) => id === "@refarm.dev/tractor"),
        );
    });
});
