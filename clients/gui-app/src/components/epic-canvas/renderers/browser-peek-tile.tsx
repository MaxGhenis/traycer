import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CompositionEvent as ReactCompositionEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
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
import { useRegisterVisibleBrowserTile } from "@/lib/browser-view/visible-tile-registry";
import { useHostDirectoryEntry } from "@/hooks/host/use-host-directory-entry";
import { useHostStreamClientFor } from "@/hooks/host/use-host-stream-client-for";
import { useStreamAuthRevalidator } from "@/lib/host/stream-auth-revalidator";
import { cn } from "@/lib/utils";
import type { BrowserPeekTileRef } from "@/stores/epics/canvas/types";

const DEFAULT_MAX_WIDTH = 1280;
const DEFAULT_MAX_HEIGHT = 720;
const DEFAULT_QUALITY = 70;
const STALE_WITHOUT_FRAME_MS = 8_000;
const VIEWPORT_DEBOUNCE_MS = 200;

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
  readonly image: { readonly src: string; readonly sequence: number } | null;
  readonly lifecycle: PeekLifecycle;
  readonly details: string | null;
  readonly migrationPending: boolean;
  readonly frameSize: {
    readonly width: number;
    readonly height: number;
  } | null;
}

type BrowserPeekDialog = Extract<
  BrowserScreencastServerFrame,
  { readonly kind: "dialogOpened" }
> & { readonly armEpoch: number };

export interface BrowserPeekTileProps {
  readonly epicId: string;
  readonly node: BrowserPeekTileRef;
  readonly onMigrated?: () => void;
}

