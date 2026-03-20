import { CommandHost } from "./command-host";
import { EventEmitter, TelemetryEvent } from "./telemetry";

export interface RecoveryRequest {
  providerId: string;
  identityRoot: string;
  newDevicePubkey: string;
  timestamp: number;
}

export interface RecoveryProof {
  type: string;
  data: Uint8Array;
}

export interface RecoveryProvider {
  id: string;
  name: string;
  initiate(
    request: RecoveryRequest,
  ): Promise<{ sessionId: string; requiredProofs: string[] }>;
  submitProof(sessionId: string, proof: RecoveryProof): Promise<boolean>;
  finalize(sessionId: string): Promise<Uint8Array>;
}

export class IdentityRecoveryHost {
  private providers: Map<string, RecoveryProvider> = new Map();
  private activeSessions: Map<
    string,
    { providerId: string; sessionId: string }
  > = new Map();
  private emit?: (data: TelemetryEvent) => void;

  constructor() {}

  register(events: EventEmitter, commands: CommandHost) {
    this.emit = (data: TelemetryEvent) => events.emit(data);

    commands.register({
      id: "system:security:recovery:initiate",
      title: "Initiate Account Recovery",
      category: "Security",
      handler: async (args: {
        providerId: string;
        request: RecoveryRequest;
      }) => {
        return this.initiateRecovery(args.providerId, args.request);
      },
    });
  }

  registerProvider(provider: RecoveryProvider) {
    this.providers.set(provider.id, provider);
    this.emit?.({
      event: "system:recovery_provider_registered",
      payload: { id: provider.id, name: provider.name },
    });
  }

  async initiateRecovery(providerId: string, request: RecoveryRequest) {
    const provider = this.providers.get(providerId);
    if (!provider)
      throw new Error(`[recovery] Provider not found: ${providerId}`);

    const result = await provider.initiate(request);
    const tractorSessionId = Math.random().toString(36).substring(7);
    this.activeSessions.set(tractorSessionId, {
      providerId,
      sessionId: result.sessionId,
    });

    this.emit?.({
      event: "system:recovery_initiated",
      payload: { tractorSessionId, providerId },
    });
    return { tractorSessionId, ...result };
  }

  async submitProof(tractorSessionId: string, proof: RecoveryProof) {
    const session = this.activeSessions.get(tractorSessionId);
    if (!session)
      throw new Error(`[recovery] Session not found: ${tractorSessionId}`);

    const provider = this.providers.get(session.providerId)!;
    const success = await provider.submitProof(session.sessionId, proof);

    this.emit?.({
      event: "system:recovery_proof_submitted",
      payload: { tractorSessionId, success },
    });
    return success;
  }

  async finalizeRecovery(tractorSessionId: string) {
    const session = this.activeSessions.get(tractorSessionId);
    if (!session)
      throw new Error(`[recovery] Session not found: ${tractorSessionId}`);

    const provider = this.providers.get(session.providerId)!;
    const signature = await provider.finalize(session.sessionId);

    this.activeSessions.delete(tractorSessionId);
    this.emit?.({
      event: "system:recovery_finalized",
      payload: { tractorSessionId },
    });

    return signature;
  }
}
