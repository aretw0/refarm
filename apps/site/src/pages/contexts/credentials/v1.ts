export const prerender = true;

const credentialsContext = {
	"@context": {
		"@version": 1.1,
		credentials: "https://refarm.dev/contexts/credentials/v1#",
		ClaimConstraint: "credentials:ClaimConstraint",
		CredentialProof: "credentials:CredentialProof",
		CredentialStatusRef: "credentials:CredentialStatusRef",
		CredentialVerificationCheck: "credentials:CredentialVerificationCheck",
		CredentialVerificationPolicy: "credentials:CredentialVerificationPolicy",
		CredentialVerificationResult: "credentials:CredentialVerificationResult",
		RefarmConformanceCredential: "credentials:RefarmConformanceCredential",
		TrustRegistryRef: "credentials:TrustRegistryRef",
		capability: "credentials:capability",
		checks: "credentials:checks",
		claimsSatisfied: "credentials:claimsSatisfied",
		code: "credentials:code",
		created: "credentials:created",
		failures: "credentials:failures",
		holder: {
			"@id": "credentials:holder",
			"@type": "@id",
		},
		holderBound: "credentials:holderBound",
		issuerTrusted: "credentials:issuerTrusted",
		message: "credentials:message",
		notRevoked: "credentials:notRevoked",
		ok: "credentials:ok",
		path: "credentials:path",
		proof: "credentials:proof",
		requiredClaims: {
			"@container": "@set",
			"@id": "credentials:requiredClaims",
		},
		revocation: "credentials:revocation",
		signature: "credentials:signature",
		statusListCredential: {
			"@id": "credentials:statusListCredential",
			"@type": "@id",
		},
		statusListIndex: "credentials:statusListIndex",
		statusPurpose: "credentials:statusPurpose",
		trustRegistry: "credentials:trustRegistry",
		trustSelf: "credentials:trustSelf",
		trustedIssuers: {
			"@container": "@set",
			"@id": "credentials:trustedIssuers",
			"@type": "@id",
		},
		validity: "credentials:validity",
		verificationMethod: {
			"@id": "credentials:verificationMethod",
			"@type": "@id",
		},
		verified: "credentials:verified",
		withinValidity: "credentials:withinValidity",
	},
};

export function GET() {
	return new Response(`${JSON.stringify(credentialsContext, null, "\t")}\n`, {
		headers: {
			"Content-Type": "application/ld+json; charset=utf-8",
		},
	});
}
