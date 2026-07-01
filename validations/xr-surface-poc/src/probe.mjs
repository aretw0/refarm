const WEBXR_SCHEMA = "refarm.webxr_capability.v1";

export async function probeWebXrCapability({
	navigatorLike = globalThis.navigator,
	isSecureContext = globalThis.isSecureContext,
	sessionMode = "immersive-vr",
} = {}) {
	if (!isSecureContext) {
		return report("blocked", "WebXR requires a secure context.", sessionMode, {
			secureContext: false,
			apiPresent: Boolean(navigatorLike?.xr),
		});
	}

	const xr = navigatorLike?.xr;
	if (!xr || typeof xr.isSessionSupported !== "function") {
		return report("unsupported", "navigator.xr.isSessionSupported is not available.", sessionMode, {
			secureContext: true,
			apiPresent: Boolean(xr),
		});
	}

	try {
		const supported = await xr.isSessionSupported(sessionMode);
		return report(
			supported ? "supported" : "unsupported",
			supported
				? `WebXR session mode is supported: ${sessionMode}`
				: `WebXR session mode is not supported: ${sessionMode}`,
			sessionMode,
			{
				secureContext: true,
				apiPresent: true,
			},
		);
	} catch (error) {
		return report("blocked", error instanceof Error ? error.message : String(error), sessionMode, {
			secureContext: true,
			apiPresent: true,
		});
	}
}

function report(status, reason, sessionMode, details) {
	return {
		ok: true,
		schema: WEBXR_SCHEMA,
		status,
		reason,
		sessionMode,
		fallback: "homestead-2d",
		...details,
	};
}
