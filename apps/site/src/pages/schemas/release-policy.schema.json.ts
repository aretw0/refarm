import releasePolicySchema from "../../../../../packages/release-engine/release-policy.schema.json";

export const prerender = true;

export function GET() {
	return new Response(`${JSON.stringify(releasePolicySchema, null, "\t")}\n`, {
		headers: {
			"Content-Type": "application/schema+json; charset=utf-8",
		},
	});
}
