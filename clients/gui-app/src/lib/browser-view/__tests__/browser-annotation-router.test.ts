import { describe, expect, it } from "vitest";

import {
  ANNOTATION_ROUTE_NONE_HINT,
  resolveAnnotationRoute,
  type AnnotationRoute,
  type AnnotationRouteChat,
} from "@/lib/browser-view/browser-annotation-router";
import { makeBrowserTileRef } from "@/stores/epics/canvas/tile-schema/browser-tile";
import {
  makeOpenableNodeRef,
  type BrowserTileRef,
  type EpicArtifactRef,
  type EpicCanvasState,
} from "@/stores/epics/canvas/types";

const HOST_ID = "host-annotation-router";

function splitCanvas(input: {
  readonly browser: BrowserTileRef;
  readonly chat: EpicArtifactRef;
}): EpicCanvasState {
  return {
    activePaneId: "pane-browser",
    root: {
      kind: "group",
      id: "split-annotation",
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
    sizesByGroupId: { "split-annotation": [0.5, 0.5] },
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

function namedChat(input: {
  readonly id: string;
  readonly instanceId: string;
  readonly name: string;
}): EpicArtifactRef {
  return makeOpenableNodeRef({
    id: input.id,
    instanceId: input.instanceId,
    type: "chat",
    name: input.name,
    hostId: HOST_ID,
  });
}

function resolveFrom(
  titles: Readonly<Record<string, string>>,
): (chatId: string) => AnnotationRouteChat | null {
  return (chatId) => {
    if (!Object.hasOwn(titles, chatId)) return null;
    return { title: titles[chatId] };
  };
}

interface RouteCase {
  readonly name: string;
  readonly canvas: EpicCanvasState | null;
  readonly lastFocusedChatId: string | null;
  readonly titles: Readonly<Record<string, string>>;
  readonly expected: AnnotationRoute;
}

function browserTile(): BrowserTileRef {
  return makeBrowserTileRef({
    name: "Docs",
    hostId: HOST_ID,
    url: "https://example.com/docs",
    viewportPreset: "responsive",
  });
}

describe("resolveAnnotationRoute", () => {
  const browser = browserTile();
  const sibling = namedChat({
    id: "chat-sibling",
    instanceId: "inst-chat-sibling",
    name: "Plan chat",
  });

  it.each<RouteCase>([
    {
      name: "sibling wins over last-focused",
      canvas: splitCanvas({ browser, chat: sibling }),
      lastFocusedChatId: "chat-last-focused",
      titles: {
        "chat-sibling": "Plan chat",
        "chat-last-focused": "Earlier chat",
      },
      expected: {
        kind: "chat",
        chatId: "chat-sibling",
        label: "Plan chat",
        source: "sibling",
      } satisfies AnnotationRoute,
    },
    {
      name: "last-focused when there is no sibling",
      canvas: loneBrowserCanvas(browser),
      lastFocusedChatId: "chat-focused",
      titles: { "chat-focused": "Earlier chat" },
      expected: {
        kind: "chat",
        chatId: "chat-focused",
        label: "Earlier chat",
        source: "last-focused",
      } satisfies AnnotationRoute,
    },
    {
      name: "none without sibling or last-focused",
      canvas: loneBrowserCanvas(browser),
      lastFocusedChatId: null,
      titles: {},
      expected: {
        kind: "none",
        hint: ANNOTATION_ROUTE_NONE_HINT,
      } satisfies AnnotationRoute,
    },
    {
      name: "empty sibling name is Untitled chat",
      canvas: splitCanvas({
        browser,
        chat: namedChat({
          id: "chat-untitled",
          instanceId: "inst-chat-untitled",
          name: "",
        }),
      }),
      lastFocusedChatId: null,
      titles: { "chat-untitled": "" },
      expected: {
        kind: "chat",
        chatId: "chat-untitled",
        label: "Untitled chat",
        source: "sibling",
      } satisfies AnnotationRoute,
    },
    {
      name: "null canvas still uses last-focused",
      canvas: null,
      lastFocusedChatId: "chat-only",
      titles: { "chat-only": "Solo chat" },
      expected: {
        kind: "chat",
        chatId: "chat-only",
        label: "Solo chat",
        source: "last-focused",
      } satisfies AnnotationRoute,
    },
    {
      name: "deleted last-focused is none",
      canvas: loneBrowserCanvas(browser),
      lastFocusedChatId: "chat-deleted",
      titles: {},
      expected: {
        kind: "none",
        hint: ANNOTATION_ROUTE_NONE_HINT,
      } satisfies AnnotationRoute,
    },
    {
      name: "archived last-focused is none",
      canvas: loneBrowserCanvas(browser),
      lastFocusedChatId: "chat-archived",
      titles: {},
      expected: {
        kind: "none",
        hint: ANNOTATION_ROUTE_NONE_HINT,
      } satisfies AnnotationRoute,
    },
  ])("$name", ({ canvas, lastFocusedChatId, titles, expected }) => {
    expect(
      resolveAnnotationRoute({
        canvas,
        browserInstanceId: browser.instanceId,
        lastFocusedChatId,
        resolveChat: resolveFrom(titles),
      }),
    ).toEqual(expected);
  });
});
