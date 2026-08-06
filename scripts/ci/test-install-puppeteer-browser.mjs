import assert from "node:assert/strict";
import test from "node:test";
import { resolveDiagramBrowserPlan } from "./install-puppeteer-browser.mjs";

test("resolves Chrome from Mermaid CLI's own Puppeteer dependency", () => {
	const plan = resolveDiagramBrowserPlan({ cacheDir: "/tmp/refarm-diagram-browser-test" });
	assert.match(plan.browserSpec, /^chrome-headless-shell@\d+\.\d+\.\d+\.\d+$/);
	assert.match(plan.mermaidCliEntry, /@mermaid-js[+/]mermaid-cli/);
	assert.match(plan.puppeteerCoreEntry, /puppeteer-core/);
	assert.equal(plan.cacheDir, "/tmp/refarm-diagram-browser-test");
});
