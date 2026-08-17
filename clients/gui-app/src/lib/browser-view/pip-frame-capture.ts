import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { BrowserScreencastServerFrame } from "@traycer/protocol/host/browser/contracts";
import type { HostStreamRpcRegistry } from "@traycer/protocol/host/registry";
import type { IHostStreamClient } from "@traycer-clients/shared/host-transport/host-stream-client";
import { useHostDirectoryEntry } from "@/hooks/host/use-host-directory-entry";
import { useHostStreamClientFor } from "@/hooks/host/use-host-stream-client-for";
import {
  resolveDesktopPipCaptureBridge,
  type DesktopPipCaptureBridge,
} from "@/lib/browser-view/desktop-pip-capture";
import {
  useElectronBrowserTabBinding,
  type ElectronBrowserTabRegistration,
} from "@/lib/browser-view/electron-browser-tab-store";
import { incrementPipHeadlessArmRunsForTests } from "@/lib/browser-view/pip-capture-arm-counts";
import {
  openPipHeadlessStream,
  PIP_HEADLESS_MAX_HEIGHT,
  PIP_HEADLESS_MAX_WIDTH,
  PIP_HEADLESS_QUALITY,
} from "@/lib/browser-view/pip-headless-stream";
import {
  applyPipStreamHealth,
  type PipSnapshot,
} from "@/lib/browser-view/pip-store";
import { useStreamAuthRevalidator } from "@/lib/host/stream-auth-revalidator";
import { useRunnerHostOrNull } from "@/providers/use-runner-host";

interface OwnedPipFrame {
  readonly burstId: string;
  readonly src: string;
}

export function usePipOwnedFrame(
  epicId: string,
  snapshot: PipSnapshot,
): string | null {
  const runnerHost = useRunnerHostOrNull();
  const target = snapshot.target;
  const hostId = target?.hostId ?? "";
  const sessionId = target?.sessionId ?? "";
  const tabId = target?.tabId ?? "";
  const burstId = target?.burstId ?? null;
  const binding = useElectronBrowserTabBinding(sessionId, tabId);
  const hostEntry = useHostDirectoryEntry(hostId);
  const auth = useStreamAuthRevalidator();
  const client = useHostStreamClientFor(
    target === null ? null : hostEntry,
    auth,
  );
  const bridge = useMemo(
    () =>
      runnerHost === null ? null : resolveDesktopPipCaptureBridge(runnerHost),
    [runnerHost],
  );
  const useNative = binding !== null && bridge !== null;
  const live = snapshot.phase === "live";
  const retain = shouldRetainPipFrame(snapshot.phase, burstId);
  const { owned, setOwned } = usePipFrameOwner(burstId, retain);
  const clientHandle = usePipHostClientHandle(client);

  usePipNativeCaptureArm({
    binding,
    bridge,
    burstId,
    enabled: live && useNative,
    epicId,
    setOwned,
  });
  usePipHeadlessCaptureArm({
    burstId,
    clientHandle,
    enabled: live && !useNative && sessionId.length > 0 && tabId.length > 0,
    epicId,
    hostId,
    sessionId,
    setOwned,
    tabId,
  });

  return frameSrcFor(owned, burstId, retain);
}

interface PipHostClientHandle {
  readonly get: () => IHostStreamClient<HostStreamRpcRegistry> | null;
  readonly subscribe: (onChange: () => void) => () => void;
}

function usePipHostClientHandle(
  client: IHostStreamClient<HostStreamRpcRegistry> | null,
): PipHostClientHandle {
  const storeRef = useRef<{
    client: IHostStreamClient<HostStreamRpcRegistry> | null;
    readonly listeners: Set<() => void>;
  }>({
    client,
    listeners: new Set(),
  });
  const [handle] = useState<PipHostClientHandle>(() => ({
    get: () => storeRef.current.client,
    subscribe: (onChange) => {
      storeRef.current.listeners.add(onChange);
      return () => {
        storeRef.current.listeners.delete(onChange);
      };
    },
  }));

  useEffect(() => {
    const store = storeRef.current;
    if (store.client === client) return;
    store.client = client;
    for (const listener of store.listeners) listener();
  });

  return handle;
}

function nativeTileBindingKey(binding: ElectronBrowserTabRegistration): string {
  const tileKey = binding.tileKey;
  return [
    binding.registrationId,
    tileKey.viewTabId,
    tileKey.paneId,
    tileKey.tileInstanceId,
    tileKey.pageSessionId,
    binding.sessionId,
  ].join("\u001f");
}

function usePipNativeCaptureArm(input: {
  readonly enabled: boolean;
  readonly binding: ElectronBrowserTabRegistration | null;
  readonly bridge: DesktopPipCaptureBridge | null;
  readonly burstId: string | null;
  readonly epicId: string;
  readonly setOwned: Dispatch<SetStateAction<OwnedPipFrame | null>>;
}): void {
  const tileKey =
    input.enabled && input.binding !== null
      ? nativeTileBindingKey(input.binding)
      : null;
  const argsRef = useRef(input);
  useEffect(() => {
    argsRef.current = input;
  });
  useEffect(() => {
    if (tileKey === null) return;
    const args = argsRef.current;
    if (
      args.binding === null ||
      args.bridge === null ||
      args.burstId === null
    ) {
      return;
    }
    const liveBurstId = args.burstId;
    return startNativePipCapture({
      binding: args.binding,
      bridge: args.bridge,
      epicId: args.epicId,
      onUrl: (src) => {
        args.setOwned((prev) => {
          if (prev !== null && prev.src !== src) URL.revokeObjectURL(prev.src);
          return { burstId: liveBurstId, src };
        });
      },
    });
  }, [tileKey]);
}

