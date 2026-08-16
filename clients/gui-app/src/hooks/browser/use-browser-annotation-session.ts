import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAnnotationRoute } from "@/hooks/browser/use-annotation-route";
import {
  attachRoutedBrowserAnnotation,
  type BrowserAnnotationAttachPayload,
} from "@/lib/browser-view/browser-annotation-attach";
import {
  overlayTargetFromRoute,
  type AnnotationRoute,
} from "@/lib/browser-view/browser-annotation-router";
import type {
  BrowserAnnotationAttachedIpcEvent,
  BrowserAnnotationSessionIpcEvent,
  BrowserViewStatus,
  BrowserViewTileKey,
  DesktopBrowserViewBridge,
} from "@/lib/browser-view/desktop-browser-view";

export interface BrowserAnnotationSessionController {
  readonly isActive: boolean;
  readonly canStart: boolean;
  readonly zoomLocked: boolean;
  readonly toggle: () => void;
}

interface UseBrowserAnnotationSessionArgs {
  readonly browserView: DesktopBrowserViewBridge | null;
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
      void ingestAttachedAnnotation(change, routeRef.current);
    });
    return () => {
      subscription.dispose();
    };
  }, [browserView, tileKey]);

  useEffect(() => {
    if (browserView === null || !isActive) return;
    const target = overlayTargetFromRoute(route);
    void browserView
      .setAnnotationTargetChatLabel({
        ...tileKey,
        label: target.label,
        canAttach: target.canAttach,
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

async function ingestAttachedAnnotation(
  change: BrowserAnnotationAttachedIpcEvent,
  route: AnnotationRoute,
): Promise<void> {
  const result = await attachRoutedBrowserAnnotation({
    route,
    payload: toAttachPayload(change.payload),
    png: change.pngBytes,
  });
  if (result.status === "attached") return;
  if (result.status === "none") {
    toast.error("Couldn't attach the annotation.", {
      description: result.hint,
    });
    return;
  }
  toast.error("Couldn't store the annotation crop.");
}

function toAttachPayload(
  payload: BrowserAnnotationAttachedIpcEvent["payload"],
): BrowserAnnotationAttachPayload {
  return {
    annotationId: payload.annotationId,
    tabId: payload.tabId,
    sessionId: payload.sessionId,
    origin: payload.origin,
    pageUrl: payload.pageUrl,
    pageTitle: payload.pageTitle,
    capturedAt: payload.capturedAt,
    comment: payload.comment,
    counts: payload.counts,
    elements: payload.elements.map((element) => ({
      selector: element.selector,
      tagName: element.tagName,
      elementId: element.elementId,
      classNames: [...element.classNames],
      attributes: element.attributes.map((attribute) => ({
        name: attribute.name,
        value: attribute.value,
      })),
      outerHtml: element.outerHtml,
      outerHtmlTruncated: element.outerHtmlTruncated,
      textPreview: element.textPreview,
      ariaRole: element.ariaRole,
      accessibleName: element.accessibleName,
      boundingBox: { ...element.boundingBox },
      computedStyles: element.computedStyles.map((style) => ({
        property: style.property,
        value: style.value,
      })),
    })),
  };
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
