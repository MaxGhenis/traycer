import { displayTitle } from "@/lib/display-title";
import { selectSiblingChatIdForBrowserTile } from "@/lib/browser-view/browser-tile-chat-routing";
import type { EpicCanvasState } from "@/stores/epics/canvas/types";

export const ANNOTATION_ROUTE_NONE_HINT =
  "Open or focus a chat in this task to attach.";

export type AnnotationRouteSource = "sibling" | "last-focused";

export type AnnotationRoute =
  | {
      readonly kind: "chat";
      readonly chatId: string;
      readonly label: string;
      readonly source: AnnotationRouteSource;
    }
  | {
      readonly kind: "none";
      readonly hint: string;
    };

export interface ResolveAnnotationRouteInput {
  readonly canvas: EpicCanvasState | null;
  readonly browserInstanceId: string;
  readonly lastFocusedChatId: string | null;
  readonly chatLabel: (chatId: string) => string | null;
}

/**
 * Epic-scoped annotation target: visible split sibling, else the last-focused
 * chat in this epic, else none (Attach disabled + hint). Replaces tile-local
 * routing for annotations only.
 */
export function resolveAnnotationRoute(
  input: ResolveAnnotationRouteInput,
): AnnotationRoute {
  const siblingChatId = selectSiblingChatIdForBrowserTile(
    input.canvas,
    input.browserInstanceId,
  );
  if (siblingChatId !== null) {
    return {
      kind: "chat",
      chatId: siblingChatId,
      label: labelForChat(input.chatLabel, siblingChatId),
      source: "sibling",
    };
  }
  if (input.lastFocusedChatId !== null && input.lastFocusedChatId.length > 0) {
    return {
      kind: "chat",
      chatId: input.lastFocusedChatId,
      label: labelForChat(input.chatLabel, input.lastFocusedChatId),
      source: "last-focused",
    };
  }
  return { kind: "none", hint: ANNOTATION_ROUTE_NONE_HINT };
}

export function chatLabelFromCanvas(
  canvas: EpicCanvasState | null,
  chatId: string,
): string | null {
  if (canvas === null) return null;
  for (const tile of Object.values(canvas.tilesByInstanceId)) {
    if (tile === undefined) continue;
    if (tile.type === "chat" && tile.id === chatId) {
      return tile.name;
    }
  }
  return null;
}

export function chatLabelFromCanvases(
  canvases: ReadonlyArray<EpicCanvasState>,
  chatId: string,
): string | null {
  for (const canvas of canvases) {
    const label = chatLabelFromCanvas(canvas, chatId);
    if (label !== null) return label;
  }
  return null;
}

function labelForChat(
  chatLabel: (chatId: string) => string | null,
  chatId: string,
): string {
  return displayTitle(chatLabel(chatId) ?? "", "chat");
}
