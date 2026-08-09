import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type SetStateAction,
} from "react";
import { AlertTriangle, Pause, Radio, WifiOff } from "lucide-react";
import {
  browserScreencastServerFrameSchema,
  type BrowserScreencastClientFrame,
  type BrowserScreencastServerFrame,
} from "@traycer/protocol/host/browser/contracts";
import type {
  StreamCloseReason,
  StreamConnectionStatus,
} from "@traycer-clients/shared/host-transport/i-stream-session";
import type { IHostStreamClient } from "@traycer-clients/shared/host-transport/host-stream-client";
import type { HostStreamRpcRegistry } from "@traycer/protocol/host/registry";
import { useTabHostId } from "@/components/epic-canvas/hooks/use-tab-host-id";
import { useTileBodyVisible } from "@/components/epic-canvas/hooks/use-tile-body-visible";
import { useHostDirectoryEntry } from "@/hooks/host/use-host-directory-entry";
import { useHostStreamClientFor } from "@/hooks/host/use-host-stream-client-for";
import { useStreamAuthRevalidator } from "@/lib/host/stream-auth-revalidator";
import { cn } from "@/lib/utils";
import type { BrowserPeekTileRef } from "@/stores/epics/canvas/types";

const DEFAULT_MAX_WIDTH = 1280;
const DEFAULT_MAX_HEIGHT = 720;
const DEFAULT_QUALITY = 70;
const STALE_WITHOUT_FRAME_MS = 8_000;

type PeekLifecycle =
  | "connecting"
  | "waiting"
  | "live"
  | "idle"
  | "stale"
  | "disconnected"
  | "failed"
  | "complete";

interface BrowserPeekRenderState {
  readonly client: IHostStreamClient<HostStreamRpcRegistry> | null;
  readonly imageSrc: string | null;
  readonly lifecycle: PeekLifecycle;
  readonly details: string | null;
  readonly frameSize: {
    readonly width: number;
    readonly height: number;
  } | null;
}

export interface BrowserPeekTileProps {
  readonly node: BrowserPeekTileRef;
}

