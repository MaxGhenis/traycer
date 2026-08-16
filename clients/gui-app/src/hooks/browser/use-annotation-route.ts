import { useCallback, useSyncExternalStore } from "react";

import {
  resolveAnnotationRoute,
  type AnnotationRoute,
  type AnnotationRouteChat,
} from "@/lib/browser-view/browser-annotation-router";
import { useMaybeOpenEpicHandle } from "@/providers/use-open-epic-handle";
import { useLastFocusedChatStore } from "@/stores/chat/last-focused-chat-store";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";
import type { ChatProjection } from "@/stores/epics/open-epic/types";
import type { OpenEpicStoreHandle } from "@/stores/epics/open-epic/store";

const EMPTY_CHATS: Readonly<Record<string, ChatProjection>> = {};

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
  const resolveChat = useCallback(
    (chatId: string): AnnotationRouteChat | null => {
      if (!Object.hasOwn(chatsById, chatId)) return null;
      const chat = chatsById[chatId];
      if (chat.archivedAt !== null) return null;
      return { title: chat.title };
    },
    [chatsById],
  );
  return resolveAnnotationRoute({
    canvas,
    browserInstanceId: input.browserInstanceId,
    lastFocusedChatId,
    resolveChat,
  });
}

function useEpicChatsById(): Readonly<Record<string, ChatProjection>> {
  const handle = useMaybeOpenEpicHandle();
  return useSyncExternalStore(
    (onStoreChange) => subscribeEpicChats(handle, onStoreChange),
    () => readEpicChats(handle),
    () => EMPTY_CHATS,
  );
}

function subscribeEpicChats(
  handle: OpenEpicStoreHandle | null,
  onStoreChange: () => void,
): () => void {
  if (handle === null) return () => undefined;
  return handle.store.subscribe(onStoreChange);
}

function readEpicChats(
  handle: OpenEpicStoreHandle | null,
): Readonly<Record<string, ChatProjection>> {
  if (handle === null) return EMPTY_CHATS;
  return handle.store.getState().chats.byId;
}
