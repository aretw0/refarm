import handler from "../dist/server/entry.mjs";

addEventListener("fetch", (event) => {
	event.respondWith(handler.fetch(event.request));
});
