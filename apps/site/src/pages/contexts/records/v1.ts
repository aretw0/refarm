export const prerender = true;

const recordsContext = {
	"@context": {
		"@version": 1.1,
		"@vocab": "https://refarm.dev/contexts/records/v1#",
		KnowledgeRecord: "https://refarm.dev/contexts/records/v1#KnowledgeRecord",
		Requirement: "https://refarm.dev/contexts/records/v1#Requirement",
		RecordAttachment: "https://refarm.dev/contexts/records/v1#RecordAttachment",
		RecordRelation: "https://refarm.dev/contexts/records/v1#RecordRelation",
		RecordReview: "https://refarm.dev/contexts/records/v1#RecordReview",
		RecordSection: "https://refarm.dev/contexts/records/v1#RecordSection",
		attachments: "https://refarm.dev/contexts/records/v1#attachments",
		at: "https://refarm.dev/contexts/records/v1#at",
		attrs: "https://refarm.dev/contexts/records/v1#attrs",
		by: "https://refarm.dev/contexts/records/v1#by",
		content: "https://refarm.dev/contexts/records/v1#content",
		contentHash: "https://refarm.dev/contexts/records/v1#contentHash",
		fields: "https://refarm.dev/contexts/records/v1#fields",
		hash: "https://refarm.dev/contexts/records/v1#hash",
		id: "@id",
		key: "https://refarm.dev/contexts/records/v1#key",
		manifestVersion: "https://refarm.dev/contexts/records/v1#manifestVersion",
		mediaType: "https://refarm.dev/contexts/records/v1#mediaType",
		notes: "https://refarm.dev/contexts/records/v1#notes",
		ref: {
			"@id": "https://refarm.dev/contexts/records/v1#ref",
			"@type": "@id",
		},
		relations: "https://refarm.dev/contexts/records/v1#relations",
		records: "https://refarm.dev/contexts/records/v1#records",
		review: "https://refarm.dev/contexts/records/v1#review",
		schemaVersion: "https://refarm.dev/contexts/records/v1#schemaVersion",
		sections: "https://refarm.dev/contexts/records/v1#sections",
		sourceRefs: {
			"@container": "@set",
			"@id": "https://refarm.dev/contexts/records/v1#sourceRefs",
			"@type": "@id",
		},
		state: "https://refarm.dev/contexts/records/v1#state",
		target: {
			"@id": "https://refarm.dev/contexts/records/v1#target",
			"@type": "@id",
		},
		type: "https://refarm.dev/contexts/records/v1#type",
	},
};

export function GET() {
	return new Response(`${JSON.stringify(recordsContext, null, "\t")}\n`, {
		headers: {
			"Content-Type": "application/ld+json; charset=utf-8",
		},
	});
}