export function BrowserPeekTile(props: BrowserPeekTileProps) {
  const tabHostId = useTabHostId();
  const hostEntry = useHostDirectoryEntry(tabHostId);
  const auth = useStreamAuthRevalidator();
  const client = useHostStreamClientFor(hostEntry, auth);
  const visible = useTileBodyVisible();
  const sessionRef = useRef<{
    sendClientFrame: (
      frame: BrowserScreencastClientFrame,
      binaryPayload: Uint8Array | null,
    ) => void;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastFrameAtRef = useRef<number | null>(null);
  const [streamState, setStreamState] = useState<BrowserPeekRenderState>(
    () => ({
      client,
      imageSrc: null,
      lifecycle: "connecting",
      details: null,
      frameSize: null,
    }),
  );
  const stateMatchesClient = streamState.client === client;
  const imageSrc = stateMatchesClient ? streamState.imageSrc : null;
  const lifecycle = stateMatchesClient ? streamState.lifecycle : "connecting";
  const details = peekDetailsForRender(stateMatchesClient, streamState, client);
  const frameSize = stateMatchesClient ? streamState.frameSize : null;

  const setLifecycle = useCallback(
    (value: SetStateAction<PeekLifecycle>) => {
      setStreamState((current) => {
        const base = resetPeekStateForClient(current, client);
        const lifecycle =
          typeof value === "function" ? value(base.lifecycle) : value;
        return { ...base, lifecycle };
      });
    },
    [client],
  );
  const setDetails = useCallback(
    (value: string | null) => {
      setStreamState((current) => ({
        ...resetPeekStateForClient(current, client),
        details: value,
      }));
    },
    [client],
  );
  const setImageSrc = useCallback(
    (value: string) => {
      setStreamState((current) => ({
        ...resetPeekStateForClient(current, client),
        imageSrc: value,
      }));
    },
    [client],
  );
  const setFrameSize = useCallback(
    (
      value: {
        readonly width: number;
        readonly height: number;
      } | null,
    ) => {
      setStreamState((current) => ({
        ...resetPeekStateForClient(current, client),
        frameSize: value,
      }));
    },
    [client],
  );

  useEffect(() => {
    if (client === null) {
      sessionRef.current = null;
      return;
    }

    const session = client.subscribe("browser.screencast", {
      sessionId: props.node.sessionId,
      tabId: props.node.sessionId,
      maxWidth: DEFAULT_MAX_WIDTH,
      maxHeight: DEFAULT_MAX_HEIGHT,
      quality: DEFAULT_QUALITY,
      format: "jpeg",
    });
    sessionRef.current = session;
    session.onStatusChange((status, reason) => {
      handleStreamStatus(status, reason, setLifecycle, setDetails);
    });
    session.onServerFrame((envelope, binaryPayload) => {
      const parsed = browserScreencastServerFrameSchema.safeParse(envelope);
      if (!parsed.success) return;
      handleScreencastFrame({
        frame: parsed.data,
        binaryPayload,
        session,
        setImageSrc,
        setLifecycle,
        setDetails,
        setFrameSize,
        lastFrameAtRef,
      });
    });

    return () => {
      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
      session.close();
    };
  }, [
    client,
    props.node.sessionId,
    setDetails,
    setFrameSize,
    setImageSrc,
    setLifecycle,
  ]);

  useEffect(() => {
    sendPeekFrame(sessionRef.current, {
      kind: "setPaused",
      hasBinaryPayload: false,
      paused: !visible,
    });
  }, [visible]);

  const sendParams = useCallback(
    (params: {
      readonly maxWidth: number;
      readonly maxHeight: number;
      readonly quality: number;
    }) => {
      sendPeekFrame(sessionRef.current, {
        kind: "setParams",
        hasBinaryPayload: false,
        ...params,
      });
    },
    [],
  );
  useScreencastParamsBridge(viewportRef, visible, sendParams);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const lastFrameAt = lastFrameAtRef.current;
      if (lastFrameAt === null) return;
      if (Date.now() - lastFrameAt < STALE_WITHOUT_FRAME_MS) return;
      setLifecycle((current) =>
        current === "live" || current === "waiting" ? "stale" : current,
      );
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [setLifecycle]);

  const status = useMemo(
    () => browserPeekStatus(lifecycle, visible, details),
    [details, lifecycle, visible],
  );

  return (
    <div
      className="flex h-full w-full flex-col bg-canvas text-foreground"
      data-testid={`browser-peek-tile-${props.node.instanceId}`}
    >
      <div className="flex min-h-0 items-center gap-2 border-b border-border px-3 py-2 text-ui-sm">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{props.node.name}</div>
          <div className="truncate font-mono text-ui-xs text-muted-foreground">
            {props.node.initialUrl}
          </div>
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-1 text-ui-xs",
            status.tone === "live" &&
              "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            status.tone === "muted" &&
              "border-border bg-muted text-muted-foreground",
            status.tone === "bad" &&
              "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          <status.Icon className="size-3.5" aria-hidden />
          <span>{status.label}</span>
        </div>
      </div>
      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-background"
      >
        {imageSrc === null ? (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
            <div>
              <div className="text-ui-base font-medium">Waiting for frames</div>
              <div className="mt-1 max-w-[min(90vw,32rem)] text-ui-sm text-muted-foreground">
                This is a read-only peek of the agent browser. Page input is not
                forwarded.
              </div>
            </div>
          </div>
        ) : (
          <img
            src={imageSrc}
            alt="Read-only browser screencast"
            className="h-full w-full object-contain"
            draggable={false}
          />
        )}
        {status.overlay === null ? null : (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded border border-border bg-popover/95 px-3 py-2 text-ui-sm text-popover-foreground shadow-sm">
            {status.overlay}
          </div>
        )}
        {frameSize === null ? null : (
          <div className="pointer-events-none absolute left-3 top-3 rounded-sm bg-background/80 px-2 py-1 font-mono text-ui-xs text-muted-foreground">
            {frameSize.width} x {frameSize.height}
          </div>
        )}
      </div>
    </div>
  );
}

function resetPeekStateForClient(
  current: BrowserPeekRenderState,
  client: IHostStreamClient<HostStreamRpcRegistry> | null,
): BrowserPeekRenderState {
  if (current.client === client) return current;
  return {
    client,
    imageSrc: null,
    lifecycle: "connecting",
    details: client === null ? "Waiting for the host stream." : null,
    frameSize: null,
  };
}

function peekDetailsForRender(
  stateMatchesClient: boolean,
  streamState: BrowserPeekRenderState,
  client: IHostStreamClient<HostStreamRpcRegistry> | null,
): string | null {
  if (stateMatchesClient) return streamState.details;
  if (client === null) return "Waiting for the host stream.";
  return null;
}

function handleStreamStatus(
  status: StreamConnectionStatus,
  reason: StreamCloseReason | null,
  setLifecycle: (value: PeekLifecycle) => void,
  setDetails: (value: string | null) => void,
): void {
  if (status === "open") {
    setLifecycle("waiting");
    setDetails(null);
    return;
  }
  if (status === "connecting") {
    setLifecycle("connecting");
    setDetails(null);
    return;
  }
  if (status === "reconnecting") {
    setLifecycle("stale");
    setDetails("Reconnecting to the screencast stream.");
    return;
  }
  if (reason?.kind === "fatalError") {
    setLifecycle("failed");
    setDetails(reason.details.reason);
    return;
  }
  setLifecycle("disconnected");
  setDetails("Screencast stream disconnected.");
}

