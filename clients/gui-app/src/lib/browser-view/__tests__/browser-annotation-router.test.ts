import { describe, expect, it } from "vitest";

import {
  ANNOTATION_ROUTE_NONE_HINT,
  chatLabelFromCanvas,
  chatLabelFromCanvases,
  resolveAnnotationRoute,
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

describe("resolveAnnotationRoute", () => {
  it("sibling wins over last-focused; source is sibling; label comes from chatLabel", () => {
    const browser = makeBrowserTileRef({
      name: "Docs",
      hostId: HOST_ID,
      url: "https://example.com/docs",
      viewportPreset: "responsive",
    });
    const sibling = namedChat({
      id: "chat-sibling",
      instanceId: "inst-chat-sibling",
      name: "Plan chat",
    });
    const canvas = splitCanvas({ browser, chat: sibling });
    const labels: string[] = [];

    const route = resolveAnnotationRoute({
      canvas,
      browserInstanceId: browser.instanceId,
      lastFocusedChatId: "chat-last-focused",
      chatLabel: (chatId) => {
        labels.push(chatId);
        return chatLabelFromCanvas(canvas, chatId);
      },
    });

    expect(route).toEqual({
      kind: "chat",
      chatId: "chat-sibling",
      label: "Plan chat",
      source: "sibling",
    });
    expect(labels).toEqual(["chat-sibling"]);
  });

  it("no sibling + lastFocusedChatId => last-focused source and pushed label", () => {
    const browser = makeBrowserTileRef({
      name: "Docs",
      hostId: HOST_ID,
      url: "https://example.com/docs",
      viewportPreset: "responsive",
    });
    const focused = namedChat({
      id: "chat-focused",
      instanceId: "inst-chat-focused",
      name: "Earlier chat",
    });
    const canvas = loneBrowserCanvas(browser);
    const otherCanvas = splitCanvas({
      browser: makeBrowserTileRef({
        name: "Other",
        hostId: HOST_ID,
        url: "https://example.com/other",
        viewportPreset: "responsive",
      }),
      chat: focused,
    });

    const route = resolveAnnotationRoute({
      canvas,
      browserInstanceId: browser.instanceId,
      lastFocusedChatId: "chat-focused",
      chatLabel: (chatId) =>
        chatLabelFromCanvases([canvas, otherCanvas], chatId),
    });

    expect(route).toEqual({
      kind: "chat",
      chatId: "chat-focused",
      label: "Earlier chat",
      source: "last-focused",
    });
  });

  it("no sibling + no last-focused => none with ANNOTATION_ROUTE_NONE_HINT", () => {
    const browser = makeBrowserTileRef({
      name: "Docs",
      hostId: HOST_ID,
      url: "https://example.com/docs",
      viewportPreset: "responsive",
    });

    const route = resolveAnnotationRoute({
      canvas: loneBrowserCanvas(browser),
      browserInstanceId: browser.instanceId,
      lastFocusedChatId: null,
      chatLabel: () => null,
    });

    expect(route).toEqual({
      kind: "none",
      hint: ANNOTATION_ROUTE_NONE_HINT,
    });
  });

  it("empty chat name labels as Untitled chat", () => {
    const browser = makeBrowserTileRef({
      name: "Docs",
      hostId: HOST_ID,
      url: "https://example.com/docs",
      viewportPreset: "responsive",
    });
    const untitled = namedChat({
      id: "chat-untitled",
      instanceId: "inst-chat-untitled",
      name: "",
    });
    const canvas = splitCanvas({ browser, chat: untitled });

    const route = resolveAnnotationRoute({
      canvas,
      browserInstanceId: browser.instanceId,
      lastFocusedChatId: null,
      chatLabel: (chatId) => chatLabelFromCanvas(canvas, chatId),
    });

    expect(route).toEqual({
      kind: "chat",
      chatId: "chat-untitled",
      label: "Untitled chat",
      source: "sibling",
    });
  });

  it("null canvas with last-focused still falls back", () => {
    const route = resolveAnnotationRoute({
      canvas: null,
      browserInstanceId: "missing-browser",
      lastFocusedChatId: "chat-only",
      chatLabel: (chatId) => (chatId === "chat-only" ? "Solo chat" : null),
    });

    expect(route).toEqual({
      kind: "chat",
      chatId: "chat-only",
      label: "Solo chat",
      source: "last-focused",
    });
  });
});
