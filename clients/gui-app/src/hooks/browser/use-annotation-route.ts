import { useState, useSyncExternalStore } from "react";

import {
  resolveAnnotationRoute,
  type AnnotationRoute,
  type AnnotationRouteChat,
} from "@/lib/browser-view/browser-annotation-router";
import { useMaybeOpenEpicHandle } from "@/providers/use-open-epic-handle";
import { useLastFocusedChatStore } from "@/stores/chat/last-focused-chat-store";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import type { OpenEpicState } from "@/stores/epics/open-epic/store";

const EMPTY_CHATS_BY_ID: OpenEpicState["chats"]["byId"] = {};

function useEpicChatsById(): OpenEpicState["chats"]["byId"] {
  const handle = useMaybeOpenEpicHandle();
  return useSyncExternalStore(
    (onStoreChange) => {
      if (handle === null) return () => undefined;
      return handle.store.subscribe(onStoreChange);
    },
    () =>
      handle === null ? EMPTY_CHATS_BY_ID : handle.store.getState().chats.byId,
    () =>
      handle === null ? EMPTY_CHATS_BY_ID : handle.store.getState().chats.byId,
  );
}

export function useAnnotationRoute(input: {
  readonly viewTabId: string;
  readonly browserInstanceId: string;
  readonly epicId: string;
}): AnnotationRoute {
  const canvas = useEpicCanvasStore(
    (state) => state.canvasByTabId[input.viewTabId] ?? null,
  );
  const lastFocusedChatId = useLastFocusedChatStore(
    (state) => state.chatIdByEpicId[input.epicId] ?? null,
  );
  const chatsById = useEpicChatsById();
  const next = resolveAnnotationRoute({
    canvas,
    browserInstanceId: input.browserInstanceId,
    lastFocusedChatId,
    resolveChat: (chatId): AnnotationRouteChat | null => {
      if (!Object.hasOwn(chatsById, chatId)) return null;
      const chat = chatsById[chatId];
      if (chat.archivedAt !== null) return null;
      return { title: chat.title };
    },
  });
  const [route, setRoute] = useState(next);
  if (!sameAnnotationRoute(route, next)) {
    setRoute(next);
    return next;
  }
  return route;
}

function sameAnnotationRoute(
  left: AnnotationRoute,
  right: AnnotationRoute,
): boolean {
  if (left.kind === "none" && right.kind === "none") {
    return left.hint === right.hint;
  }
  if (left.kind === "chat" && right.kind === "chat") {
    return (
      left.chatId === right.chatId &&
      left.label === right.label &&
      left.source === right.source
    );
  }
  return false;
}
