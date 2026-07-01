import handler from "../dist/server/index.mjs";

addEventListener("fetch", (event) => {
	event.respondWith(handler.fetch(event.request));
});
