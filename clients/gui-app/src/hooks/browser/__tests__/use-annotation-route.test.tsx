import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAnnotationRoute } from "@/hooks/browser/use-annotation-route";
import { ANNOTATION_ROUTE_NONE_HINT } from "@/lib/browser-view/browser-annotation-router";
import { useLastFocusedChatStore } from "@/stores/chat/last-focused-chat-store";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import { makeBrowserTileRef } from "@/stores/epics/canvas/tile-schema/browser-tile";
import {
  makeOpenableNodeRef,
  type BrowserTileRef,
  type EpicArtifactRef,
  type EpicCanvasState,
} from "@/stores/epics/canvas/types";
import type { ChatProjection } from "@/stores/epics/open-epic/types";

const epicChats = vi.hoisted(() => {
  let byId: Readonly<Record<string, ChatProjection>> = {};
  const listeners = new Set<() => void>();
  return {
    set(next: Readonly<Record<string, ChatProjection>>): void {
      byId = next;
      for (const listener of listeners) listener();
    },
    store: {
      getState: () => ({ chats: { byId } }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
});

vi.mock("@/providers/use-open-epic-handle", () => ({
  useMaybeOpenEpicHandle: () => ({ store: epicChats.store }),
}));

const VIEW_TAB_ID = "view-annotation-route";
const EPIC_ID = "epic-annotation-route";
const HOST_ID = "host-annotation-route";

function splitCanvas(input: {
  readonly browser: BrowserTileRef;
  readonly chat: EpicArtifactRef;
}): EpicCanvasState {
  return {
    activePaneId: "pane-browser",
    root: {
      kind: "group",
      id: "split-hook",
      direction: "horizontal",
      children: [
        {
          kind: "pane",
          id: "pane-browser",
          tabInstanceIds: [input.browser.instanceId],
          activeTabId: input.browser.instanceId,
          previewTabId: null,
          activationHistory: [input.browser.instanceId],
        },
        {
          kind: "pane",
          id: "pane-chat",
          tabInstanceIds: [input.chat.instanceId],
          activeTabId: input.chat.instanceId,
          previewTabId: null,
          activationHistory: [input.chat.instanceId],
        },
      ],
    },
    tilesByInstanceId: {
      [input.browser.instanceId]: input.browser,
      [input.chat.instanceId]: input.chat,
    },
    sizesByGroupId: { "split-hook": [0.5, 0.5] },
  };
}

function loneBrowserCanvas(browser: BrowserTileRef): EpicCanvasState {
  return {
    activePaneId: "pane-browser",
    root: {
      kind: "pane",
      id: "pane-browser",
      tabInstanceIds: [browser.instanceId],
      activeTabId: browser.instanceId,
      previewTabId: null,
      activationHistory: [browser.instanceId],
    },
    tilesByInstanceId: {
      [browser.instanceId]: browser,
    },
    sizesByGroupId: {},
  };
}

function seedView(canvas: EpicCanvasState): void {
  useEpicCanvasStore.setState({
    tabsById: {
      [VIEW_TAB_ID]: {
        tabId: VIEW_TAB_ID,
        epicId: EPIC_ID,
        name: "Route epic",
      },
    },
    canvasByTabId: {
      [VIEW_TAB_ID]: canvas,
    },
  });
}

function chatProjection(
  id: string,
  title: string,
  archivedAt: number | null,
): ChatProjection {
  return {
    id,
    title,
    parentId: null,
    createdAt: 1,
    updatedAt: 1,
    userId: null,
    hostId: HOST_ID,
    isTitleEditedByUser: false,
    settings: null,
    archivedAt,
  };
}

function resetStores(): void {
  useEpicCanvasStore.setState(useEpicCanvasStore.getInitialState(), true);
  useLastFocusedChatStore.setState({ chatIdByEpicId: {} });
  epicChats.set({});
}

beforeEach(() => {
  resetStores();
});

afterEach(() => {
  cleanup();
  resetStores();
});

describe("useAnnotationRoute", () => {
  it("resolves the visible sibling even when last-focused is a different chat", () => {
    const browser = makeBrowserTileRef({
      name: "Docs",
      hostId: HOST_ID,
      url: "https://example.com/docs",
      viewportPreset: "responsive",
    });
    const sibling = makeOpenableNodeRef({
      id: "chat-sibling",
      instanceId: "inst-chat-sibling",
      type: "chat",
      name: "Plan chat",
      hostId: HOST_ID,
    });
    seedView(splitCanvas({ browser, chat: sibling }));
    useLastFocusedChatStore.setState({
      chatIdByEpicId: { [EPIC_ID]: "chat-last-focused" },
    });

    const { result } = renderHook(() =>
      useAnnotationRoute({
        viewTabId: VIEW_TAB_ID,
        browserInstanceId: browser.instanceId,
        epicId: EPIC_ID,
      }),
    );

    expect(result.current).toEqual({
      kind: "chat",
      chatId: "chat-sibling",
      label: "Plan chat",
      source: "sibling",
    });
  });

  it("falls back to last-focused when there is no sibling chat", () => {
    const browser = makeBrowserTileRef({
      name: "Docs",
      hostId: HOST_ID,
      url: "https://example.com/docs",
      viewportPreset: "responsive",
    });
    const focused = makeOpenableNodeRef({
      id: "chat-focused",
      instanceId: "inst-chat-focused",
      type: "chat",
      name: "Earlier chat",
      hostId: HOST_ID,
    });
    seedView(loneBrowserCanvas(browser));
    useEpicCanvasStore.setState((state) => ({
      tabsById: {
        ...state.tabsById,
        "other-view": {
          tabId: "other-view",
          epicId: EPIC_ID,
          name: "Other",
        },
      },
      canvasByTabId: {
        ...state.canvasByTabId,
        "other-view": splitCanvas({
          browser: makeBrowserTileRef({
            name: "Other",
            hostId: HOST_ID,
            url: "https://example.com/other",
            viewportPreset: "responsive",
          }),
          chat: focused,
        }),
      },
    }));
    useLastFocusedChatStore.setState({
      chatIdByEpicId: { [EPIC_ID]: "chat-focused" },
    });
    epicChats.set({
      "chat-focused": chatProjection("chat-focused", "Earlier chat", null),
    });

    const { result } = renderHook(() =>
      useAnnotationRoute({
        viewTabId: VIEW_TAB_ID,
        browserInstanceId: browser.instanceId,
        epicId: EPIC_ID,
      }),
    );

    expect(result.current).toEqual({
      kind: "chat",
      chatId: "chat-focused",
      label: "Earlier chat",
      source: "last-focused",
    });
  });

  it("returns none when there is no sibling and no last-focused chat", () => {
    const browser = makeBrowserTileRef({
      name: "Docs",
      hostId: HOST_ID,
      url: "https://example.com/docs",
      viewportPreset: "responsive",
    });
    seedView(loneBrowserCanvas(browser));

    const { result } = renderHook(() =>
      useAnnotationRoute({
        viewTabId: VIEW_TAB_ID,
        browserInstanceId: browser.instanceId,
        epicId: EPIC_ID,
      }),
    );

    expect(result.current).toEqual({
      kind: "none",
      hint: ANNOTATION_ROUTE_NONE_HINT,
    });
  });

  it("labels an empty sibling chat name as Untitled chat", () => {
    const browser = makeBrowserTileRef({
      name: "Docs",
      hostId: HOST_ID,
      url: "https://example.com/docs",
      viewportPreset: "responsive",
    });
    const untitled = makeOpenableNodeRef({
      id: "chat-untitled",
      instanceId: "inst-chat-untitled",
      type: "chat",
      name: "",
      hostId: HOST_ID,
    });
    seedView(splitCanvas({ browser, chat: untitled }));

    const { result } = renderHook(() =>
      useAnnotationRoute({
        viewTabId: VIEW_TAB_ID,
        browserInstanceId: browser.instanceId,
        epicId: EPIC_ID,
      }),
    );

    expect(result.current).toEqual({
      kind: "chat",
      chatId: "chat-untitled",
      label: "Untitled chat",
      source: "sibling",
    });
  });

  it("reacts when last-focused is recorded after mount", () => {
    const browser = makeBrowserTileRef({
      name: "Docs",
      hostId: HOST_ID,
      url: "https://example.com/docs",
      viewportPreset: "responsive",
    });
    const focused = makeOpenableNodeRef({
      id: "chat-later",
      instanceId: "inst-chat-later",
      type: "chat",
      name: "Later chat",
      hostId: HOST_ID,
    });
    seedView(loneBrowserCanvas(browser));
    useEpicCanvasStore.setState((state) => ({
      canvasByTabId: {
        ...state.canvasByTabId,
        "label-view": splitCanvas({
          browser: makeBrowserTileRef({
            name: "Other",
            hostId: HOST_ID,
            url: "https://example.com/other",
            viewportPreset: "responsive",
          }),
          chat: focused,
        }),
      },
    }));

    const { result } = renderHook(() =>
      useAnnotationRoute({
        viewTabId: VIEW_TAB_ID,
        browserInstanceId: browser.instanceId,
        epicId: EPIC_ID,
      }),
    );
    expect(result.current.kind).toBe("none");

    act(() => {
      epicChats.set({
        "chat-later": chatProjection("chat-later", "Later chat", null),
      });
      useLastFocusedChatStore
        .getState()
        .recordFocusedChat(EPIC_ID, "chat-later");
    });

    expect(result.current).toEqual({
      kind: "chat",
      chatId: "chat-later",
      label: "Later chat",
      source: "last-focused",
    });
  });

  it("returns none when last-focused chat is missing from the epic registry", () => {
    const browser = makeBrowserTileRef({
      name: "Docs",
      hostId: HOST_ID,
      url: "https://example.com/docs",
      viewportPreset: "responsive",
    });
    seedView(loneBrowserCanvas(browser));
    useLastFocusedChatStore.setState({
      chatIdByEpicId: { [EPIC_ID]: "chat-deleted" },
    });
    epicChats.set({});

    const { result } = renderHook(() =>
      useAnnotationRoute({
        viewTabId: VIEW_TAB_ID,
        browserInstanceId: browser.instanceId,
        epicId: EPIC_ID,
      }),
    );

    expect(result.current).toEqual({
      kind: "none",
      hint: ANNOTATION_ROUTE_NONE_HINT,
    });
  });

  it("returns none when last-focused chat is archived", () => {
    const browser = makeBrowserTileRef({
      name: "Docs",
      hostId: HOST_ID,
      url: "https://example.com/docs",
      viewportPreset: "responsive",
    });
    seedView(loneBrowserCanvas(browser));
    useLastFocusedChatStore.setState({
      chatIdByEpicId: { [EPIC_ID]: "chat-archived" },
    });
    epicChats.set({
      "chat-archived": chatProjection("chat-archived", "Archived", 1_700),
    });

    const { result } = renderHook(() =>
      useAnnotationRoute({
        viewTabId: VIEW_TAB_ID,
        browserInstanceId: browser.instanceId,
        epicId: EPIC_ID,
      }),
    );

    expect(result.current).toEqual({
      kind: "none",
      hint: ANNOTATION_ROUTE_NONE_HINT,
    });
  });
});
