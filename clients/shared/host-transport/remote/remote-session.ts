import type { BearerSourceProvider } from "@traycer-clients/shared/auth/bearer-source";
import type { StreamAuthRevalidator } from "@traycer-clients/shared/auth/bearer-revalidator";
import {
  RemoteSession as ProtocolRemoteSession,
  type IRemoteSession,
  type RemoteSessionOptions as ProtocolRemoteSessionOptions,
} from "@traycer/protocol/host-transport/remote/session";
import type { RemoteSessionAuth } from "@traycer/protocol/host-transport/remote/auth";
import { extractBearerForOpenFrame } from "../ws-rpc-client";
import { recordNegotiatedHostMethods } from "../negotiated-manifest-registry";
import {
  ATTACH_ACK_TIMEOUT_MS,
  NOISE_HANDSHAKE_TIMEOUT_MS,
  RELAY_DIAL_TIMEOUT_MS,
  RELAY_PING_INTERVAL_MS,
  RELAY_PONG_TIMEOUT_MS,
  SESSION_OPEN_ACK_TIMEOUT_MS,
  UNARY_RESPONSE_TIMEOUT_MS,
} from "./config";

export type { IRemoteSession };
export { PLAN_RESTRICTED_FATAL_CODE } from "@traycer/protocol/host-transport/remote/session";

export interface RemoteSessionOptions<
  RpcRegistry extends
    import("@traycer/protocol/framework/index").VersionedRpcRegistry,
  StreamRegistry extends
    import("@traycer/protocol/framework/versioned-stream-rpc").VersionedStreamRpcRegistry,
> extends Omit<
  ProtocolRemoteSessionOptions<RpcRegistry, StreamRegistry>,
  "auth" | "timing" | "onNegotiatedMethods"
> {
  readonly bearer: BearerSourceProvider;
  readonly auth: StreamAuthRevalidator | null;
}

/**
 * Client compatibility adapter over the runtime-neutral protocol session.
 * It preserves the original constructor while keeping bearer/auth-service
 * coupling on the client side of the package boundary.
 */
export class RemoteSession<
  RpcRegistry extends
    import("@traycer/protocol/framework/index").VersionedRpcRegistry,
  StreamRegistry extends
    import("@traycer/protocol/framework/versioned-stream-rpc").VersionedStreamRpcRegistry,
> extends ProtocolRemoteSession<RpcRegistry, StreamRegistry> {
  constructor(options: RemoteSessionOptions<RpcRegistry, StreamRegistry>) {
    const { bearer, auth, ...coreOptions } = options;
    super({
      ...coreOptions,
      auth: createClientRemoteSessionAuth(bearer, auth),
      timing: {
        relayDialMs: RELAY_DIAL_TIMEOUT_MS,
        attachAckMs: ATTACH_ACK_TIMEOUT_MS,
        noiseHandshakeMs: NOISE_HANDSHAKE_TIMEOUT_MS,
        sessionOpenAckMs: SESSION_OPEN_ACK_TIMEOUT_MS,
        unaryResponseMs: UNARY_RESPONSE_TIMEOUT_MS,
        relayPingIntervalMs: RELAY_PING_INTERVAL_MS,
        relayPongTimeoutMs: RELAY_PONG_TIMEOUT_MS,
      },
      onNegotiatedMethods: recordNegotiatedHostMethods,
    });
  }
}

function createClientRemoteSessionAuth(
  bearer: BearerSourceProvider,
  auth: StreamAuthRevalidator | null | undefined,
): RemoteSessionAuth {
  const readBearer = (): string | null => {
    try {
      return extractBearerForOpenFrame(bearer());
    } catch {
      return null;
    }
  };
  return {
    missingOpenAuthCause: "missing-bearer",
    readOpenAuth: () => {
      const token = readBearer();
      if (token === null) {
        return null;
      }
      return { bearer: token, authz: null, fingerprint: token };
    },
    readCredentialUpdateBearer: readBearer,
    currentFingerprint: readBearer,
    revalidateForReconnect:
      auth === null || auth === undefined
        ? null
        : () => auth.revalidateForReconnect(),
  };
}
