import { ipcRenderer } from "electron";
import {
  RunnerHostEvent,
  RunnerHostInvoke,
} from "../ipc-contracts/ipc-channels";
import type { BrowserViewTileKey } from "../ipc-contracts/browser-view-types";
import type {
  PipCaptureIpcPayload,
  PipCaptureServerFrame,
} from "../ipc-contracts/pip-capture-types";
import { subscribe, type Disposable } from "./subscribe";

export interface PipCaptureBridgeSurface {
  pipCapture: {
    start(
      tileKey: BrowserViewTileKey,
      maxWidth: number,
      maxHeight: number,
      quality: number,
    ): Promise<void>;
    stop(): Promise<void>;
    onFrame(
      handler: (
        frame: PipCaptureServerFrame,
        jpegBytes: Uint8Array | null,
      ) => void,
    ): Disposable;
  };
}

export function buildPipCaptureBridge(): PipCaptureBridgeSurface {
  return {
    pipCapture: {
      start: (tileKey, maxWidth, maxHeight, quality) =>
        ipcRenderer.invoke(RunnerHostInvoke.pipCaptureStart, {
          tileKey,
          maxWidth,
          maxHeight,
          quality,
        }) as Promise<void>,
      stop: () =>
        ipcRenderer.invoke(RunnerHostInvoke.pipCaptureStop) as Promise<void>,
      onFrame: (handler) =>
        subscribe<PipCaptureIpcPayload>(
          RunnerHostEvent.pipCaptureFrame,
          (payload) => {
            handler(payload.frame, payload.jpegBytes);
          },
        ),
    },
  };
}
