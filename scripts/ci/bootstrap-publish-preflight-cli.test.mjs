import test from "node:test";

test("bootstrap preflight CLI loads without running a command on import", async () => {
	globalThis.__REFARM_BOOTSTRAP_PREFLIGHT_TEST__ = true;
	try {
		await import("./bootstrap-publish-preflight-cli.mjs");
	} finally {
		delete globalThis.__REFARM_BOOTSTRAP_PREFLIGHT_TEST__;
	}
});
