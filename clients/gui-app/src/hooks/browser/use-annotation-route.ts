import { useCallback } from "react";

import {
  chatLabelFromCanvases,
  resolveAnnotationRoute,
  type AnnotationRoute,
} from "@/lib/browser-view/browser-annotation-router";
import { useLastFocusedChatStore } from "@/stores/chat/last-focused-chat-store";
import { useEpicCanvasStore } from "@/stores/epics/canvas/store";

export function useAnnotationRoute(input: {
  readonly viewTabId: string;
  readonly browserInstanceId: string;
  readonly epicId: string;
}): AnnotationRoute {
  const canvas = useEpicCanvasStore(
    (state) => state.canvasByTabId[input.viewTabId] ?? null,
  );
  const canvasByTabId = useEpicCanvasStore((state) => state.canvasByTabId);
  const canvases = Object.values(canvasByTabId);
  const lastFocusedChatId = useLastFocusedChatStore(
    (state) => state.chatIdByEpicId[input.epicId] ?? null,
  );
  const chatLabel = useCallback(
    (chatId: string): string | null => chatLabelFromCanvases(canvases, chatId),
    [canvases],
  );
  return resolveAnnotationRoute({
    canvas,
    browserInstanceId: input.browserInstanceId,
    lastFocusedChatId,
    chatLabel,
  });
}
