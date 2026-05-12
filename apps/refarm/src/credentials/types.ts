export interface CollectContext {
	tryOpenUrl: (url: string) => void;
}

export interface CredentialProvider {
	readonly id: string;
	readonly label: string;
	collect(ctx: CollectContext): Promise<string>;
}
