const CACHE_NAME = "refarm-me-shell-v1";

function scopeUrl(path) {
	return new URL(path, self.registration.scope).href;
}

async function cacheShell() {
	const cache = await caches.open(CACHE_NAME);
	await cache.addAll([scopeUrl("./"), scopeUrl("manifest.webmanifest")]);
}

self.addEventListener("install", (event) => {
	event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key !== CACHE_NAME)
						.map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	if (request.mode === "navigate") {
		event.respondWith(networkFirst(request, scopeUrl("./")));
		return;
	}

	event.respondWith(networkFirst(request));
});

async function networkFirst(request, fallbackUrl) {
	const cache = await caches.open(CACHE_NAME);
	try {
		const response = await fetch(request);
		if (response.ok) {
			await cache.put(request, response.clone());
		}
		return response;
	} catch (error) {
		const cached = await cache.match(request);
		if (cached) return cached;
		if (fallbackUrl) {
			const fallback = await cache.match(fallbackUrl);
			if (fallback) return fallback;
		}
		throw error;
	}
}
