export interface RefarmMePwaRegistrationOptions {
	baseUrl?: string;
	document?: Document;
	navigator?: Navigator;
}

export interface RefarmMePwaRegistrationResult {
	status: "ready" | "unsupported";
	registration?: ServiceWorkerRegistration;
}

export async function registerRefarmMePwa(
	options: RefarmMePwaRegistrationOptions = {},
): Promise<RefarmMePwaRegistrationResult> {
	const doc = options.document ?? document;
	const nav = options.navigator ?? navigator;
	if (!("serviceWorker" in nav)) {
		doc.documentElement.dataset.refarmMePwa = "unsupported";
		return { status: "unsupported" };
	}

	const base = normalizeBaseUrl(options.baseUrl ?? "/");
	const registration = await nav.serviceWorker.register(
		new URL("service-worker.js", window.location.origin + base),
		{ scope: base },
	);
	await nav.serviceWorker.ready;
	doc.documentElement.dataset.refarmMePwa = "ready";
	return { status: "ready", registration };
}

function normalizeBaseUrl(baseUrl: string): string {
	if (baseUrl.length === 0) return "/";
	const withLeadingSlash = baseUrl.startsWith("/") ? baseUrl : `/${baseUrl}`;
	return withLeadingSlash.endsWith("/")
		? withLeadingSlash
		: `${withLeadingSlash}/`;
}
