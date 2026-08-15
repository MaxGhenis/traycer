import type { IpcMainInvokeEvent } from "electron";
import {
  RunnerHostEvent,
  RunnerHostInvoke,
} from "../../ipc-contracts/ipc-channels";
import type { BrowserViewTileKey } from "../../ipc-contracts/browser-view-types";
import type {
  PipCaptureIpcPayload,
  PipCaptureStartInput,
} from "../../ipc-contracts/pip-capture-types";
import type { BrowserViewManager } from "../browser-view/browser-view-manager";
import type { RunnerIpcBridge } from "./runner-ipc-bridge";

/**
 * Native-tab PiP capture IPC. Looks up the tile in every browser-view
 * manager (user partition and agent partition) so one preload surface
 * covers both native pools. Capture commands stay off the CDP dispatch
 * path - managers forward to `BrowserDebugSession` only.
 */
export function registerPipCaptureIpc(
  bridge: RunnerIpcBridge,
  managers: readonly BrowserViewManager[],
): void {
  bridge.handleInvoke(
    RunnerHostInvoke.pipCaptureStart,
    async (event, payload) => {
      const windowId = readSenderWindowId(bridge, event);
      const input = parsePipCaptureStart(payload);
      for (const manager of managers) {
        manager.stopPipCapture();
      }
      const onFrame = (framePayload: PipCaptureIpcPayload): void => {
        bridge.safeSendToWindow(
          windowId,
          RunnerHostEvent.pipCaptureFrame,
          framePayload,
        );
      };
      for (const manager of managers) {
        const started = await manager.startPipCapture(windowId, input, onFrame);
        if (started) return;
      }
      throw new Error("Browser view tile is not available for pip capture");
    },
  );

  bridge.handleInvoke(RunnerHostInvoke.pipCaptureStop, () => {
    for (const manager of managers) {
      manager.stopPipCapture();
    }
  });
}

function readSenderWindowId(
  bridge: RunnerIpcBridge,
  event: IpcMainInvokeEvent,
): string {
  const windowId = bridge.resolveSenderWindowId(event);
  if (windowId === null) {
    throw new Error("Pip capture IPC sender window is not registered");
  }
  return windowId;
}

function parsePipCaptureStart(value: unknown): PipCaptureStartInput {
  const record = assertRecord(value, "Pip capture start payload");
  return {
    tileKey: parseTileKey(record.tileKey),
    maxWidth: readPositiveInt(record.maxWidth, "maxWidth"),
    maxHeight: readPositiveInt(record.maxHeight, "maxHeight"),
    quality: readQuality(record.quality),
  };
}

function parseTileKey(value: unknown): BrowserViewTileKey {
  const record = assertRecord(value, "Pip capture tile key");
  return {
    viewTabId: readString(record.viewTabId, "viewTabId"),
    paneId: readString(record.paneId, "paneId"),
    tileInstanceId: readString(record.tileInstanceId, "tileInstanceId"),
    pageSessionId: readString(record.pageSessionId, "pageSessionId"),
  };
}

function assertRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error(`${label} must be an object`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Pip capture ${field} must be a non-empty string`);
  }
  return value;
}

function readPositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Pip capture ${field} must be a positive integer`);
  }
  return value;
}

function readQuality(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new Error("Pip capture quality must be an integer from 0 to 100");
  }
  return value;
}