export function BrowserPeekTile(props: BrowserPeekTileProps) {
  const { epicId, node, onMigrated } = props;
  const tabHostId = useTabHostId();
  const hostEntry = useHostDirectoryEntry(tabHostId);
  const auth = useStreamAuthRevalidator();
  const client = useHostStreamClientFor(hostEntry, auth);
  const visible = useTileBodyVisible();
  useRegisterVisibleBrowserTile({
    hostId: tabHostId,
    sessionId: node.sessionId,
    tabId: node.tabId,
    visible,
  });
  const sessionRef = useRef<{
    sendClientFrame: (
      frame: BrowserScreencastClientFrame,
      binaryPayload: Uint8Array | null,
    ) => void;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imeInputRef = useRef<HTMLInputElement | null>(null);
  const lastFrameAtRef = useRef<number | null>(null);
  const armEpochCounterRef = useRef(0);
  const desiredArmEpochRef = useRef<number | null>(null);
  const activeArmEpochRef = useRef<number | null>(null);
  const inputSequenceRef = useRef(0);
  const presentedSequenceRef = useRef<number | null>(null);
  const activeDialogRef = useRef<BrowserPeekDialog | null>(null);
  const composingRef = useRef(false);
  const [armedState, setArmedState] = useState<{
    readonly client: IHostStreamClient<HostStreamRpcRegistry>;
    readonly epoch: number;
  } | null>(null);
  const [dialogState, setDialogState] = useState<{
    readonly client: IHostStreamClient<HostStreamRpcRegistry>;
    readonly dialog: BrowserPeekDialog;
  } | null>(null);
  const [composing, setComposing] = useState(false);
  const [streamState, setStreamState] = useState<BrowserPeekRenderState>(
    () => ({
      client,
      image: null,
      lifecycle: "connecting",
      details: null,
      migrationPending: false,
      frameSize: null,
    }),
  );
  const {
    image,
    lifecycle,
    details,
    migrationPending,
    frameSize,
  } = peekVisibleSlice(streamState, client);
  const armedEpoch = armedState?.client === client ? armedState.epoch : null;
  const dialog = dialogForClient(dialogState, client);

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
  const setImage = useCallback(
    (value: { readonly src: string; readonly sequence: number }) => {
      setStreamState((current) => ({
        ...resetPeekStateForClient(current, client),
        image: value,
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
    activeDialogRef.current = null;
    composingRef.current = false;
    if (client === null) {
      sessionRef.current = null;
      desiredArmEpochRef.current = null;
      activeArmEpochRef.current = null;
      activeDialogRef.current = null;
      return;
    }

    const session = client.subscribe("browser.screencast", {
      epicId,
      sessionId: node.sessionId,
      tabId: node.tabId,
      maxWidth: DEFAULT_MAX_WIDTH,
      maxHeight: DEFAULT_MAX_HEIGHT,
      quality: DEFAULT_QUALITY,
      format: "jpeg",
      role: "tile",
    });
    sessionRef.current = session;
    session.onStatusChange((status, reason) => {
      if (status !== "open") {
        presentedSequenceRef.current = null;
        desiredArmEpochRef.current = null;
        activeArmEpochRef.current = null;
        activeDialogRef.current = null;
        composingRef.current = false;
        setArmedState(null);
        setDialogState(null);
        setComposing(false);
      } else if (
        viewportRef.current?.contains(document.activeElement) === true
      ) {
        armEpochCounterRef.current += 1;
        const armEpoch = armEpochCounterRef.current;
        desiredArmEpochRef.current = armEpoch;
        inputSequenceRef.current = 0;
        sendPeekFrame(session, {
          kind: "arm",
          hasBinaryPayload: false,
          armEpoch,
        });
      }
      handleStreamStatus(status, reason, setLifecycle, setDetails);
    });
    session.onServerFrame((envelope, binaryPayload) => {
      const parsed = browserScreencastServerFrameSchema.safeParse(envelope);
      if (!parsed.success) return;
      if (
        parsed.data.kind === "started" ||
        parsed.data.kind === "resized" ||
        parsed.data.kind === "failed" ||
        parsed.data.kind === "complete"
      ) {
        presentedSequenceRef.current = null;
      }
      handleScreencastFrame({
        frame: parsed.data,
        binaryPayload,
        setImage,
        setLifecycle,
        setDetails,
        setFrameSize,
      });
      if (
        parsed.data.kind === "complete" &&
        parsed.data.cause === "migrated"
      ) {
        onMigrated?.();
      }
      if (parsed.data.kind === "migrationPending") {
        const pending = parsed.data.pending;
        setStreamState((current) => ({
          ...resetPeekStateForClient(current, client),
          migrationPending: pending,
        }));
      }
      if (parsed.data.kind === "armed") {
        if (desiredArmEpochRef.current !== parsed.data.armEpoch) return;
        activeArmEpochRef.current = parsed.data.armEpoch;
        setArmedState({ client, epoch: parsed.data.armEpoch });
      } else if (parsed.data.kind === "revoked") {
        if (activeArmEpochRef.current !== parsed.data.armEpoch) return;
        desiredArmEpochRef.current = null;
        activeArmEpochRef.current = null;
        setArmedState(null);
        activeDialogRef.current = null;
        setDialogState(null);
      } else {
        handleDialogServerFrame({
          frame: parsed.data,
          armEpoch: activeArmEpochRef.current,
          current: activeDialogRef.current,
          opened: (dialog) => {
            activeDialogRef.current = dialog;
            setDialogState({ client, dialog });
          },
          settled: () => {
            activeDialogRef.current = null;
            setDialogState(null);
          },
        });
      }
    });

    return () => {
      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
      desiredArmEpochRef.current = null;
      activeArmEpochRef.current = null;
      presentedSequenceRef.current = null;
      activeDialogRef.current = null;
      composingRef.current = false;
      session.close();
    };
  }, [
    client,
    epicId,
    node.sessionId,
    node.tabId,
    onMigrated,
    setDetails,
    setFrameSize,
    setImage,
    setLifecycle,
  ]);

  useEffect(() => {
    sendPeekFrame(sessionRef.current, {
      kind: "setPaused",
      hasBinaryPayload: false,
      paused: !visible,
    });
  }, [visible]);

  const sendViewport = useCallback(
    (viewport: {
      readonly width: number;
      readonly height: number;
      readonly dpr: number;
    }) => {
      sendPeekFrame(sessionRef.current, {
        kind: "viewport",
        hasBinaryPayload: false,
        ...viewport,
      });
    },
    [],
  );
  useScreencastViewportBridge(viewportRef, visible, sendViewport);

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

  const arm = useCallback(() => {
    if (
      desiredArmEpochRef.current !== null ||
      activeArmEpochRef.current !== null
    ) {
      return;
    }
    armEpochCounterRef.current += 1;
    const armEpoch = armEpochCounterRef.current;
    desiredArmEpochRef.current = armEpoch;
    inputSequenceRef.current = 0;
    sendPeekFrame(sessionRef.current, {
      kind: "arm",
      hasBinaryPayload: false,
      armEpoch,
    });
  }, []);

  const disarm = useCallback(() => {
    const armEpoch = activeArmEpochRef.current ?? desiredArmEpochRef.current;
    desiredArmEpochRef.current = null;
    activeArmEpochRef.current = null;
    activeDialogRef.current = null;
    composingRef.current = false;
    setComposing(false);
    setDialogState(null);
    setArmedState(null);
    if (armEpoch === null) return;
    sendPeekFrame(sessionRef.current, {
      kind: "disarm",
      hasBinaryPayload: false,
      armEpoch,
    });
  }, []);

  const sendInput = useCallback(
    (
      frame:
        | Omit<
            Extract<BrowserScreencastClientFrame, { readonly kind: "pointer" }>,
            "armEpoch" | "seq" | "hasBinaryPayload"
          >
        | Omit<
            Extract<
              BrowserScreencastClientFrame,
              { readonly kind: "keyboard" }
            >,
            "armEpoch" | "seq" | "hasBinaryPayload"
          >
        | Omit<
            Extract<
              BrowserScreencastClientFrame,
              { readonly kind: "insertText" }
            >,
            "armEpoch" | "seq" | "hasBinaryPayload"
          >,
    ) => {
      const armEpoch = activeArmEpochRef.current;
      if (armEpoch === null) return;
      sendPeekFrame(sessionRef.current, {
        ...frame,
        hasBinaryPayload: false,
        armEpoch,
        seq: inputSequenceRef.current,
      });
      inputSequenceRef.current += 1;
    },
    [],
  );

  const respondToDialog = useCallback(
    (generation: number, accept: boolean, promptText: string | null) => {
      const current = activeDialogRef.current;
      const armEpoch = activeArmEpochRef.current;
      if (
        current === null ||
        current.generation !== generation ||
        armEpoch === null ||
        current.armEpoch !== armEpoch
      ) {
        return;
      }
      activeDialogRef.current = null;
      setDialogState(null);
      sendPeekFrame(sessionRef.current, {
        kind: "dialogResponse",
        hasBinaryPayload: false,
        armEpoch,
        generation,
        accept,
        promptText,
      });
      imeInputRef.current?.focus();
    },
    [],
  );

  const sendPointer = useCallback(
    (
      event:
        | ReactPointerEvent<HTMLButtonElement>
        | ReactWheelEvent<HTMLButtonElement>,
      type: "move" | "down" | "up" | "wheel",
    ) => {
      const castSequence = presentedSequenceRef.current;
      const normalized = normalizedPointerPosition(
        event.clientX,
        event.clientY,
        imageRef.current,
        frameSize,
      );
      if (castSequence === null || normalized === null) return;
      const pointerEvent = "button" in event ? event : null;
      sendInput({
        kind: "pointer",
        type,
        castSequence,
        ...normalized,
        button: pointerButton(pointerEvent?.button ?? -1),
        buttons: event.buttons,
        modifiers: inputModifiers(event),
        deltaX: "deltaX" in event ? event.deltaX : 0,
        deltaY: "deltaY" in event ? event.deltaY : 0,
      });
    },
    [frameSize, sendInput],
  );

  const handleFocusExit = useCallback(
    (relatedTarget: EventTarget | null) => {
      if (
        relatedTarget instanceof Node &&
        viewportRef.current?.contains(relatedTarget) === true
      ) {
        return;
      }
      disarm();
    },
    [disarm],
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
          {migrationPending ? (
            <div className="truncate text-ui-xs text-muted-foreground" aria-live="polite">
              Will go native when the agent pauses
            </div>
          ) : null}
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
        className={cn(
          "relative min-h-0 flex-1 cursor-default overflow-hidden bg-background p-0 text-left outline-none",
          armedEpoch !== null && "ring-2 ring-primary ring-inset",
        )}
      >
        <button
          type="button"
          className="absolute inset-0 h-full w-full cursor-default overflow-hidden bg-background p-0 text-left outline-none"
          aria-label="Browser screencast controls"
          onFocus={() => imeInputRef.current?.focus()}
          onBlur={(event) => handleFocusExit(event.relatedTarget)}
          onPointerDown={(event) => {
            event.preventDefault();
            imeInputRef.current?.focus();
            sendPointer(event, "down");
          }}
          onPointerMove={(event) => sendPointer(event, "move")}
          onPointerUp={(event) => sendPointer(event, "up")}
          onWheel={(event) => {
            if (activeArmEpochRef.current === null) return;
            event.preventDefault();
            sendPointer(event, "wheel");
          }}
        >
          {image === null ? (
            <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
              <div>
                <div className="text-ui-base font-medium">
                  Waiting for frames
                </div>
                <div className="mt-1 max-w-[min(90vw,32rem)] text-ui-sm text-muted-foreground">
                  Click the screencast to control this browser tab.
                </div>
              </div>
            </div>
          ) : (
            <img
              key={image.sequence}
              ref={imageRef}
              src={image.src}
              alt="Browser screencast"
              className="h-full w-full object-contain"
              draggable={false}
              onLoad={() => {
                presentedSequenceRef.current = image.sequence;
                lastFrameAtRef.current = Date.now();
                setLifecycle("live");
                setDetails(null);
                sendPeekFrame(sessionRef.current, {
                  kind: "ack",
                  hasBinaryPayload: false,
                  sequence: image.sequence,
                });
              }}
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
        </button>
        <input
          ref={imeInputRef}
          aria-label="Browser IME input"
          autoComplete="off"
          className="pointer-events-none absolute left-0 top-0 size-px opacity-0"
          onFocus={arm}
          onBlur={(event) => handleFocusExit(event.relatedTarget)}
          onKeyDown={(event) => {
            if (activeDialogRef.current !== null) return;
            if (event.nativeEvent.isComposing || composingRef.current) return;
            if (event.key === "Escape") {
              event.preventDefault();
              disarm();
              event.currentTarget.blur();
              return;
            }
            if (activeArmEpochRef.current === null) return;
            event.preventDefault();
            sendInput({
              kind: "keyboard",
              type: "rawKeyDown",
              code: event.code,
              key: event.key,
              modifiers: inputModifiers(event),
            });
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
              sendInput({
                kind: "keyboard",
                type: "char",
                code: event.code,
                key: event.key,
                modifiers: inputModifiers(event),
              });
            }
          }}
          onKeyUp={(event) => {
            if (activeDialogRef.current !== null) return;
            if (event.nativeEvent.isComposing || composingRef.current) return;
            if (activeArmEpochRef.current === null) return;
            event.preventDefault();
            sendInput({
              kind: "keyboard",
              type: "keyUp",
              code: event.code,
              key: event.key,
              modifiers: inputModifiers(event),
            });
          }}
          onCompositionStart={() => {
            composingRef.current = true;
            setComposing(true);
          }}
          onCompositionEnd={(
            event: ReactCompositionEvent<HTMLInputElement>,
          ) => {
            composingRef.current = false;
            setComposing(false);
            event.currentTarget.value = "";
            if (event.data !== "") {
              sendInput({ kind: "insertText", text: event.data });
            }
          }}
          onInput={(event) => {
            if (!composingRef.current) event.currentTarget.value = "";
          }}
        />
        {composing ? (
          <div
            aria-live="polite"
            className="pointer-events-none absolute right-3 top-3 rounded-sm bg-background/90 px-2 py-1 text-ui-xs text-muted-foreground"
          >
            Composing text…
          </div>
        ) : null}
        {dialog === null ? null : (
          <BrowserDialogOverlay
            key={dialog.generation}
            dialog={dialog}
            onRespond={respondToDialog}
            onFocusExit={handleFocusExit}
          />
        )}
      </div>
    </div>
  );
}

function BrowserDialogOverlay(props: {
  readonly dialog: BrowserPeekDialog;
  readonly onRespond: (
    generation: number,
    accept: boolean,
    promptText: string | null,
  ) => void;
  readonly onFocusExit: (relatedTarget: EventTarget | null) => void;
}) {
  const [promptText, setPromptText] = useState(props.dialog.defaultValue);
  const isAlert = props.dialog.type === "alert";
  const isPrompt = props.dialog.type === "prompt";
  let title = "Confirm";
  if (isAlert) title = "Alert";
  else if (isPrompt) title = "Prompt";
  return (
    <dialog
      open
      aria-label={`${props.dialog.type} dialog`}
      aria-modal="true"
      className="absolute inset-0 z-10 m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-background/60 p-4 text-foreground"
    >
      <div className="w-full max-w-md rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg">
        <div className="text-ui-base font-medium">{title}</div>
        <div className="mt-2 whitespace-pre-wrap break-words text-ui-sm">
          {props.dialog.message}
        </div>
        {isPrompt ? (
          <input
            aria-label="Prompt response"
            className="mt-3 w-full rounded border border-input bg-background px-3 py-2 text-ui-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={promptText}
            onChange={(event) => setPromptText(event.currentTarget.value)}
            onBlur={(event) => props.onFocusExit(event.relatedTarget)}
          />
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          {isAlert ? null : (
            <button
              type="button"
              className="rounded border border-border px-3 py-1.5 text-ui-sm hover:bg-muted"
              onClick={() =>
                props.onRespond(props.dialog.generation, false, null)
              }
              onBlur={(event) => props.onFocusExit(event.relatedTarget)}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            className="rounded bg-primary px-3 py-1.5 text-ui-sm text-primary-foreground hover:bg-primary/90"
            onClick={() =>
              props.onRespond(
                props.dialog.generation,
                true,
                isPrompt ? promptText : null,
              )
            }
            onBlur={(event) => props.onFocusExit(event.relatedTarget)}
          >
            OK
          </button>
        </div>
      </div>
    </dialog>
  );
}

function dialogForClient(
  state: {
    readonly client: IHostStreamClient<HostStreamRpcRegistry>;
    readonly dialog: BrowserPeekDialog;
  } | null,
  client: IHostStreamClient<HostStreamRpcRegistry> | null,
): BrowserPeekDialog | null {
  return state?.client === client ? state.dialog : null;
}

function handleDialogServerFrame(input: {
  readonly frame: BrowserScreencastServerFrame;
  readonly armEpoch: number | null;
  readonly current: BrowserPeekDialog | null;
  readonly opened: (dialog: BrowserPeekDialog) => void;
  readonly settled: () => void;
}): void {
  if (input.frame.kind === "dialogOpened") {
    if (
      input.armEpoch === null ||
      (input.current !== null &&
        input.frame.generation <= input.current.generation)
    ) {
      return;
    }
    input.opened({ ...input.frame, armEpoch: input.armEpoch });
  } else if (
    input.frame.kind === "dialogSettled" &&
    input.current?.generation === input.frame.generation
  ) {
    input.settled();
  }
}

function resetPeekStateForClient(
  current: BrowserPeekRenderState,
  client: IHostStreamClient<HostStreamRpcRegistry> | null,
): BrowserPeekRenderState {
  if (current.client === client) return current;
  return {
    client,
    image: null,
    lifecycle: "connecting",
    details: client === null ? "Waiting for the host stream." : null,
    migrationPending: false,
    frameSize: null,
  };
}

function peekVisibleSlice(
  streamState: BrowserPeekRenderState,
  client: IHostStreamClient<HostStreamRpcRegistry> | null,
): {
  readonly image: BrowserPeekRenderState["image"];
  readonly lifecycle: PeekLifecycle;
  readonly details: string | null;
  readonly migrationPending: boolean;
  readonly frameSize: BrowserPeekRenderState["frameSize"];
} {
  const stateMatchesClient = streamState.client === client;
  return {
    image: stateMatchesClient ? streamState.image : null,
    lifecycle: stateMatchesClient ? streamState.lifecycle : "connecting",
    details: peekDetailsForRender(stateMatchesClient, streamState, client),
    migrationPending: stateMatchesClient && streamState.migrationPending,
    frameSize: stateMatchesClient ? streamState.frameSize : null,
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
  readonly setImage: (value: {
    readonly src: string;
    readonly sequence: number;
  }) => void;
  readonly setLifecycle: (value: PeekLifecycle) => void;
  readonly setDetails: (value: string | null) => void;
  readonly setFrameSize: (
    value: { readonly width: number; readonly height: number } | null,
  ) => void;
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
    args.setImage({
      src: `data:image/jpeg;base64,${bytesToBase64(args.binaryPayload)}`,
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

function useScreencastViewportBridge(
  ref: RefObject<HTMLElement | null>,
  visible: boolean,
  sendViewport: (viewport: {
    readonly width: number;
    readonly height: number;
    readonly dpr: number;
  }) => void,
): void {
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    let timer: number | null = null;
    const emit = (width: number, height: number): void => {
      if (!visible) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        sendViewport({
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
          dpr: window.devicePixelRatio,
        });
      }, VIEWPORT_DEBOUNCE_MS);
    };
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        emit(entry.contentRect.width, entry.contentRect.height);
        break;
      }
    });
    observer.observe(element);
    emit(element.clientWidth, element.clientHeight);
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [ref, sendViewport, visible]);
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

function inputModifiers(event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): number {
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}

function pointerButton(
  button: number,
): Extract<
  BrowserScreencastClientFrame,
  { readonly kind: "pointer" }
>["button"] {
  if (button === 0) return "left";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  if (button === 3) return "back";
  if (button === 4) return "forward";
  return "none";
}

function normalizedPointerPosition(
  clientX: number,
  clientY: number,
  image: HTMLImageElement | null,
  frameSize: { readonly width: number; readonly height: number } | null,
): { readonly normalizedX: number; readonly normalizedY: number } | null {
  if (image === null || frameSize === null) return null;
  const rect = image.getBoundingClientRect();
  const scale = Math.min(
    rect.width / frameSize.width,
    rect.height / frameSize.height,
  );
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const width = frameSize.width * scale;
  const height = frameSize.height * scale;
  const x = clientX - rect.left - (rect.width - width) / 2;
  const y = clientY - rect.top - (rect.height - height) / 2;
  if (x < 0 || x > width || y < 0 || y > height) return null;
  return { normalizedX: x / width, normalizedY: y / height };
}