function usePipHeadlessCaptureArm(input: {
  readonly enabled: boolean;
  readonly hostId: string;
  readonly sessionId: string;
  readonly tabId: string;
  readonly burstId: string | null;
  readonly epicId: string;
  readonly clientHandle: PipHostClientHandle;
  readonly setOwned: Dispatch<SetStateAction<OwnedPipFrame | null>>;
}): void {
  const latchKey = input.enabled
    ? [input.hostId, input.sessionId, input.tabId].join("\u001f")
    : null;
  const argsRef = useRef(input);
  useEffect(() => {
    argsRef.current = input;
  });
  useEffect(() => {
    if (latchKey === null) return;
    incrementPipHeadlessArmRunsForTests();
    const handle = argsRef.current.clientHandle;
    let disposed = false;
    let closeStream: (() => void) | undefined;
    let openedInstanceId: string | null = null;

    const sync = (): void => {
      if (disposed) return;
      const args = argsRef.current;
      const next = handle.get();
      const nextId = next === null ? null : next.instanceId;
      if (nextId === openedInstanceId) return;
      closeStream?.();
      closeStream = undefined;
      openedInstanceId = nextId;
      if (next === null || args.burstId === null) return;
      const liveBurstId = args.burstId;
      closeStream = startHeadlessPipCapture({
        client: next,
        epicId: args.epicId,
        onUrl: (src) => {
          args.setOwned((prev) => {
            if (prev !== null && prev.src !== src)
              URL.revokeObjectURL(prev.src);
            return { burstId: liveBurstId, src };
          });
        },
        sessionId: args.sessionId,
        tabId: args.tabId,
      });
    };

    const unsubscribe = handle.subscribe(sync);
    sync();
    return () => {
      disposed = true;
      unsubscribe();
      closeStream?.();
    };
  }, [latchKey]);
}

function shouldRetainPipFrame(
  phase: PipSnapshot["phase"],
  burstId: string | null,
): boolean {
  if (burstId === null) return false;
  return phase === "live" || phase === "finished" || phase === "chip";
}

function frameSrcFor(
  owned: OwnedPipFrame | null,
  burstId: string | null,
  retain: boolean,
): string | null {
  if (!retain || owned === null || burstId === null) return null;
  if (owned.burstId !== burstId) return null;
  return owned.src;
}

function usePipFrameOwner(
  burstId: string | null,
  retain: boolean,
): {
  readonly owned: OwnedPipFrame | null;
  readonly setOwned: Dispatch<SetStateAction<OwnedPipFrame | null>>;
} {
  const [owned, setOwned] = useState<OwnedPipFrame | null>(null);
  const ownedRef = useRef<OwnedPipFrame | null>(null);

  useEffect(() => {
    ownedRef.current = owned;
  }, [owned]);

  useEffect(() => {
    const current = ownedRef.current;
    if (current === null) return;
    if (retain && current.burstId === burstId) return;
    URL.revokeObjectURL(current.src);
    ownedRef.current = null;
    setOwned(null);
  }, [burstId, retain, setOwned]);

  useEffect(() => {
    return () => {
      const current = ownedRef.current;
      if (current !== null) URL.revokeObjectURL(current.src);
    };
  }, []);

  return { owned, setOwned };
}

function startNativePipCapture(input: {
  readonly binding: ElectronBrowserTabRegistration;
  readonly bridge: DesktopPipCaptureBridge;
  readonly epicId: string;
  readonly onUrl: (src: string) => void;
}): () => void {
  let disposed = false;
  const applyFrame = (
    frame: BrowserScreencastServerFrame,
    jpegBytes: Uint8Array | null,
  ): void => {
    if (disposed) return;
    applyCaptureFrame(input.epicId, frame, jpegBytes, input.onUrl);
  };
  const subscription = input.bridge.onFrame(applyFrame);
  void input.bridge.start(
    input.binding.tileKey,
    PIP_HEADLESS_MAX_WIDTH,
    PIP_HEADLESS_MAX_HEIGHT,
    PIP_HEADLESS_QUALITY,
  );
  return () => {
    disposed = true;
    subscription.dispose();
    void input.bridge.stop();
  };
}

function startHeadlessPipCapture(input: {
  readonly client: IHostStreamClient<HostStreamRpcRegistry>;
  readonly epicId: string;
  readonly onUrl: (src: string) => void;
  readonly sessionId: string;
  readonly tabId: string;
}): () => void {
  let disposed = false;
  const stream = openPipHeadlessStream({
    client: input.client,
    epicId: input.epicId,
    sessionId: input.sessionId,
    tabId: input.tabId,
    maxWidth: PIP_HEADLESS_MAX_WIDTH,
    maxHeight: PIP_HEADLESS_MAX_HEIGHT,
    quality: PIP_HEADLESS_QUALITY,
    onFrame: (frame, jpegBytes) => {
      if (disposed) return;
      applyCaptureFrame(input.epicId, frame, jpegBytes, input.onUrl);
    },
  });
  return () => {
    disposed = true;
    stream.close();
  };
}

function applyCaptureFrame(
  epicId: string,
  frame: BrowserScreencastServerFrame,
  jpegBytes: Uint8Array | null,
  onUrl: (url: string) => void,
): void {
  if (frame.kind === "stalled") {
    applyPipStreamHealth(epicId, "stale");
    return;
  }
  if (frame.kind !== "frame" || jpegBytes === null) return;
  applyPipStreamHealth(epicId, "live");
  const bytes = new Uint8Array(jpegBytes);
  const blob = new Blob([bytes], { type: "image/jpeg" });
  onUrl(URL.createObjectURL(blob));
}
