import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAnnotationRoute } from "@/hooks/browser/use-annotation-route";
import { attachBrowserAnnotation } from "@/lib/browser-view/browser-annotation-attach";
import type { AnnotationRoute } from "@/lib/browser-view/browser-annotation-router";
import type {
  BrowserAnnotationAttachResultInput,
  BrowserAnnotationAttachedIpcEvent,
  BrowserAnnotationSessionIpcEvent,
  BrowserViewStatus,
  BrowserViewTileKey,
  DesktopBrowserViewBridge,
} from "@/lib/browser-view/desktop-browser-view";

type ReportAnnotationAttachResult = (
  input: BrowserAnnotationAttachResultInput,
) => Promise<void>;

export interface BrowserAnnotationSessionController {
  readonly isActive: boolean;
  readonly canStart: boolean;
  readonly zoomLocked: boolean;
  readonly toggle: () => void;
}

export type BrowserAnnotationSessionBridge = Pick<
  DesktopBrowserViewBridge,
  | "startAnnotation"
  | "cancelAnnotation"
  | "setAnnotationTargetChatLabel"
  | "reportAnnotationAttachResult"
  | "onAnnotationEvent"
  | "onAnnotationAttached"
>;

interface UseBrowserAnnotationSessionArgs {
  readonly browserView: BrowserAnnotationSessionBridge | null;
  readonly tileKey: BrowserViewTileKey;
  readonly status: BrowserViewStatus;
  readonly viewTabId: string;
  readonly browserInstanceId: string;
  readonly epicId: string;
}

/**
 * Starts/cancels the native annotation overlay, routes attach payloads into
 * the composer, and pushes live target-chat labels while a session is open.
 */
export function useBrowserAnnotationSession(
  args: UseBrowserAnnotationSessionArgs,
): BrowserAnnotationSessionController {
  const { browserView, tileKey, status } = args;
  const route = useAnnotationRoute({
    viewTabId: args.viewTabId,
    browserInstanceId: args.browserInstanceId,
    epicId: args.epicId,
  });
  const [isActive, setIsActive] = useState(false);
  const [markCount, setMarkCount] = useState(0);
  const routeRef = useRef(route);
  const canStart = browserView !== null && status === "ready";

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    if (browserView === null) return;
    return () => {
      void browserView.cancelAnnotation(tileKey).catch(ignoreAnnotationError);
    };
  }, [browserView, tileKey]);

  useEffect(() => {
    if (browserView === null) return;
    const subscription = browserView.onAnnotationEvent((change) => {
      if (!isEventForTile(change, tileKey)) return;
      applySessionEvent(change, setIsActive, setMarkCount);
    });
    return () => {
      subscription.dispose();
    };
  }, [browserView, tileKey]);

  useEffect(() => {
    if (browserView === null) return;
    const subscription = browserView.onAnnotationAttached((change) => {
      if (!isEventForTile(change, tileKey)) return;
      const reportResult = browserView.reportAnnotationAttachResult;
      void ingestAttachedAnnotation(
        change,
        routeRef.current,
        reportResult === undefined
          ? null
          : (input) => reportResult.call(browserView, input),
      );
    });
    return () => {
      subscription.dispose();
    };
  }, [browserView, tileKey]);

  useEffect(() => {
    if (browserView === null || !isActive) return;
    const canAttach = route.kind === "chat";
    const label = annotationTargetLabel(route);
    void browserView
      .setAnnotationTargetChatLabel({
        ...tileKey,
        label,
        canAttach,
      })
      .catch(ignoreAnnotationError);
  }, [browserView, isActive, route, tileKey]);

  const start = useCallback(() => {
    if (browserView === null || status !== "ready") return;
    void browserView
      .startAnnotation(tileKey)
      .then((result) => {
        if (!result.ok) {
          toast.error("Couldn't start annotation.", {
            description: result.reason,
          });
          return;
        }
        setIsActive(true);
        setMarkCount(0);
      })
      .catch(() => {
        toast.error("Couldn't start annotation.");
      });
  }, [browserView, status, tileKey]);

  const cancel = useCallback(() => {
    setIsActive(false);
    setMarkCount(0);
    if (browserView === null) return;
    void browserView.cancelAnnotation(tileKey).catch(ignoreAnnotationError);
  }, [browserView, tileKey]);

  const toggle = useCallback(() => {
    if (isActive) {
      cancel();
      return;
    }
    start();
  }, [isActive, cancel, start]);

  return {
    isActive,
    canStart,
    zoomLocked: isActive && markCount > 0,
    toggle,
  };
}

function applySessionEvent(
  change: BrowserAnnotationSessionIpcEvent,
  setIsActive: (value: boolean) => void,
  setMarkCount: (value: number) => void,
): void {
  if (change.event.type === "stateChanged") {
    setMarkCount(change.event.markCount);
    return;
  }
  setIsActive(false);
  setMarkCount(0);
}

function annotationTargetLabel(route: AnnotationRoute): string {
  if (route.kind === "none") return route.hint;
  if (route.source === "sibling") return "";
  return route.label;
}

async function ingestAttachedAnnotation(
  change: BrowserAnnotationAttachedIpcEvent,
  route: AnnotationRoute,
  reportResult: ReportAnnotationAttachResult | null,
): Promise<void> {
  const annotationId = change.payload.annotationId;
  let status: "attached" | "failed" = "failed";
  try {
    if (route.kind === "none") {
      toast.error("Couldn't attach the annotation.", {
        description: route.hint,
      });
    } else {
      const result = await attachBrowserAnnotation({
        chatId: route.chatId,
        payload: change.payload,
        png: change.pngBytes,
      });
      if (result.status === "attached") {
        status = "attached";
      } else {
        toast.error("Couldn't store the annotation crop.");
      }
    }
  } finally {
    if (reportResult !== null) {
      void reportResult({ annotationId, status }).catch(ignoreAnnotationError);
    }
  }
}

function isEventForTile(
  change: BrowserViewTileKey,
  key: BrowserViewTileKey,
): boolean {
  return (
    change.viewTabId === key.viewTabId &&
    change.paneId === key.paneId &&
    change.tileInstanceId === key.tileInstanceId &&
    change.pageSessionId === key.pageSessionId
  );
}

function ignoreAnnotationError(_error: unknown): void {}
