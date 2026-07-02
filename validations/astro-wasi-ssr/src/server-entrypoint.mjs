import { App } from "astro/app";
import { manifest } from "virtual:astro:manifest";

const app = new App(manifest);

export default {
	fetch(request) {
		return app.render(request);
	},
};
