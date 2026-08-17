import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useBrowserAnnotationSession,
  type BrowserAnnotationSessionBridge,
} from "@/hooks/browser/use-browser-annotation-session";
import { ANNOTATION_ROUTE_NONE_HINT } from "@/lib/browser-view/browser-annotation-router";
import type { AnnotationRoute } from "@/lib/browser-view/browser-annotation-router";
import type {
  BrowserAnnotationAttachResultInput,
  BrowserAnnotationAttachedIpcEvent,
} from "@/lib/browser-view/desktop-browser-view";
import { attachBrowserAnnotation } from "@/lib/browser-view/browser-annotation-attach";
import { useComposerDraftStore } from "@/stores/composer/composer-draft-store";
import { createStubBrowserAnnotationPayloadFor } from "@/lib/browser-view/__tests__/browser-annotation-fixtures";

vi.mock("@/lib/browser-view/browser-annotation-attach", () => ({
  attachBrowserAnnotation: vi.fn(),
}));

const NONE_ROUTE: AnnotationRoute = {
  kind: "none",
  hint: ANNOTATION_ROUTE_NONE_HINT,
};

const routeState = vi.hoisted((): { current: AnnotationRoute } => ({
  current: {
    kind: "none",
    hint: "Open or focus a chat in this task to attach.",
  },
}));

vi.mock("@/hooks/browser/use-annotation-route", () => ({
  useAnnotationRoute: () => routeState.current,
}));

const TILE = {
  viewTabId: "view-1",
  paneId: "pane-1",
  tileInstanceId: "tile-1",
  pageSessionId: "page-1",
};

function attachedEvent(
  payload: BrowserAnnotationAttachedIpcEvent["payload"],
  png: Uint8Array<ArrayBuffer>,
): BrowserAnnotationAttachedIpcEvent {
  return { ...TILE, payload, pngBytes: png };
}

type AttachReport = (
  input: BrowserAnnotationAttachResultInput,
) => Promise<void>;

function createBridge(): {
  readonly browserView: BrowserAnnotationSessionBridge;
  readonly attachedHandlers: Array<
    (change: BrowserAnnotationAttachedIpcEvent) => void
  >;
  readonly report: AttachReport;
} {
  const attachedHandlers: Array<
    (change: BrowserAnnotationAttachedIpcEvent) => void
  > = [];
  const report: AttachReport = vi.fn(() => Promise.resolve());
  const browserView: BrowserAnnotationSessionBridge = {
    startAnnotation: () => Promise.resolve({ ok: true }),
    cancelAnnotation: () => Promise.resolve(),
    setAnnotationTargetChatLabel: () => Promise.resolve(),
    reportAnnotationAttachResult: report,
    onAnnotationEvent: () => ({ dispose: () => undefined }),
    onAnnotationAttached: (handler) => {
      attachedHandlers.push(handler);
      return { dispose: () => undefined };
    },
  };
  return { browserView, attachedHandlers, report };
}

beforeEach(() => {
  routeState.current = NONE_ROUTE;
  useComposerDraftStore.setState({ drafts: {} });
  vi.mocked(attachBrowserAnnotation).mockReset();
});

afterEach(() => {
  cleanup();
  useComposerDraftStore.setState({ drafts: {} });
});

describe("useBrowserAnnotationSession attach ack", () => {
  it("sends failed and does not store a record when the route is none", async () => {
    const { browserView, attachedHandlers, report } = createBridge();
    renderHook(() =>
      useBrowserAnnotationSession({
        browserView,
        tileKey: TILE,
        status: "ready",
        viewTabId: TILE.viewTabId,
        browserInstanceId: "inst-1",
        epicId: "epic-1",
      }),
    );
    const stub = createStubBrowserAnnotationPayloadFor({
      annotationId: "ann-none",
      tabId: "tab-none",
      sessionId: "session-none",
      comment: "nowhere",
    });
    attachedHandlers[0](attachedEvent(stub.payload, stub.png));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith({
        annotationId: "ann-none",
        status: "failed",
      });
    });
    expect(useComposerDraftStore.getState().drafts).toEqual({});
  });

  it("sends attached after the record lands on the draft", async () => {
    routeState.current = {
      kind: "chat",
      chatId: "chat-ok",
      label: "Plan",
      source: "last-focused",
    };
    vi.mocked(attachBrowserAnnotation).mockImplementation((input) => {
      useComposerDraftStore.getState().addBrowserAnnotation(input.chatId, {
        kind: "browser-annotation",
        ...input.payload,
        imageFileName: `browser-annotation-${input.payload.annotationId}.png`,
        imageHash: "hash-ok",
      });
      return Promise.resolve({ status: "attached" });
    });
    const { browserView, attachedHandlers, report } = createBridge();
    renderHook(() =>
      useBrowserAnnotationSession({
        browserView,
        tileKey: TILE,
        status: "ready",
        viewTabId: TILE.viewTabId,
        browserInstanceId: "inst-1",
        epicId: "epic-1",
      }),
    );
    const stub = createStubBrowserAnnotationPayloadFor({
      annotationId: "ann-ok",
      tabId: "tab-ok",
      sessionId: "session-ok",
      comment: "landed",
    });
    attachedHandlers[0](attachedEvent(stub.payload, stub.png));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith({
        annotationId: "ann-ok",
        status: "attached",
      });
    });
    expect(
      useComposerDraftStore.getState().drafts["chat-ok"]?.browserAnnotations,
    ).toHaveLength(1);
    expect(
      useComposerDraftStore.getState().drafts["chat-ok"]
        ?.browserAnnotations[0]?.annotationId,
    ).toBe("ann-ok");
  });

  it("sends failed and stores no record when routed attach cannot store the crop", async () => {
    routeState.current = {
      kind: "chat",
      chatId: "chat-fail",
      label: "Plan",
      source: "last-focused",
    };
    vi.mocked(attachBrowserAnnotation).mockResolvedValue({
      status: "store-failed",
    });
    const { browserView, attachedHandlers, report } = createBridge();
    renderHook(() =>
      useBrowserAnnotationSession({
        browserView,
        tileKey: TILE,
        status: "ready",
        viewTabId: TILE.viewTabId,
        browserInstanceId: "inst-1",
        epicId: "epic-1",
      }),
    );
    const stub = createStubBrowserAnnotationPayloadFor({
      annotationId: "ann-store-fail",
      tabId: "tab-fail",
      sessionId: "session-fail",
      comment: "lost crop",
    });
    attachedHandlers[0](attachedEvent(stub.payload, stub.png));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith({
        annotationId: "ann-store-fail",
        status: "failed",
      });
    });
    expect(
      useComposerDraftStore.getState().drafts["chat-fail"]?.browserAnnotations,
    ).toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });
});
