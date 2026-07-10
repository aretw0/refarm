import type { CapabilityArgSpec, CapabilityEntry, CapabilityOptionSpec } from "./types.js";
import { isCapabilityGroup } from "./types.js";

type JsonSchema = Record<string, unknown>;

export interface CapabilityOpenApiDocument {
	openapi: "3.1.0";
	info: {
		title: string;
		version: string;
	};
	paths: Record<string, Record<string, CapabilityOpenApiOperation>>;
}

export interface CapabilityOpenApiOperation {
	operationId: string;
	summary: string;
	"x-capability-name": string;
	requestBody?: {
		required: false;
		content: {
			"application/json": {
				schema: JsonSchema;
			};
		};
	};
	responses: {
		"200": {
			description: string;
			content: {
				"application/json": {
					schema: JsonSchema;
				};
			};
		};
	};
}

export interface CapabilityOpenApiOptions {
	title?: string;
	version?: string;
	prefix?: string;
}

interface HttpOpenApiRoute {
	name: string;
	summary: string;
	method: string;
	path: string;
	args?: CapabilityArgSpec[];
	options?: CapabilityOptionSpec[];
}

function normalizePrefix(prefix: string): string {
	if (!prefix || prefix === "/") return "";
	return prefix.startsWith("/") ? prefix.replace(/\/+$/u, "") : `/${prefix.replace(/\/+$/u, "")}`;
}

function joinPath(prefix: string, path: string): string {
	const normalizedPrefix = normalizePrefix(prefix);
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${normalizedPrefix}${normalizedPath}`;
}

function operationId(name: string): string {
	const normalized = name.replace(/[^A-Za-z0-9_]+/gu, "_").replace(/^_+|_+$/gu, "");
	return normalized || "capability";
}

function optionSchema(option: CapabilityOptionSpec): JsonSchema {
	if (option.kind === "boolean") return { type: "boolean", description: option.summary };
	if (option.kind === "string[]") {
		return {
			type: "array",
			items: { type: "string" },
			description: option.summary,
		};
	}
	return { type: "string", description: option.summary };
}

function requestSchema(
	args: readonly CapabilityArgSpec[] = [],
	options: readonly CapabilityOptionSpec[] = [],
): JsonSchema {
	return {
		type: "object",
		properties: {
			args: {
				type: "object",
				properties: Object.fromEntries(
					args.map((arg) => [
						arg.name,
						arg.variadic ? { type: "array", items: { type: "string" } } : { type: "string" },
					]),
				),
				additionalProperties: true,
			},
			options: {
				type: "object",
				properties: Object.fromEntries(
					options.map((option) => [option.name, optionSchema(option)]),
				),
				additionalProperties: true,
			},
		},
		additionalProperties: false,
	};
}

function responseSchema(): JsonSchema {
	return {
		type: "object",
		additionalProperties: true,
	};
}

function httpRoutes(entries: readonly CapabilityEntry[], prefix: string): HttpOpenApiRoute[] {
	const routes: HttpOpenApiRoute[] = [];
	for (const entry of entries) {
		const http = entry.transports?.http;
		if (!http?.path) continue;
		const action = isCapabilityGroup(entry)
			? entry.defaultAction
				? entry.actions[entry.defaultAction]
				: null
			: entry;
		if (!action) continue;
		routes.push({
			name: entry.name,
			summary: action.summary,
			method: (http.method ?? "POST").toLowerCase(),
			path: joinPath(prefix, http.path),
			args: action.args,
			options: action.options,
		});
	}
	return routes;
}

export function buildCapabilityOpenApiDocument(
	entries: readonly CapabilityEntry[],
	options: CapabilityOpenApiOptions = {},
): CapabilityOpenApiDocument {
	const paths: CapabilityOpenApiDocument["paths"] = {};
	for (const route of httpRoutes(entries, options.prefix ?? "")) {
		const methods = paths[route.path] ?? {};
		const operation: CapabilityOpenApiOperation = {
			operationId: operationId(route.name),
			summary: route.summary,
			"x-capability-name": route.name,
			responses: {
				"200": {
					description: "Capability JSON envelope.",
					content: {
						"application/json": { schema: responseSchema() },
					},
				},
			},
		};
		if (route.method !== "get") {
			operation.requestBody = {
				required: false,
				content: {
					"application/json": {
						schema: requestSchema(route.args, route.options),
					},
				},
			};
		}
		methods[route.method] = operation;
		paths[route.path] = methods;
	}
	return {
		openapi: "3.1.0",
		info: {
			title: options.title ?? "Capability API",
			version: options.version ?? "0.1.0",
		},
		paths,
	};
}
