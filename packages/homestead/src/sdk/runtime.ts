import { OPFSSQLiteAdapter } from "@refarm.dev/storage-sqlite";
import {
	BrowserSyncClient,
	LoroCRDTStorage,
	randomPeerId,
} from "@refarm.dev/sync-loro";
import { Tractor } from "@refarm.dev/tractor";

export const STUDIO_DEFAULT_ENV_METADATA = {
	version: "0.1.0-solo-fertil",
	commit: "dev",
} as const;

export interface StudioRuntimeDatabaseNameOptions {
	mode?: string | null;
	persistentName?: string;
	temporaryPrefix: string;
	now?: () => number;
}

export interface StudioRuntimeIdentity {
	id: string;
	getPublicKey(): Promise<string>;
	sign(data: string): Promise<string>;
}

export interface BootStudioRuntimeOptions {
	databaseName: string;
	namespace: string;
	identityId: string;
	identityPublicKey?: string;
	envMetadata?: Record<string, string>;
	connectBrowserSync?: boolean;
	tractorSync?: boolean;
}

export interface StudioRuntime {
	databaseName: string;
	identity: StudioRuntimeIdentity;
	sqliteStorage: unknown;
	storage: LoroCRDTStorage;
	syncClient?: BrowserSyncClient;
	tractor: Awaited<ReturnType<typeof Tractor.boot>>;
}

export function resolveStudioRuntimeDatabaseName(
	options: StudioRuntimeDatabaseNameOptions,
): string {
	if (options.mode === "citizen" && options.persistentName) {
		return options.persistentName;
	}
	const now = options.now ?? Date.now;
	return `${options.temporaryPrefix}-${now()}`;
}

export function createStudioRuntimeIdentity(
	id: string,
	publicKey = id,
): StudioRuntimeIdentity {
	return {
		id,
		getPublicKey: async () => publicKey,
		sign: async (data: string) => data,
	};
}

export async function bootStudioRuntime(
	options: BootStudioRuntimeOptions,
): Promise<StudioRuntime> {
	const sqliteStorage = await new OPFSSQLiteAdapter().open(
		options.databaseName,
	);
	const storage = new LoroCRDTStorage(sqliteStorage as any, randomPeerId());
	const identity = createStudioRuntimeIdentity(
		options.identityId,
		options.identityPublicKey,
	);
	const syncClient = options.connectBrowserSync
		? new BrowserSyncClient(storage)
		: undefined;

	if (syncClient) syncClient.connect();

	const tractor = await Tractor.boot({
		storage: storage as any,
		...(options.tractorSync ? { sync: storage } : {}),
		identity: identity as any,
		namespace: options.namespace,
		envMetadata: options.envMetadata ?? STUDIO_DEFAULT_ENV_METADATA,
	});

	return {
		databaseName: options.databaseName,
		identity,
		sqliteStorage,
		storage,
		syncClient,
		tractor,
	};
}
