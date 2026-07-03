import os from "node:os";
import path from "node:path";

export function defaultConsumerSourceCacheRoot() {
	return process.env.REFARM_SOURCE_CACHE_ROOT ?? path.join(os.homedir(), ".cache", "checkouts");
}

export function githubCheckoutPath(owner, repo, cacheRoot = defaultConsumerSourceCacheRoot()) {
	return path.join(cacheRoot, "github.com", owner, repo);
}

export function aretw0CheckoutPath(repo, cacheRoot = defaultConsumerSourceCacheRoot()) {
	return githubCheckoutPath("aretw0", repo, cacheRoot);
}
