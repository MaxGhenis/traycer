import {
  browserScreencastServerFrameSchema,
  type BrowserScreencastServerFrame,
} from "@traycer/protocol/host/browser/contracts";
import type { IHostStreamClient } from "@traycer-clients/shared/host-transport/host-stream-client";
import type { HostStreamRpcRegistry } from "@traycer/protocol/host/registry";

export const PIP_HEADLESS_MAX_WIDTH = 480;
export const PIP_HEADLESS_MAX_HEIGHT = 360;
export const PIP_HEADLESS_QUALITY = 50;

export type PipStreamSourceKind = "native" | "headless";

export interface PipHeadlessStreamHandle {
  close(): void;
  setPaused(paused: boolean): void;
}

/**
 * Native binding + desktop capture wins. Otherwise the tab-host stream
 * client opens a `role: "pip"` screencast. Never both.
 */
export function selectPipStreamSource(input: {
  readonly hasNativeBinding: boolean;
  readonly hasNativeCapture: boolean;
  readonly hasHeadlessClient: boolean;
}): PipStreamSourceKind | null {
  if (input.hasNativeBinding && input.hasNativeCapture) return "native";
  if (input.hasHeadlessClient) return "headless";
  return null;
}

/**
 * Same transport as the peek tile, without visibility registration, input
 * arming, or tile-open resume. Pause only gates frames.
 */
export function openPipHeadlessStream(input: {
  readonly client: IHostStreamClient<HostStreamRpcRegistry>;
  readonly epicId: string;
  readonly sessionId: string;
  readonly tabId: string;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly quality: number;
  readonly onFrame: (
    frame: BrowserScreencastServerFrame,
    jpegBytes: Uint8Array | null,
  ) => void;
}): PipHeadlessStreamHandle {
  const session = input.client.subscribe("browser.screencast", {
    epicId: input.epicId,
    sessionId: input.sessionId,
    tabId: input.tabId,
    maxWidth: input.maxWidth,
    maxHeight: input.maxHeight,
    quality: input.quality,
    format: "jpeg",
    role: "pip",
  });
  session.onServerFrame((envelope, binaryPayload) => {
    const parsed = browserScreencastServerFrameSchema.safeParse(envelope);
    if (!parsed.success) return;
    input.onFrame(parsed.data, binaryPayload);
  });
  return {
    close: () => {
      session.close();
    },
    setPaused: (paused: boolean) => {
      session.sendClientFrame(
        { kind: "setPaused", hasBinaryPayload: false, paused },
        null,
      );
    },
  };
}
