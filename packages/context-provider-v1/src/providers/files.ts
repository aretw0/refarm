import fs from "node:fs";
import path from "node:path";
import { CONTEXT_CAPABILITY } from "../types.js";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";

const MAX_FILE_BYTES = 4 * 1024;

export class FilesContextProvider implements ContextProvider {
	readonly name = "files";
	readonly capability = CONTEXT_CAPABILITY;

	constructor(private readonly files: string[]) {}

	async provide(request: ContextRequest): Promise<ContextEntry[]> {
		if (this.files.length === 0) return [];
		const entries: ContextEntry[] = [];
		for (const file of this.files) {
			const filePath = path.isAbsolute(file)
				? file
				: path.join(request.cwd, file);
			try {
				const buffer = fs.readFileSync(filePath);
				const content =
					buffer.length > MAX_FILE_BYTES
						? `${buffer.slice(0, MAX_FILE_BYTES).toString("utf-8")}\n[truncated at 4 KB]`
						: buffer.toString("utf-8");
				entries.push({ label: `file:${file}`, content, priority: 50 });
			} catch {
				// ignore unreadable files
			}
		}
		return entries;
	}
}