function handleScreencastFrame(args: {
  readonly frame: BrowserScreencastServerFrame;
  readonly binaryPayload: Uint8Array | null;
  readonly session: {
    sendClientFrame: (
      frame: BrowserScreencastClientFrame,
      binaryPayload: Uint8Array | null,
    ) => void;
  };
  readonly setImageSrc: (value: string) => void;
  readonly setLifecycle: (value: PeekLifecycle) => void;
  readonly setDetails: (value: string | null) => void;
  readonly setFrameSize: (
    value: { readonly width: number; readonly height: number } | null,
  ) => void;
  readonly lastFrameAtRef: RefObject<number | null>;
}): void {
  if (args.frame.kind === "started") {
    args.setLifecycle("waiting");
    args.setFrameSize({
      width: args.frame.frameWidth,
      height: args.frame.frameHeight,
    });
    return;
  }
  if (args.frame.kind === "frame") {
    if (args.binaryPayload === null) return;
    args.lastFrameAtRef.current = Date.now();
    args.setImageSrc(
      `data:image/jpeg;base64,${bytesToBase64(args.binaryPayload)}`,
    );
    args.setLifecycle("live");
    args.setDetails(null);
    sendPeekFrame(args.session, {
      kind: "ack",
      hasBinaryPayload: false,
      sequence: args.frame.sequence,
    });
    return;
  }
  if (args.frame.kind === "stalled") {
    args.setLifecycle("idle");
    args.setDetails("Page is live but idle between repaints.");
    return;
  }
  if (args.frame.kind === "resized") {
    args.setFrameSize({
      width: args.frame.frameWidth,
      height: args.frame.frameHeight,
    });
    return;
  }
  if (args.frame.kind === "failed") {
    args.setLifecycle("failed");
    args.setDetails(args.frame.reason);
    return;
  }
  if (args.frame.kind === "complete") {
    args.setLifecycle("complete");
    args.setDetails("Screencast ended.");
  }
}

function useScreencastParamsBridge(
  ref: RefObject<HTMLDivElement | null>,
  visible: boolean,
  sendParams: (params: {
    readonly maxWidth: number;
    readonly maxHeight: number;
    readonly quality: number;
  }) => void,
): void {
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const emit = (): void => {
      if (!visible) return;
      const rect = element.getBoundingClientRect();
      const maxWidth = Math.max(1, Math.min(1920, Math.round(rect.width)));
      const maxHeight = Math.max(1, Math.min(1080, Math.round(rect.height)));
      sendParams({ maxWidth, maxHeight, quality: DEFAULT_QUALITY });
    };
    const observer = new ResizeObserver(emit);
    observer.observe(element);
    emit();
    return () => {
      observer.disconnect();
    };
  }, [ref, sendParams, visible]);
}

function sendPeekFrame(
  session: {
    sendClientFrame: (
      frame: BrowserScreencastClientFrame,
      binaryPayload: Uint8Array | null,
    ) => void;
  } | null,
  frame: BrowserScreencastClientFrame,
): void {
  session?.sendClientFrame(frame, null);
}

function browserPeekStatus(
  lifecycle: PeekLifecycle,
  visible: boolean,
  details: string | null,
): {
  readonly label: string;
  readonly overlay: string | null;
  readonly tone: "live" | "muted" | "bad";
  readonly Icon: typeof Radio;
} {
  if (!visible) {
    return {
      label: "Paused off-screen",
      overlay: "Peek is paused while this tile is hidden.",
      tone: "muted",
      Icon: Pause,
    };
  }
  if (lifecycle === "live") {
    return { label: "Live", overlay: null, tone: "live", Icon: Radio };
  }
  if (lifecycle === "idle") {
    return {
      label: "Live idle",
      overlay: details,
      tone: "muted",
      Icon: Radio,
    };
  }
  if (lifecycle === "failed" || lifecycle === "disconnected") {
    return {
      label: "Disconnected",
      overlay: details ?? "Screencast is disconnected.",
      tone: "bad",
      Icon: WifiOff,
    };
  }
  if (lifecycle === "complete") {
    return {
      label: "Ended",
      overlay: details,
      tone: "muted",
      Icon: WifiOff,
    };
  }
  if (lifecycle === "stale") {
    return {
      label: "Stale",
      overlay: details ?? "No new frames have arrived recently.",
      tone: "muted",
      Icon: AlertTriangle,
    };
  }
  return {
    label: "Connecting",
    overlay: details,
    tone: "muted",
    Icon: Radio,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return window.btoa(binary);
}
