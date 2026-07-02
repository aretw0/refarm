export const prerender = false;

export function GET() {
	return Response.json({
		status: "ok",
		marker: "refarm-astro-wasi-ssr-poc",
	});
}
