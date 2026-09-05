import type { Effort } from "@refarm.dev/effort-contract-v1";
import fs from "node:fs";
import path from "node:path";
import {
	EffortCoordinator,
	type EffortCoordinatorOptions,
	type RuntimeTelemetrySnapshot,
	type RuntimeTelemetryWindow,
} from "../effort-coordinator.js";
import type { EffortOperations } from "../effort-operations.js";
import type { TaskExecutorFn } from "../effort-processor.js";
import { FileEffortRepository } from "./file-effort-repository.js";

export type { TaskExecutorFn };
export type FileTransportOptions = EffortCoordinatorOptions;
export type { RuntimeTelemetrySnapshot, RuntimeTelemetryWindow };

export class FileTransportAdapter {
	private readonly repository: FileEffortRepository;
	private readonly coordinator: EffortCoordinator;

	constructor(baseDir: string, executor: TaskExecutorFn, options: FileTransportOptions = {}) {
		this.repository = new FileEffortRepository(baseDir);
		this.coordinator = new EffortCoordinator(this.repository, executor, options);
	}

	get operations(): EffortOperations {
		return this.coordinator;
	}

	async submit(effort: Effort): Promise<string> {
		return this.coordinator.submit(effort);
	}

	async query(effortId: string) {
		return this.coordinator.query(effortId);
	}

	async list() {
		return this.coordinator.list();
	}

	async logs(effortId: string) {
		return this.coordinator.logs(effortId);
	}

	async retry(effortId: string): Promise<boolean> {
		return this.coordinator.retry(effortId);
	}

	async cancel(effortId: string): Promise<boolean> {
		return this.coordinator.cancel(effortId);
	}

	async summary() {
		return this.coordinator.summary();
	}

	async telemetry(): Promise<RuntimeTelemetrySnapshot> {
		return this.coordinator.telemetry();
	}

	async telemetryWindow(minutes: number): Promise<RuntimeTelemetryWindow> {
		return this.coordinator.telemetryWindow(minutes);
	}

	async process(effort: Effort): Promise<void> {
		await this.coordinator.process(effort);
	}

	watch(): () => void {
		const processTaskFile = (filename: string): void => {
			if (!filename.endsWith(".json")) return;
			const effortId = filename.replace(/\.json$/, "");
			if (!effortId) return;
			this.coordinator.enqueue(effortId);
		};

		const processControlFile = (filename: string): void => {
			if (!filename.endsWith(".json")) return;
			const filePath = path.join(this.repository.controlDir, filename);
			if (!fs.existsSync(filePath)) return;

			const retryMatch = filename.match(/^(.+)\.retry\.json$/);
			const cancelMatch = filename.match(/^(.+)\.cancel\.json$/);
			try {
				if (retryMatch) {
					void this.coordinator.retry(retryMatch[1]!);
					return;
				}
				if (cancelMatch) {
					void this.coordinator.cancel(cancelMatch[1]!);
					return;
				}
			} finally {
				try {
					fs.unlinkSync(filePath);
				} catch {
					// best effort
				}
			}
		};

		for (const filename of fs.readdirSync(this.repository.tasksDir)) {
			processTaskFile(filename);
		}

		for (const filename of fs.readdirSync(this.repository.resultsDir)) {
			if (!filename.endsWith(".json")) continue;
			const effortId = filename.replace(/\.json$/, "");
			const result = this.repository.readResult(effortId);
			if (!result) continue;
			if (result.status === "pending" || result.status === "in-progress") {
				this.coordinator.enqueue(effortId);
			}
		}

		for (const filename of fs.readdirSync(this.repository.controlDir)) {
			processControlFile(filename);
		}

		const tasksWatcher = fs.watch(this.repository.tasksDir, (event, filename) => {
			if (!filename || (event !== "rename" && event !== "change")) return;
			processTaskFile(filename.toString());
		});

		const controlWatcher = fs.watch(this.repository.controlDir, (event, filename) => {
			if (!filename || (event !== "rename" && event !== "change")) return;
			processControlFile(filename.toString());
		});

		return () => {
			tasksWatcher.close();
			controlWatcher.close();
		};
	}
}
