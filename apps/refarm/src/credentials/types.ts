import type { OperatorChannel } from "@refarm.dev/prompt-contract-v1";

export interface CollectContext {
	tryOpenUrl: (url: string) => void;
	operator?: OperatorChannel;
}

export interface CredentialProvider {
	readonly id: string;
	readonly label: string;
	collect(ctx: CollectContext): Promise<string>;
}
