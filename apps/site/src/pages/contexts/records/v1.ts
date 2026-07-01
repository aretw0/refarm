export const prerender = true;

const recordsContext = {
	"@context": {
		"@version": 1.1,
		records: "https://refarm.dev/contexts/records/v1#",
		KnowledgeRecord: "records:KnowledgeRecord",
		Requirement: "records:Requirement",
		RecordAttachment: "records:RecordAttachment",
		RecordRelation: "records:RecordRelation",
		RecordReview: "records:RecordReview",
		RecordSection: "records:RecordSection",
		attachments: "records:attachments",
		attrs: "records:attrs",
		by: "records:by",
		content: "records:content",
		contentHash: "records:contentHash",
		fields: "records:fields",
		id: "@id",
		key: "records:key",
		mediaType: "records:mediaType",
		notes: "records:notes",
		ref: {
			"@id": "records:ref",
			"@type": "@id",
		},
		relations: "records:relations",
		review: "records:review",
		schemaVersion: "records:schemaVersion",
		sections: "records:sections",
		sourceRefs: {
			"@container": "@set",
			"@id": "records:sourceRefs",
			"@type": "@id",
		},
		state: "records:state",
		target: {
			"@id": "records:target",
			"@type": "@id",
		},
		type: "records:type",
	},
};

export function GET() {
	return new Response(`${JSON.stringify(recordsContext, null, "\t")}\n`, {
		headers: {
			"Content-Type": "application/ld+json; charset=utf-8",
		},
	});
}
