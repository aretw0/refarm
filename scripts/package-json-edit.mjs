function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceTopLevelJsonStringProperty(raw, key, value) {
	const parsed = JSON.parse(raw);
	if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
		throw new Error(`package.json is missing "${key}"`);
	}
	if (typeof parsed[key] !== "string") {
		throw new Error(`package.json "${key}" must be a string`);
	}

	const quotedValue = JSON.stringify(value);
	const pattern = new RegExp(
		`^([ \\t]*)"${escapeRegExp(key)}"(\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"(,?)$`,
		"m",
	);
	if (!pattern.test(raw)) {
		throw new Error(`package.json "${key}" line could not be updated without rewriting the file`);
	}

	const next = raw.replace(pattern, `$1"${key}"$2${quotedValue}$3`);
	const nextParsed = JSON.parse(next);
	if (nextParsed[key] !== value) {
		throw new Error(`package.json "${key}" update did not round-trip`);
	}
	return next;
}
