import releaseOutputSchema from "../../../../../packages/release-engine/release-output.schema.json";

export const prerender = true;

export function GET() {
	return new Response(`${JSON.stringify(releaseOutputSchema, null, "\t")}\n`, {
		headers: {
			"Content-Type": "application/schema+json; charset=utf-8",
		},
	});
}
