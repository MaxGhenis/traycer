import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  createBrowserElementAttachment,
  requestBrowserContextAttachment,
} from "@/lib/browser-view/browser-context-attachments";
import {
  type BrowserViewElementCapture,
  type BrowserViewStatus,
  type BrowserViewTileKey,
  type DesktopBrowserViewBridge,
} from "@/lib/browser-view/desktop-browser-view";

export type BrowserElementPickerResultState =
  | {
      readonly outcome: "picked";
      readonly pageUrl: string;
      readonly element: BrowserViewElementCapture;
    }
  | {
      readonly outcome: "iframe-not-inspectable";
      readonly pageUrl: string;
      readonly frameLabel: string | null;
    }
  | null;

export interface BrowserElementPickerController {
  readonly isPicking: boolean;
  readonly canPick: boolean;
  readonly sending: boolean;
  readonly result: BrowserElementPickerResultState;
  readonly toggle: () => void;
  readonly cancel: () => void;
  readonly clearResult: () => void;
  readonly sendToAgent: () => void;
}

interface UseBrowserElementPickerArgs {
  readonly browserView: DesktopBrowserViewBridge | null;
  readonly tileKey: BrowserViewTileKey;
  readonly status: BrowserViewStatus;
  readonly targetChatId: string | null;
}

/**
 * Owns the interactive element-pick lifecycle for one browser tile. A single
 * `pickElement` round-trip spans the whole in-page interaction (hover highlight
 * lives in the injected isolated-world script, so there is no per-hover IPC);
 * it resolves when the user clicks, presses Escape, or the pick is cancelled.
 *
 * The main process ends the pick whenever the page leaves "ready" (navigation,
 * reload, renderer gone), so the awaiting promise settles on its own - the hook
 * does not need to police the page state itself.
 */
export function useBrowserElementPicker(
  args: UseBrowserElementPickerArgs,
): BrowserElementPickerController {
  const { browserView, tileKey, status, targetChatId } = args;
  const [isPicking, setIsPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BrowserElementPickerResultState>(null);
  const pickTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const canPick = browserView !== null && status === "ready";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fully tear down an in-flight pick when the bridge or tile identity changes
  // (tile close, navigate to a new page session). Belt-and-suspenders with the
  // main-process teardown so a picker never lingers over a stale page.
  useEffect(() => {
    if (browserView === null) return;
    return () => {
      pickTokenRef.current += 1;
      if (mountedRef.current) setIsPicking(false);
      void browserView.cancelElementPick(tileKey).catch(ignorePickerError);
    };
  }, [browserView, tileKey]);

  const startPick = useCallback(() => {
    if (browserView === null || status !== "ready") return;
    setResult(null);
    setIsPicking(true);
    const token = pickTokenRef.current + 1;
    pickTokenRef.current = token;
    void browserView
      .pickElement(tileKey)
      .then((pick) => {
        if (pickTokenRef.current !== token || !mountedRef.current) return;
        setIsPicking(false);
        if (
          pick.outcome === "picked" ||
          pick.outcome === "iframe-not-inspectable"
        ) {
          setResult(pick);
          return;
        }
        setResult(null);
      })
      .catch(() => {
        if (pickTokenRef.current !== token || !mountedRef.current) return;
        setIsPicking(false);
      });
  }, [browserView, status, tileKey]);

  const cancel = useCallback(() => {
    pickTokenRef.current += 1;
    setIsPicking(false);
    if (browserView === null) return;
    void browserView.cancelElementPick(tileKey).catch(ignorePickerError);
  }, [browserView, tileKey]);

  // The hint says "press Esc to cancel", but the injected script's Escape
  // listener only fires when the BrowserView page has focus - which it usually
  // does not right after the React toolbar toggle is clicked. Mirror Escape at
  // the app-renderer level while a pick is active (external-subscription
  // effect; the cancel path settles the main-process session authoritatively).
  useEffect(() => {
    if (!isPicking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isPicking, cancel]);

  const toggle = useCallback(() => {
    if (isPicking) {
      cancel();
      return;
    }
    startPick();
  }, [isPicking, cancel, startPick]);

  const clearResult = useCallback(() => {
    setResult(null);
  }, []);

  const sendToAgent = useCallback(() => {
    if (result === null || result.outcome !== "picked" || sending) return;
    if (targetChatId === null) {
      toast.error("Open a chat beside this browser to send the element.");
      return;
    }
    setSending(true);
    void requestBrowserContextAttachment(
      createBrowserElementAttachment({
        tile: tileKey,
        pageUrl: result.pageUrl,
        element: result.element,
      }),
      { targetChatId },
    )
      .then(showAttachmentResult)
      .catch(() => {
        toast.error("Couldn't send the element to the agent.");
      })
      .finally(() => {
        if (mountedRef.current) setSending(false);
      });
  }, [result, sending, targetChatId, tileKey]);

  return {
    isPicking,
    canPick,
    sending,
    result,
    toggle,
    cancel,
    clearResult,
    sendToAgent,
  };
}

function showAttachmentResult(result: {
  readonly status: "attached" | "unhandled";
}): void {
  if (result.status === "attached") {
    toast.success("Sent browser element to the agent.");
    return;
  }
  toast.info("Browser element packaged.", {
    description: "Composer attach grants are wired in ticket 12.",
  });
}

function ignorePickerError(_error: unknown): void {}
